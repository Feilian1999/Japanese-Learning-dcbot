// 產生 JLPT 等級對照表 src/jlpt-data.js：npm run build:jlpt
// 單字表來源：https://github.com/jamsinclair/open-anki-jlpt-decks（MIT）
// 原始資料為 Jonathan Waller 的 JLPT 單字表（https://www.tanos.co.uk/jlpt/）
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src';
const LEVELS = [5, 4, 3, 2, 1];

// 簡易 CSV 解析（支援雙引號包住含逗號的欄位）
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') (cell += '"'), i++;
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') cells.push(cell), (cell = '');
      else cell += ch;
    }
    cells.push(cell);
    rows.push(cells);
  }
  return rows;
}

// 「足; 脚」「～円」「（お）茶」這類寫法拆成可查詢的形式
function splitForms(text) {
  return text
    .split(/[;；、]/)
    .flatMap((f) => {
      const clean = f.replace(/[～〜~\s]/g, '');
      // 括號表示可省略：（お）茶 → お茶、茶
      const optional = clean.match(/^(.*)[(（](.+?)[)）](.*)$/);
      return optional
        ? [optional[1] + optional[2] + optional[3], optional[1] + optional[3]]
        : [clean];
    })
    .filter(Boolean);
}

// 同一個字出現在多個等級時，取最簡單的等級（數字最大）
const easiest = (map, key, level) => {
  if (!(key in map) || map[key] < level) map[key] = level;
};

// 只留漢字，用來對照送假名寫法不同的同一個字（控え室 / 控室、申し込む / 申込む）
const kanjiOnly = (text) => text.replace(/[^\u4e00-\u9fff\u3005]/g, '');

const byForm = {};
const byFormReading = {};
const byKanjiReading = {};
for (const level of LEVELS) {
  const res = await fetch(`${SOURCE}/n${level}.csv`);
  if (!res.ok) throw new Error(`下載 N${level} 失敗：${res.status}`);
  const rows = parseCsv(await res.text());
  for (const [expression, reading] of rows) {
    const forms = splitForms(expression);
    const readings = splitForms(reading);
    for (const [i, form] of forms.entries()) {
      // 寫法和讀音數量一致時一對一配對（いい; よい），否則每個寫法配所有讀音（足; 脚 → あし）
      const formReadings = forms.length === readings.length ? [readings[i]] : readings;
      easiest(byForm, form, level);
      for (const r of formReadings) {
        easiest(byFormReading, `${form}|${r}`, level);
        if (kanjiOnly(form)) easiest(byKanjiReading, `${kanjiOnly(form)}|${r}`, level);
      }
    }
  }
  console.log(`N${level}：${rows.length} 個單字`);
}

// 只保留「同一寫法、不同讀音、等級不同」的組合，其餘用 byForm 查就夠了
for (const key of Object.keys(byFormReading)) {
  if (byFormReading[key] === byForm[key.split('|')[0]]) delete byFormReading[key];
}

writeFileSync(
  new URL('../src/jlpt-data.js', import.meta.url),
  `// 由 scripts/build-jlpt.js 產生，請勿手動修改\n` +
    `// 來源：open-anki-jlpt-decks（MIT），原始資料為 Jonathan Waller 的 JLPT 單字表\n` +
    `export const byForm = ${JSON.stringify(byForm)};\n` +
    `export const byFormReading = ${JSON.stringify(byFormReading)};\n` +
    `export const byKanjiReading = ${JSON.stringify(byKanjiReading)};\n`,
);
console.log(
  `完成：${Object.keys(byForm).length} 種寫法，${Object.keys(byFormReading).length} 組需要依讀音區分，` +
    `${Object.keys(byKanjiReading).length} 組送假名對照`,
);

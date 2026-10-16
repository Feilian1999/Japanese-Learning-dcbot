import { jlptLevel } from './jlpt.js';

// 免費、不需要 API Key 的資料來源：
// - Jotoba（JMdict 字典）：讀音、詞性、英文解釋
//   （原本用 Jisho，但從 Cloudflare Workers 連 Jisho 一律回 525，所以改用 Jotoba）
// - JLPT 等級：內建對照表（src/jlpt-data.js，由 scripts/build-jlpt.js 產生）
// - Cloudflare Workers AI：參考英文詞義整理繁體中文意思
// - 日文維基百科：字典沒收錄的字（人名、作品名、新詞），交給 AI 依條目解釋
// - Google 翻譯（免費端點，失敗時改用 MyMemory）：例句翻譯，以及 AI 失敗時的中文意思
// - 例句：Tatoeba（開放例句庫）→ Jotoba 例句 → Massif（網路文章），依序嘗試

// Jotoba 的詞性格式：字串（"Adverb"）或物件（{ Verb: { Godan: "Ru" } }、{ Adjective: "Na" }）
function posToZh(pos) {
  const [kind, detail] = typeof pos === 'string' ? [pos, null] : Object.entries(pos)[0];
  const sub = detail && typeof detail === 'object' ? Object.keys(detail)[0] : detail;
  switch (kind) {
    case 'Noun':
      return '名詞';
    case 'Pronoun':
      return '代名詞';
    case 'Adverb':
    case 'AdverbTo':
      return '副詞';
    case 'Conjunction':
      return '接續詞';
    case 'Interjection':
      return '感嘆詞';
    case 'Particle':
      return '助詞';
    case 'Counter':
      return '量詞';
    case 'Adjective':
      return { Keiyoushi: 'い形容詞', Na: 'な形容詞', No: 'の形容詞' }[sub] ?? '形容詞';
    case 'Verb':
      // Transitive / Intransitive（自他動詞）不顯示
      return { Godan: '五段動詞', Ichidan: '一段動詞', Kuru: 'カ變動詞', Irregular: 'する動詞' }[sub] ?? null;
    default:
      return null;
  }
}

async function getJson(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': 'discord-japanese-bot/1.0', ...init.headers },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} 回應 ${res.status}`);
  return res.json();
}

// Google 翻譯（Chrome 擴充功能用的免費端點）
async function translateGoogle(text, from) {
  const url =
    'https://clients5.google.com/translate_a/t?client=dict-chrome-ex' +
    `&sl=${from}&tl=zh-TW&q=${encodeURIComponent(text)}`;
  const data = await getJson(url);
  return data.join('');
}

// MyMemory：匿名每天約 5000 字元，單字翻譯品質較不穩定，當備援用
async function translateMyMemory(text, from) {
  const url =
    'https://api.mymemory.translated.net/get' +
    `?langpair=${from}|zh-TW&q=${encodeURIComponent(text)}`;
  const data = await getJson(url);
  if (data.responseStatus !== 200) throw new Error(`翻譯失敗：${data.responseDetails}`);
  return data.responseData.translatedText;
}

// Workers AI 翻譯，給機器翻譯失敗時備援
async function translateAI(ai, text, from) {
  const result = await ai.run(AI_MODEL, {
    messages: [
      {
        role: 'system',
        content: '你是專業翻譯，把文字翻成自然的繁體中文（台灣用語）。只輸出翻譯結果，不要任何說明。',
      },
      {
        role: 'user',
        content: `請把以下${from === 'zh-CN' ? '簡體中文' : '日文'}翻成繁體中文：\n${text} /no_think`,
      },
    ],
    max_tokens: 200,
  });
  return aiText(result).split('\n')[0].trim();
}

// 依序嘗試 Google → Workers AI → MyMemory，全部失敗回傳空字串
// （從 Cloudflare 呼叫時 Google 偶爾會被限流；MyMemory 以網路位址計算額度，共用的 Cloudflare 位址常被用完）
async function translate(text, from = 'ja', ai) {
  const attempts = [
    () => translateGoogle(text, from),
    ai && (() => translateAI(ai, text, from)),
    () => translateMyMemory(text, from),
  ].filter(Boolean);
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result) return result;
    } catch (err) {
      console.error('翻譯失敗，改用下一個來源', err);
    }
  }
  return '';
}

async function lookupDictionary(word) {
  const data = await getJson('https://jotoba.de/api/search/words', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: word, language: 'English', no_english: false }),
  });
  // 只接受寫法或讀音完全一致的條目；字典沒收錄的字（例如人名、暱稱），
  // Jotoba 會回傳部分相符的結果（てまぬい → て），不能拿來用
  const entry = data.words.find((w) => w.reading.kanji === word || w.reading.kana === word);
  if (!entry) return null;

  const senses = entry.senses.slice(0, 5).map((s) => s.glosses.join('; '));
  const pos = entry.senses[0].pos.map(posToZh).filter(Boolean);
  return {
    word: entry.reading.kanji ?? entry.reading.kana,
    reading: entry.reading.kana,
    english: senses[0],
    // 所有詞義的英文解釋，給 AI 整理中文意思用
    senses,
    partOfSpeech: [...new Set(pos)].join('・'),
  };
}

// 各例句來源回傳候選句：
// { text, zh?（真人中文翻譯）, en?（真人英文翻譯）, highlight?（句中實際出現的單字形式）}
async function fromTatoeba(word, withChinese) {
  // showtrans=all 才會附上所有語言的翻譯（預設只附篩選條件的語言，或完全不附）
  const url =
    'https://api.tatoeba.org/unstable/sentences?lang=jpn&sort=relevance&limit=10&showtrans=all' +
    `&q=${encodeURIComponent(word)}${withChinese ? '&trans:lang=cmn' : ''}`;
  const { data } = await getJson(url);
  return data
    .filter((s) => s.text.includes(word))
    .map((s) => ({
      text: s.text,
      zh: s.translations?.find((t) => t.lang === 'cmn'),
      en: s.translations?.find((t) => t.lang === 'eng')?.text,
    }));
}

// Jotoba 例句：資料同樣來自 Tatoeba，但會比對動詞變化（堪える → 堪えた）
async function fromJotoba(word) {
  const { sentences } = await getJson('https://jotoba.de/api/search/sentences', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: word, language: 'English' }),
  });
  return sentences.map((s) => ({ text: s.content, en: s.translation }));
}

// Massif：從網路文章收集的例句，收錄範圍最廣（新詞、冷門詞也找得到）
async function fromMassif(word) {
  const { results } = await getJson(
    `https://massif.la/ja/search?q=${encodeURIComponent(word)}&fmt=json`,
  );
  return results.map((r) => ({
    text: r.text,
    highlight: r.highlighted_html.match(/<em>(.+?)<\/em>/)?.[1],
  }));
}

// 句中實際出現的單字形式：取單字最長的開頭部分（堪える 在「堪えた」中是「堪え」）
function matchedForm(text, word) {
  for (let n = word.length; n > 0; n--) {
    const part = word.slice(0, n);
    // 只剩一個假名時太容易誤標，至少要兩個字或含漢字
    if (text.includes(part) && (n >= 2 || /[\u4e00-\u9fff]/.test(part))) return part;
  }
  return '';
}

// AI 翻譯例句，附上真人翻譯當參考，避免誤解句意（例如把「上級国民」誤翻成「老年人」）
async function translateSentenceAI(ai, { text, en, zh }) {
  const references = [
    en && `英文參考翻譯（真人翻譯）：${en}`,
    zh && `簡體中文參考翻譯（真人翻譯）：${zh.text}`,
  ].filter(Boolean);
  const result = await ai.run(AI_MODEL, {
    messages: [
      {
        role: 'system',
        content: '你是專業日文翻譯，把日文翻成自然的繁體中文（台灣用語）。只輸出翻譯結果，不要任何說明。',
      },
      {
        role: 'user',
        content:
          `日文：${text}\n${references.join('\n')}\n\n` +
          '請把日文翻成繁體中文。以日文原文為準，參考翻譯只用來確認意思。/no_think',
      },
    ],
    max_tokens: 200,
  });
  const translation = aiText(result).split('\n')[0].trim();
  // 回傳內容不像翻譯（沒有漢字、或長得不合理）就視為失敗
  if (!/[\u4e00-\u9fff]/.test(translation) || translation.length > text.length * 3 + 20) {
    throw new Error(`AI 翻譯格式不符：${translation.slice(0, 50)}`);
  }
  return translation;
}

// 例句翻譯：真人繁中翻譯 → AI（參考真人翻譯）→ 機器翻譯
async function translateSentence(ai, sentence) {
  const { text, zh } = sentence;
  if (zh?.script === 'Hant') return zh.text;
  if (ai) {
    try {
      return await translateSentenceAI(ai, sentence);
    } catch (err) {
      console.error('AI 翻譯例句失敗，改用機器翻譯', err);
    }
  }
  // 有簡體翻譯就轉成繁體，否則直接翻日文
  return zh ? translate(zh.text, 'zh-CN') : translate(text, 'ja');
}

// 句子裡要真的有這個字：完整出現，或只差詞尾的變化（堪える → 堪えた）
// 搜尋結果是模糊比對，不檢查會配到無關的句子（てまぬい → 手間がはぶけます）
function containsWord(candidate, word) {
  if (candidate.highlight) return true;
  return matchedForm(candidate.text, word).length >= Math.max(1, word.length - 2);
}

// 依序嘗試各來源，前一個找不到才換下一個；單一來源出錯不影響後面的
const EXAMPLE_SOURCES = [
  (word) => fromTatoeba(word, true),
  (word) => fromTatoeba(word, false),
  fromJotoba,
  fromMassif,
];

async function findExample(word, ai) {
  for (const source of EXAMPLE_SOURCES) {
    const candidates = await source(word).catch((err) => {
      console.error('例句來源失敗', err);
      return [];
    });
    // 偏好長度適中的句子（太短沒有上下文，太長不好讀）
    const sentence = candidates
      .filter((c) => c.text.length >= 6 && c.text.length <= 40)
      .filter((c) => containsWord(c, word))
      .sort((a, b) => Math.abs(a.text.length - 20) - Math.abs(b.text.length - 20))[0];
    if (!sentence) continue;

    return {
      example: sentence.text,
      exampleTranslation: await translateSentence(ai, sentence),
      highlight: sentence.highlight || matchedForm(sentence.text, word),
    };
  }
  return { example: '', exampleTranslation: '' };
}

// Cloudflare Workers AI（免費每天 10,000 Neurons，一次約 5 Neurons）
// 參考字典所有英文詞義，整理成繁體中文意思；比直接機器翻譯單字更能涵蓋多種意思
const AI_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

// 不同模型的回傳格式不同：{ response } 或 OpenAI 格式 { choices }；並去掉思考過程
function aiText(result) {
  const raw = result.response ?? result.choices?.[0]?.message?.content ?? '';
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

async function meaningFromAI(ai, word, reading, senses) {
  const definitions = senses.map((s, i) => `${i + 1}. ${s}`).join('\n');
  const result = await ai.run(AI_MODEL, {
    messages: [
      {
        role: 'system',
        content: '你是日文辭典編輯，替台灣的學習者撰寫日文單字的繁體中文釋義。',
      },
      {
        role: 'user',
        content:
          `單字：${word}（${reading}）\n英文釋義：\n${definitions}\n\n` +
          '請寫出這個單字最常用的 1～3 個繁體中文意思，依常用程度排序，用「；」分隔。' +
          '每個意思要明顯不同，不要只是換句話說；較少用的意思寧可省略。' +
          '每個意思簡短（2～8 字），使用台灣常用詞，不要使用簡體字。' +
          '只輸出意思本身，不要編號、解釋或其他文字。/no_think',
      },
    ],
    max_tokens: 100,
  });

  const raw = aiText(result);
  const items = raw
    .split('\n')[0]
    .split(/[;；、,，]/)
    .map((m) => m.replace(/[「」"'。\s]/g, ''))
    // 只留含漢字的意思（過濾混進來的英文）
    .filter((m) => /[\u4e00-\u9fff]/.test(m) && m.length <= 10);
  // 去掉互相包含的重複意思，例如「吃東西；吃」只留「吃東西」
  const meanings = items.filter(
    (m, i) => !items.some((other, j) => j < i && (other.includes(m) || m.includes(other))),
  );
  if (!meanings.length) throw new Error(`AI 回傳格式不符：${raw.slice(0, 50)}`);
  return meanings.slice(0, 3).join('；');
}

// 有 AI 且字典有英文詞義時用 AI 整理，否則（或失敗時）直接機器翻譯單字
// 字典沒收錄的字（人名、作品名、新詞）改查日文維基百科
// 維基百科要求 User-Agent 附上聯絡方式
const WIKIPEDIA_USER_AGENT =
  'discord-japanese-bot/1.0 (https://github.com/Feilian1999/Japanese-Learning-dcbot)';

// 用完全相同的標題查（會跟著重新導向，例如 月村手毬 → 学園アイドルマスター），不用模糊搜尋，避免配到無關條目
async function lookupWikipedia(word) {
  const res = await fetch(
    `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`,
    {
      headers: { 'User-Agent': WIKIPEDIA_USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`ja.wikipedia.org 回應 ${res.status}`);
  const page = await res.json();
  // 消歧義頁等非一般條目不採用
  if (page.type !== 'standard' || !page.extract) return null;
  return { title: page.title, extract: page.extract.slice(0, 500) };
}

// 讀音要從維基原始碼找：摘要會省略括號裡的讀音（『学園アイドルマスター』 は…），
// 重新導向時摘要也是目標條目的內容（月村手毬 → 学園アイドルマスター），找不到這個字的讀音
async function readingFromWikipedia(word) {
  const { parse } = await getJson(
    'https://ja.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1' +
      `&page=${encodeURIComponent(word)}`,
    { headers: { 'User-Agent': WIKIPEDIA_USER_AGENT } },
  );
  const wikitext = parse?.wikitext ?? '';
  // 原始碼裡的寫法可能在姓名中間加空白（月村 手毬）
  const name = [...word].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
  const kana = '[\\u3040-\\u30ffー・\\s]+';
  const patterns = [
    // {{読み仮名|月村 手毬|つきむら てまり}}
    new RegExp(`\\{\\{読み仮名(?:_ruby不使用)?\\|${name}\\|(${kana})[|}]`),
    // '''推し活'''（おしかつ）、『'''学園アイドルマスター'''』（がくえんアイドルマスター、…）
    new RegExp(`'''${name}'''[』」]?\\s*（(${kana})[）、]`),
  ];
  for (const pattern of patterns) {
    const reading = wikitext.match(pattern)?.[1].replace(/[・\s]/g, '');
    // 至少要有平假名，避免把純片假名的別名當成讀音
    if (reading && /[぀-ゟ]/.test(reading)) return reading;
  }
  return '';
}

async function meaningFromWikipedia(ai, word, { title, extract }) {
  const redirect = title !== word ? `（「${word}」會重新導向到這個條目）` : '';
  const result = await ai.run(AI_MODEL, {
    messages: [
      { role: 'system', content: '你是日文老師，根據提供的資料替台灣學習者解釋日文詞語。' },
      {
        role: 'user',
        content:
          `詞語：${word}\n維基百科條目「${title}」${redirect}的摘要：\n${extract}\n\n` +
          `請根據以上資料，用繁體中文寫出「${word}」的簡短解釋（一句話，30 字以內）。` +
          '只根據資料內容，不要補充資料以外的事。只輸出解釋本身。/no_think',
      },
    ],
    max_tokens: 150,
  });
  const meaning = aiText(result).split('\n')[0].trim();
  if (!/[\u4e00-\u9fff]/.test(meaning) || meaning.length > 80) {
    throw new Error(`AI 解釋格式不符：${meaning.slice(0, 50)}`);
  }
  return meaning;
}

const NOT_FOUND = { meaning: '', note: '字典查無此字，可用 `/add 單字 意思` 自己補上' };

// 字典查不到時：有維基條目就請 AI 依條目解釋；查不到就明白標示，不讓 AI 亂猜
async function explainFromWikipedia(ai, word) {
  if (!ai) return NOT_FOUND;
  try {
    const page = await lookupWikipedia(word);
    if (!page) return NOT_FOUND;
    const [meaning, reading] = await Promise.all([
      meaningFromWikipedia(ai, word, page),
      // 讀音找不到不影響解釋
      readingFromWikipedia(word).catch((err) => {
        console.error('維基百科讀音失敗', err);
        return '';
      }),
    ]);
    return { meaning, note: `📚 參考維基百科「${page.title}」`, reading };
  } catch (err) {
    console.error('維基百科解釋失敗', err);
    return NOT_FOUND;
  }
}

// 回傳 { meaning, note?, reading? }
async function findMeaning(ai, word, dict) {
  if (!dict) return explainFromWikipedia(ai, word);
  if (ai && dict.senses.length) {
    try {
      return { meaning: await meaningFromAI(ai, word, dict.reading, dict.senses) };
    } catch (err) {
      console.error('AI 釋義失敗，改用機器翻譯', err);
    }
  }
  return { meaning: await translate(word, 'ja', ai) };
}

// 只給單字（或單字＋讀音）時，查字典補齊其餘欄位
// hint：使用者自己提供的讀音或意思，有給就不自動產生
export async function generateEntry(input, hint, ai) {
  const { reading, meaning: givenMeaning } = hint;
  const dict = await lookupDictionary(input).catch((err) => {
    console.error('查字典失敗', err);
    return null;
  });
  // 輸入平假名（例如 たべる）時改用字典的漢字寫法（食べる）去翻譯和找例句
  const word = dict?.word ?? input;
  const [meaningInfo, example] = await Promise.all([
    givenMeaning ? { meaning: givenMeaning } : findMeaning(ai, word, dict),
    findExample(word, ai).catch((err) => {
      console.error('找例句失敗', err);
      return { example: '', exampleTranslation: '' };
    }),
  ]);

  const finalReading = reading || dict?.reading || meaningInfo.reading || word;
  return {
    word,
    reading: finalReading,
    meaning: meaningInfo.meaning,
    meaningNote: meaningInfo.note,
    english: dict?.english ?? '',
    tags: [jlptLevel(word, finalReading), dict?.partOfSpeech].filter(Boolean),
    ...example,
  };
}

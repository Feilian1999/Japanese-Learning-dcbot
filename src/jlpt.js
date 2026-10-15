import { byForm, byFormReading, byKanjiReading } from './jlpt-data.js';

const kanjiOnly = (text) => text.replace(/[^一-鿿々]/g, '');

// 回傳 'N1'～'N5'，不在 JLPT 單字表內則回傳空字串
export function jlptLevel(word, reading) {
  const level =
    // 同寫法不同讀音、等級不同（一日：ついたち / いちにち）
    byFormReading[`${word}|${reading}`] ??
    byForm[word] ??
    // 送假名寫法不同（控え室 → 控室），讀音也要一致才算
    (kanjiOnly(word) && byKanjiReading[`${kanjiOnly(word)}|${reading}`]) ??
    // 單字表只收平假名寫法的字（字典回傳漢字，但單字表寫假名）
    byForm[reading];
  return level ? `N${level}` : '';
}

// 免費、不需要 API Key 的資料來源：
// - Jisho（JMdict 字典）：讀音、英文解釋、詞性、JLPT 等級
// - Google 翻譯（免費端點，失敗時改用 MyMemory）：繁體中文意思、例句翻譯
// - Tatoeba（開放例句庫）：真人寫的日文例句

const POS_ZH = {
  Noun: '名詞',
  'Suru verb': 'する動詞',
  'Godan verb': '五段動詞',
  'Ichidan verb': '一段動詞',
  'I-adjective': 'い形容詞',
  'Na-adjective': 'な形容詞',
  Adverb: '副詞',
  Expressions: '慣用語',
  Conjunction: '接續詞',
  Interjection: '感嘆詞',
  Particle: '助詞',
  Counter: '量詞',
};

async function getJson(url) {
  const res = await fetch(url, {
    // Jisho 會擋 Node 預設的 User-Agent
    headers: { 'User-Agent': 'discord-japanese-bot/1.0' },
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

async function translate(text, from = 'ja') {
  try {
    return await translateGoogle(text, from);
  } catch {
    return translateMyMemory(text, from);
  }
}

async function lookupJisho(word) {
  const data = await getJson(
    `https://jisho.org/api/v1/search/words?keyword=${encodeURIComponent(word)}`,
  );
  // 優先找寫法或讀音完全一致的條目
  const entry =
    data.data.find((e) => e.japanese.some((j) => j.word === word || j.reading === word)) ??
    data.data[0];
  if (!entry) return null;

  const headword = entry.japanese.find((j) => j.word === word) ?? entry.japanese[0];
  const sense = entry.senses[0];
  const pos = sense.parts_of_speech
    .map((p) => Object.entries(POS_ZH).find(([en]) => p.startsWith(en))?.[1])
    .filter(Boolean);
  return {
    word: headword.word ?? headword.reading,
    reading: headword.reading,
    english: sense.english_definitions.join('; '),
    partOfSpeech: [...new Set(pos)].join('・'),
    jlpt: entry.jlpt[0]?.replace('jlpt-', '').toUpperCase() ?? '',
  };
}

async function findExample(word) {
  const base =
    'https://api.tatoeba.org/unstable/sentences?lang=jpn&sort=relevance&limit=10' +
    `&q=${encodeURIComponent(word)}`;
  // 先找有中文翻譯的例句，沒有的話退而求其次找任何例句
  for (const url of [`${base}&trans:lang=cmn`, base]) {
    const { data } = await getJson(url);
    // 偏好長度適中的句子
    const sentence = data
      .filter((s) => s.text.includes(word))
      .sort((a, b) => Math.abs(a.text.length - 20) - Math.abs(b.text.length - 20))[0];
    if (!sentence) continue;

    const zh = sentence.translations?.find((t) => t.lang === 'cmn');
    // 繁體直接用；簡體或沒有中文翻譯就翻成繁中
    const translation = zh?.script === 'Hant' ? zh.text : await translate(zh?.text ?? sentence.text, zh ? 'zh-CN' : 'ja');
    return { example: sentence.text, exampleTranslation: translation };
  }
  return { example: '', exampleTranslation: '' };
}

// 只給單字（或單字＋讀音）時，查字典補齊其餘欄位
export async function generateEntry(input, reading) {
  const jisho = await lookupJisho(input).catch(() => null);
  // 輸入平假名（例如 たべる）時改用字典的漢字寫法（食べる）去翻譯和找例句
  const word = jisho?.word ?? input;
  const [meaning, example] = await Promise.all([
    translate(word),
    findExample(word).catch(() => ({ example: '', exampleTranslation: '' })),
  ]);

  return {
    word,
    reading: reading || jisho?.reading || word,
    meaning,
    english: jisho?.english ?? '',
    tags: [jisho?.jlpt, jisho?.partOfSpeech].filter(Boolean).join('　'),
    ...example,
  };
}

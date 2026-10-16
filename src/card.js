import { jlptLevel } from './jlpt.js';

// 支援半形空白、全形空白與 tab 分隔
export function splitInput(text) {
  return text.trim().split(/[\s　]+/).filter(Boolean);
}

const isKana = (text) => /^[\u3040-\u30ffー]+$/.test(text);

// 一～兩段：自動查詢。第二段全是假名才當讀音（ひかえしつ），否則當意思（月村手毬）
export function parseAuto([word, second]) {
  if (!second) return { word, hint: {} };
  return { word, hint: isKana(second) ? { reading: second } : { meaning: second } };
}

// 三段以上視為手動輸入：單字 / 讀音 / 意思，剩下的全部當作例句
export function parseManual(parts) {
  const [word, reading, meaning, ...rest] = parts;
  const level = jlptLevel(word, reading);
  return { word, reading, meaning, tags: level ? [level] : [], example: rest.join(' ') };
}

export function userOf(interaction) {
  return interaction.member?.user ?? interaction.user;
}

// 下指令的人：伺服器暱稱 > 顯示名稱 > 使用者名稱
function authorName(interaction) {
  const user = userOf(interaction);
  return interaction.member?.nick ?? user.global_name ?? user.username;
}

// D1 的 CURRENT_TIMESTAMP 是 UTC（2026-10-15 06:36:27），轉成台灣日期
function formatTaipeiDate(utc) {
  const taipei = new Date(Date.parse(`${utc.replace(' ', 'T')}Z`) + 8 * 3600_000);
  return taipei.toISOString().slice(0, 10).replaceAll('-', '/');
}

function historyText(history) {
  if (!history) return '';
  if (history.times === 1) return '🆕 第一次出現';
  return `🔁 第 ${history.times} 次出現（上次 ${formatTaipeiDate(history.lastAt)}）`;
}

// https://docs.discord.com/developers/components/reference
const IS_COMPONENTS_V2 = 1 << 15;
const ComponentType = { TEXT_DISPLAY: 10, SEPARATOR: 14, CONTAINER: 17 };
const text = (content) => ({ type: ComponentType.TEXT_DISPLAY, content });
const divider = () => ({ type: ComponentType.SEPARATOR, divider: true, spacing: 2 });

// 單字卡版面：單字放大當視覺焦點，讀音/等級/詞性同一行，意思與例句用分隔線分區
export function buildCard(
  { word, reading, meaning, meaningNote, english, tags = [], example, exampleTranslation, highlight },
  interaction,
  history,
) {
  // 等級、詞性用行內程式碼顯示成小標籤
  // 讀音跟單字一樣（假名寫的字）就不重複顯示
  const infoLine = [reading !== word && reading, ...tags.map((tag) => `\`${tag}\``)]
    .filter(Boolean)
    .join('　');

  const components = [
    text([`# ${word}`, infoLine].filter(Boolean).join('\n')),
    divider(),
    text(
      meaning
        ? [`**${meaning}**`, english && `-# ${english}`, meaningNote && `-# ${meaningNote}`]
            .filter(Boolean)
            .join('\n')
        : meaningNote || '（查無翻譯）',
    ),
  ];

  if (example) {
    // 例句中出現的單字加粗加底線，方便閱讀（動詞變化時標示實際出現的形式）
    const target = highlight || word;
    const highlighted = example.replaceAll(target, `__**${target}**__`);
    components.push(
      divider(),
      text([highlighted, exampleTranslation && `-# ${exampleTranslation}`].filter(Boolean).join('\n')),
    );
  }

  components.push(
    divider(),
    text(`-# ${[historyText(history), `由 ${authorName(interaction)} 新增`].filter(Boolean).join('・')}`),
  );

  return {
    flags: IS_COMPONENTS_V2,
    components: [{ type: ComponentType.CONTAINER, accent_color: 0xf6a19b, components }],
  };
}

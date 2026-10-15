// 支援半形空白、全形空白與 tab 分隔
export function splitInput(text) {
  return text.trim().split(/[\s　]+/).filter(Boolean);
}

// 三段以上視為手動輸入：單字 / 讀音 / 意思，剩下的全部當作例句
export function parseManual(parts) {
  const [word, reading, meaning, ...rest] = parts;
  return { word, reading, meaning, example: rest.join(' ') };
}

export function userOf(interaction) {
  return interaction.member?.user ?? interaction.user;
}

// 下指令的人：伺服器暱稱 > 顯示名稱 > 使用者名稱
function authorOf(interaction) {
  const user = userOf(interaction);
  const name = interaction.member?.nick ?? user.global_name ?? user.username;
  const iconURL = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
  return { name, iconURL };
}

// D1 的 CURRENT_TIMESTAMP 是 UTC（2026-10-15 06:36:27），轉成台灣日期
function formatTaipeiDate(utc) {
  const taipei = new Date(Date.parse(`${utc.replace(' ', 'T')}Z`) + 8 * 3600_000);
  return taipei.toISOString().slice(0, 10).replaceAll('-', '/');
}

function historyLine(history) {
  if (!history) return '';
  if (history.times === 1) return '🆕 第一次出現';
  return `🔁 第 ${history.times} 次出現（上次 ${formatTaipeiDate(history.lastAt)}）`;
}

export function buildEmbed(
  { word, reading, meaning, english, tags, example, exampleTranslation },
  interaction,
  history,
) {
  const author = authorOf(interaction);
  const meaningText = [meaning || '（查無翻譯）', english && `-# ${english}`]
    .filter(Boolean)
    .join('\n');

  const embed = {
    color: 0xe95464,
    title: word,
    description: [tags ? `**${reading}**　\`${tags}\`` : `**${reading}**`, historyLine(history)]
      .filter(Boolean)
      .join('\n'),
    fields: [{ name: '📖 意思', value: meaningText }],
    footer: { text: `由 ${author.name} 新增`, icon_url: author.iconURL },
    timestamp: new Date().toISOString(),
  };

  if (example) {
    // 例句中出現的單字加粗，方便閱讀
    const highlighted = example.replaceAll(word, `**${word}**`);
    const value = exampleTranslation ? `${highlighted}\n${exampleTranslation}` : highlighted;
    embed.fields.push({ name: '✏️ 例句', value });
  }
  return embed;
}

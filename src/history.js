import { userOf } from './card.js';

// 記錄這次新增，並回傳這是第幾次出現、上次是什麼時候
// 資料庫出錯時回傳 null，不影響卡片本身
export async function recordEntry(env, interaction, entry) {
  const guildId = interaction.guild_id ?? `dm:${userOf(interaction).id}`;
  try {
    const [previous] = await env.DB.batch([
      env.DB.prepare(
        'SELECT COUNT(*) AS count, MAX(created_at) AS last FROM entries WHERE guild_id = ? AND word = ?',
      ).bind(guildId, entry.word),
      env.DB.prepare(
        'INSERT INTO entries (guild_id, word, reading, meaning, user_id) VALUES (?, ?, ?, ?, ?)',
      ).bind(guildId, entry.word, entry.reading, entry.meaning, userOf(interaction).id),
    ]);
    const { count, last } = previous.results[0];
    return { times: count + 1, lastAt: last };
  } catch (err) {
    console.error('記錄失敗', err);
    return null;
  }
}

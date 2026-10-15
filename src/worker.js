import { buildCard, parseManual, splitInput } from './card.js';
import { generateEntry } from './dictionary.js';
import { recordEntry } from './history.js';

// https://discord.com/developers/docs/interactions/receiving-and-responding
const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 };
const ResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE: 4,
  DEFERRED_CHANNEL_MESSAGE: 5,
};

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g), (b) => parseInt(b, 16));
}

// Discord 要求驗證每個請求的 Ed25519 簽章，驗證失敗必須回 401
async function isValidRequest(request, body, publicKey) {
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  if (!signature || !timestamp) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    hexToBytes(publicKey),
    { name: 'Ed25519' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    'Ed25519',
    key,
    hexToBytes(signature),
    new TextEncoder().encode(timestamp + body),
  );
}

// 延遲回應後，用 webhook 把結果補上（不需要 Bot Token）
function editOriginal(env, interaction, payload) {
  const url = `https://discord.com/api/v10/webhooks/${env.DISCORD_APPLICATION_ID}/${interaction.token}/messages/@original`;
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function generateAndReply(env, interaction, parts) {
  try {
    const entry = await generateEntry(parts[0], parts[1], env.AI);
    const history = await recordEntry(env, interaction, entry);
    await editOriginal(env, interaction, buildCard(entry, interaction, history));
  } catch (err) {
    console.error(err);
    await editOriginal(env, interaction, {
      content: `產生失敗：${err.message}\n可以改用手動輸入：\`/add 單字 讀音 意思 例句\``,
    });
  }
}

async function handleAdd(env, ctx, interaction) {
  const text = interaction.data.options?.find((o) => o.name === '內容')?.value ?? '';
  const parts = splitInput(text);

  // 手動輸入完整內容：直接發卡片
  if (parts.length >= 3) {
    const entry = parseManual(parts);
    const history = await recordEntry(env, interaction, entry);
    return Response.json({
      type: ResponseType.CHANNEL_MESSAGE,
      data: buildCard(entry, interaction, history),
    });
  }

  // 只有單字（或單字＋讀音）：先回「思考中」，避免超過 Discord 的 3 秒限制，查完再補上
  ctx.waitUntil(generateAndReply(env, interaction, parts));
  return Response.json({ type: ResponseType.DEFERRED_CHANNEL_MESSAGE });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('ok');

    const body = await request.text();
    if (!(await isValidRequest(request, body, env.DISCORD_PUBLIC_KEY))) {
      return new Response('invalid request signature', { status: 401 });
    }

    const interaction = JSON.parse(body);
    if (interaction.type === InteractionType.PING) {
      return Response.json({ type: ResponseType.PONG });
    }
    if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data.name === 'add') {
      return handleAdd(env, ctx, interaction);
    }
    return new Response('unknown interaction', { status: 400 });
  },
};

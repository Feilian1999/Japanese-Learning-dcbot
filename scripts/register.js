// 向 Discord 註冊 /add 指令，只有新增或修改指令時才需要執行：npm run register
const { DISCORD_TOKEN, DISCORD_APPLICATION_ID, GUILD_ID } = process.env;

const commands = [
  {
    name: 'add',
    description: '新增一個單字卡',
    options: [
      {
        type: 3, // STRING
        name: '內容',
        description: '只打單字會自動產生；或手動輸入：單字 讀音 意思 例句',
        required: true,
      },
    ],
  },
];

// 有 GUILD_ID 就註冊到該伺服器（立即生效），否則註冊為全域指令（可能要等一段時間）
const url = GUILD_ID
  ? `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/guilds/${GUILD_ID}/commands`
  : `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`註冊失敗（${res.status}）：`, await res.text());
  process.exit(1);
}
console.log(`已註冊 /add 指令${GUILD_ID ? '到伺服器 ' + GUILD_ID : '（全域）'}`);

# Japanese Learning Discord Bot

在 Discord 頻道整理日文單字的機器人。輸入 `/add 單字`，自動查出讀音、中文意思、例句，排成一張好讀的單字卡，並記錄這個字出現過幾次。

部署在 Cloudflare Workers 免費方案，不需要一直開著電腦，也不用付費 API。

## 用法

| 輸入 | 結果 |
|---|---|
| `/add 控え室` | 自動查出讀音、意思、例句 |
| `/add 控え室 ひかえしつ` | 讀音用你給的，其餘自動查 |
| `/add 控え室 ひかえしつ 休息室 控え室で待ってください。` | 完全照你輸入的內容發卡片 |

- 各段之間用半形或全形空白分隔
- 輸入平假名也可以，例如 `/add たべる` 會自動找到 `食べる`

單字卡範例：

```
┃ 控え室                                  ← 大標題
┃ ひかえしつ　[N1]　[名詞]                ← 等級、詞性是小標籤
┃ ──────────────────────────
┃ 等候室
┃ waiting room; anteroom; antechamber; green room
┃ ──────────────────────────
┃ ここはお客様用の控え室です。
┃ 這是顧客的等候室。
┃ ──────────────────────────
┃ 🔁 第 2 次出現（上次 2026/10/15）・由 Allen 新增
```

卡片使用 Discord [Components V2](https://docs.discord.com/developers/components/reference) 排版：左側粉色邊條、單字放大、意思與例句用分隔線分區。

## 資料來源

全部使用免費、不需要 API Key 的服務：

| 欄位 | 來源 |
|---|---|
| 讀音、JLPT 等級、詞性、英文解釋 | [Jisho](https://jisho.org)（JMdict 字典） |
| 中文意思 | [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)（Qwen3）參考字典的英文詞義整理；失敗時改用 Google 翻譯 / [MyMemory](https://mymemory.translated.net) |
| 例句與例句翻譯 | [Tatoeba](https://tatoeba.org) 開放例句庫；沒有繁中翻譯時用機器翻譯 |

Workers AI 免費額度每天 10,000 Neurons，查一個字約 5 Neurons（每天約 2000 個字）。中文意思由 AI 整理，偶爾不夠精準，建議對照英文解釋。

## 運作方式

```
Discord ──(/add 指令)──▶ Cloudflare Worker ──▶ Jisho / Google 翻譯 / Tatoeba
                               │
                               ├──▶ Workers AI（整理中文意思）
                               └──▶ D1 資料庫（記錄出現次數）
```

機器人不使用常駐連線，而是由 Discord 在有人下指令時呼叫 Worker 的網址（[Interactions Endpoint](https://discord.com/developers/docs/interactions/receiving-and-responding)）。自動查詢需要幾秒，所以會先回覆「思考中」，查完再補上單字卡。

## 部署

需要 Node.js 18 以上、[Discord](https://discord.com/developers/applications) 帳號和 [Cloudflare](https://dash.cloudflare.com/sign-up) 帳號（免費，不用綁卡）。

### 1. 安裝

```bash
git clone https://github.com/Feilian1999/Japanese-Learning-dcbot.git
cd Japanese-Learning-dcbot
npm install
npx wrangler login
```

### 2. 建立 Discord 應用程式

到 [Discord Developer Portal](https://discord.com/developers/applications) 按 **New Application**，記下：

- **General Information** → `Application ID`、`Public Key`
- **Bot** → 按 **Reset Token** 取得 `Token`（只會顯示一次，不要公開）

### 3. 建立資料庫

```bash
npx wrangler d1 create discord-japanese-bot
```

把顯示的 `database_id` 填進 `wrangler.toml`，然後建立資料表：

```bash
npx wrangler d1 migrations apply DB --remote
```

### 4. 部署 Worker

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY      # 貼上 Public Key
npx wrangler secret put DISCORD_APPLICATION_ID  # 貼上 Application ID
npm run deploy
```

第一次部署會要求設定 workers.dev 子網域（只能用小寫英文、數字和 `-`）。

### 5. 設定 Interactions Endpoint

把部署後顯示的網址（`https://discord-japanese-bot.<子網域>.workers.dev`）貼到 Developer Portal → **General Information** → **Interactions Endpoint URL**，按 **Save**。

### 6. 邀請機器人

Developer Portal → **OAuth2** → **URL Generator**，Scopes 勾選 `applications.commands`，用產生的網址把機器人加入伺服器。

### 7. 註冊指令

```bash
cp .env.example .env   # 填入 DISCORD_APPLICATION_ID、DISCORD_TOKEN、GUILD_ID
npm run register
```

> 必須先完成第 6 步，否則會出現 `403 Missing Access`。
>
> `GUILD_ID` 取得方式：Discord 設定開啟「開發者模式」，在左側伺服器圖示按右鍵 →「複製伺服器 ID」。不填則註冊為全域指令，可能要等一段時間才會出現。

## 開發

| 指令 | 用途 |
|---|---|
| `npm run deploy` | 修改程式後重新部署 |
| `npm run register` | 新增或修改指令定義後重新註冊 |
| `npx wrangler tail` | 即時查看線上的 log 與錯誤 |
| `npm run dev` | 本機啟動 Worker（需要 `.dev.vars` 設定 `DISCORD_PUBLIC_KEY`、`DISCORD_APPLICATION_ID`） |

修改資料表時，在 `migrations/` 新增 SQL 檔，再執行 `npx wrangler d1 migrations apply DB --remote`。

## 專案結構

```
src/
  worker.js       接收 Discord 請求、驗證簽章、回覆
  card.js         解析輸入、排版單字卡
  dictionary.js   查字典、翻譯、找例句
  history.js      記錄並統計單字出現次數
scripts/
  register.js     向 Discord 註冊 /add 指令
migrations/       D1 資料表結構
wrangler.toml     Cloudflare Worker 與資料庫設定
```

## 注意事項

- `.env` 含有 Bot Token，已列在 `.gitignore`，請勿提交
- Google 翻譯使用的是非官方免費端點，可能隨時失效，失效時會自動改用 MyMemory
- Cloudflare 免費方案每天 10 萬次請求、D1 每天 10 萬次寫入，個人使用足夠

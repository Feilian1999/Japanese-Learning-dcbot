# Japanese Learning Discord Bot

在 Discord 頻道整理日文單字的機器人。輸入 `/add 單字`，自動查出讀音、中文意思、例句，排成一張好讀的單字卡，並記錄這個字出現過幾次。

部署在 Cloudflare Workers 免費方案，不需要一直開著電腦，也不用付費 API。

## 用法

| 輸入 | 結果 |
|---|---|
| `/add 控え室` | 自動查出讀音、意思、例句 |
| `/add 控え室 ひかえしつ` | 第二段是假名 → 當讀音，其餘自動查 |
| `/add てまぬい 月村手毬` | 第二段不是假名 → 當意思，其餘自動查（適合人名、暱稱等字典沒收錄的字） |
| `/add 控え室 ひかえしつ 休息室 控え室で待ってください。` | 完全照你輸入的內容發卡片 |

- 各段之間用半形或全形空白分隔
- 輸入平假名也可以，例如 `/add たべる` 會自動找到 `食べる`
- 出現次數以伺服器為單位，不論誰輸入都算在一起

單字卡範例：

```
┃ 控え室                                  ← 大標題
┃ ひかえしつ　[N1]　[名詞]                ← 等級、詞性是小標籤
┃ ──────────────────────────
┃ 等候室；休息室；更衣室
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
| 讀音、詞性、英文解釋 | [Jotoba](https://jotoba.de)（JMdict 字典） |
| 字典沒收錄的字 | 以完全相同的標題查[日文維基百科](https://ja.wikipedia.org)（含重新導向），由 Workers AI 依條目摘要解釋，卡片標示「📚 參考維基百科」；查不到則顯示「字典查無此字」，不讓 AI 猜測 |
| JLPT 等級 | 內建對照表，來自 [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)（MIT），原始資料為 [Jonathan Waller 的 JLPT 單字表](https://www.tanos.co.uk/jlpt/)，N5～N1 約 8000 字 |
| 中文意思 | [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)（Qwen3）參考字典的英文詞義整理；失敗時改用 Google 翻譯 / [MyMemory](https://mymemory.translated.net) |
| 例句 | 依序嘗試：[Tatoeba](https://tatoeba.org) 開放例句庫 → [Jotoba](https://jotoba.de) 例句（可找到動詞變化）→ [Massif](https://massif.la)（網路文章例句，收錄最廣） |
| 例句翻譯 | Tatoeba 的真人繁中翻譯；沒有時由 Workers AI 翻譯（附上真人英文 / 簡中翻譯當參考），失敗時改用 Google 翻譯 → MyMemory |

> 原本使用 [Jisho](https://jisho.org)，但從 Cloudflare Workers 連線一律回應 525，因此改用同樣以 JMdict 為資料來源的 Jotoba。Jotoba 不提供 JLPT 等級，所以改用內建的對照表，送假名寫法不同（控え室 / 控室）也對照得到。

Workers AI 免費額度每天 10,000 Neurons，查一個字（中文意思＋例句翻譯）約 10 Neurons（每天約 1000 個字）。中文意思由 AI 整理，偶爾不夠精準，建議對照英文解釋。

## 技術架構

```
你在 Discord 輸入 /add
      ↓
Discord ──呼叫──▶ Cloudflare Worker（workers.dev 網址）
                     ├─▶ Jotoba（字典）／ 日文維基百科（字典沒收錄的字）
                     ├─▶ Workers AI（中文意思）
                     ├─▶ Tatoeba / Jotoba / Massif（例句）
                     ├─▶ Google 翻譯（例句翻譯）
                     └─▶ D1（記錄次數）
      ↓
單字卡出現在頻道

你的電腦 ──(npm run deploy)──▶ Cloudflare
你的電腦 ──(git push)──▶ GitHub
```

機器人不使用常駐連線（Gateway），而是由 Discord 在有人下指令時呼叫 Worker 的網址（[Interactions Endpoint](https://discord.com/developers/docs/interactions/receiving-and-responding)）。因此可以放在免費、不休眠的 Cloudflare Workers 上，代價是機器人在成員列表會顯示離線（功能不受影響），也無法讀取一般訊息。

每次 `/add` 的處理流程：

1. 驗證請求的 Ed25519 簽章，確認來自 Discord
2. 先回覆「思考中」，避免超過 Discord 的 3 秒回應限制
3. 查 Jotoba 取得讀音、詞性、英文解釋
4. 請 Workers AI 參考英文詞義整理中文意思
5. 依序從 Tatoeba、Jotoba、Massif 找例句並翻譯
6. 寫入 D1，計算這個字在伺服器中第幾次出現
7. 把「思考中」替換成單字卡

### 部署平台

| 服務 | 用途 | 免費額度 |
|---|---|---|
| [Discord Developer Portal](https://discord.com/developers/applications) | 建立機器人、取得 Token 與金鑰、設定 Interactions Endpoint、產生邀請網址 | 免費 |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/) | 機器人本體，接收 `/add` 並回覆單字卡 | 每天 10 萬次請求 |
| workers.dev | Cloudflare 提供的免費網址，讓 Discord 呼叫 Worker | 免費 |
| [Cloudflare D1](https://developers.cloudflare.com/d1/) | 資料庫，記錄查過的單字與次數 | 每天 10 萬次寫入 |
| [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) | 以 Qwen3 整理中文意思、翻譯例句 | 每天 10,000 Neurons（約 1000 個字） |
| [GitHub](https://github.com) | 保存程式碼與修改紀錄 | 免費 |

### 開發工具

| 工具 | 用途 |
|---|---|
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | Cloudflare 的指令工具：部署、設定 secret、建立資料庫、查看即時 log |
| Node.js / npm | 執行 Wrangler 與註冊指令的腳本 |

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
| `npm run build:jlpt` | 重新下載 JLPT 單字表並產生 `src/jlpt-data.js` |
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
  jlpt.js         查詢 JLPT 等級
  jlpt-data.js    JLPT 對照表（由 scripts/build-jlpt.js 產生）
scripts/
  register.js     向 Discord 註冊 /add 指令
  build-jlpt.js   產生 JLPT 對照表
migrations/       D1 資料表結構
wrangler.toml     Cloudflare Worker 與資料庫設定
```

## 注意事項

- `.env` 含有 Bot Token，已列在 `.gitignore`，請勿提交
- Google 翻譯使用的是非官方免費端點，可能隨時失效，失效時會自動改用 MyMemory
- Cloudflare 免費方案每天 10 萬次請求、D1 每天 10 萬次寫入，個人使用足夠

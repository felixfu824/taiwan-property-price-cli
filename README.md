# tw-lvr-cli — 台灣實價登錄 CLI

[![npm version](https://img.shields.io/npm/v/tw-lvr-cli.svg)](https://www.npmjs.com/package/tw-lvr-cli) [![license](https://img.shields.io/npm/l/tw-lvr-cli.svg)](./LICENSE) [![node](https://img.shields.io/node/v/tw-lvr-cli.svg)](https://nodejs.org)

**低 context 佔用的實價登錄查詢 CLI。** 把內政部最新的逐棟成交，整理成乾淨的 JSON／CSV 寫到磁碟，不佔用 LLM 的 context——給 agent、app、腳本使用；並隨附 `SKILL.md`，打包成 Claude／Codex 相容的 plugin。

> 只想查一間房？用 591 / 樂居就好——免費、UI 好、已清洗。tw-lvr-cli 補的是另一塊空缺：**能被程式／app／agent 直接吃的乾淨即時實價資料。**

[English summary ↓](#english) · [完整英文版 README → README.en.md](./README.en.md)

---

## 核心價值：低 context 佔用 × 高穩定性

讓 agent、app 或腳本**一次查數千到上萬筆交易**，模型的 context 幾乎不受影響。四個設計撐起這件事：

**① 結果留在磁碟，不經過 context**
`--out` 把整區成交一次寫進檔案，再用 `--top N` 或 jq／grep 取你要的幾列，資料完全不經過模型的 context。

**② 形態：CLI + library + 可攜 Skill，免架 server**
未呼叫時完全不佔 context；Skill 平時只有名稱與描述常駐，需要時才載入內文。也能直接 `import` 進 web 後端、CI 或 cron。

**③ 效能與穩定性：確定且可重現**
相同查詢永遠得到相同結果，約 **2 秒／查詢**（端到端，含啟動）。邏輯都寫在程式裡，不靠模型在迴圈中開瀏覽器（慢、不穩定、token-hungry）。

**④ 輸出：乾淨、結構化的 JSON／CSV**
輸出就是可直接程式處理的結構化資料。

---

## 功能範圍（相對於自己上實價登錄官網）

官網免費、資料最完整，適合人用瀏覽器查單一物件。tw-lvr-cli 不取代官網，而是把官網上「人工、一次一筆、看網頁」的流程，換成「下指令、拿乾淨結構化資料、可批次、可被程式呼叫」。

| 自己上官網能做 | tw-lvr-cli 多給你 |
|---|---|
| 一次查一組條件，看網頁表格 | 一行指令拿到乾淨 JSON／CSV |
| 人工複製 | 直接 `--out` 寫檔，可進 pipeline |
| 無批次：整區要一頁頁翻 | 整個行政區一次取得、寫檔 |
| 只能人點，無法程式化 | 可被腳本／agent／後端呼叫 |

**目前涵蓋：** 買賣查詢（成屋）、預售屋查詢。**尚未支援：** 租賃查詢、預售屋建案查詢（兩者資料結構不同，列為後續）。

---

## 輸出範例

查新竹科學園區一帶（關埔重劃區）關新路最近 3 筆成交：

```bash
tw-lvr extract --where "新竹市東區關新路" --from 2024 --to 2026 --top 3 --pretty
```

`--top 3`：只回最近的 3 筆，**最新一筆永遠排在最上面**（想看全部就拿掉這個參數）。輸出（欄位節錄；完整欄位見 `tw-lvr glossary`）：

```json
[
  {
    "building": "丹麥",
    "address": "新竹市關新路19巷99號二樓",
    "txnDateRoc": "114/12/27",
    "totalPriceWan": 2380,
    "siteAdjUnitPrice": 48.1445,
    "totalAreaPing": 49.43,
    "layout": "3房2廳2衛"
  },
  {
    "building": "北歐",
    "address": "新竹市關新路19巷3號十二樓",
    "txnDateRoc": "114/12/27",
    "totalPriceWan": 3930,
    "siteAdjUnitPrice": 45.6988,
    "totalAreaPing": 86,
    "layout": "4房2廳2衛"
  },
  {
    "building": "月影",
    "address": "新竹市關新路29號十二樓之33",
    "txnDateRoc": "114/12/14",
    "totalPriceWan": 1050,
    "siteAdjUnitPrice": 53.3028,
    "totalAreaPing": 19.7,
    "layout": "1房1廳1衛"
  }
]
```

加 `--refine` 會再附上排除旗標（親友／純車位／非住宅）與每筆 `confidence`；加 `--out result.json` 則直接寫檔、完全不進 context。

## 當 plugin 用（Claude Code & Codex）

plugin 內含一份 Agent Skill（`skills/tw-lvr-cli/SKILL.md`，採開放 Agent Skills 標準）當「指令層」——告訴 agent 何時、如何呼叫 `tw-lvr`；真正幹活的是 `tw-lvr` CLI。裝好 plugin 直接試跑即可：SKILL.md 會在 agent 首次呼叫時引導它自行安裝 CLI（`npm i -g tw-lvr-cli` 或 `npx`）與瀏覽器。

**Claude Code：**
```
/plugin marketplace add felixfu824/tw-lvr-cli
/plugin install tw-lvr-cli@tw-lvr-cli
```

**Codex：**
```bash
codex plugin marketplace add felixfu824/tw-lvr-cli
codex plugin add tw-lvr-cli@tw-lvr-cli
```

---

## 當 CLI 用

**1. 安裝**

```bash
npm i -g tw-lvr-cli                               # 或 bun add -g tw-lvr-cli
npx playwright install chromium-headless-shell    # 必裝——唯一的非 JS 依賴（約 190MB）
```

`chrome-headless-shell` 為必裝；缺了會以 exit code `6`（`ERR_ENV`）結束並印出安裝指令。不想裝全域 CLI，也可用 `npx -y tw-lvr-cli@latest extract ...` 直接試跑（仍需先裝瀏覽器）。

**2. 指令**

```bash
tw-lvr extract --where "台北市信義區松德路169巷" --from 2024 --to 2026 --refine --pretty
tw-lvr extract --where "新北市板橋區文化路一段" --from 2023 --to 2026 --out transactions.csv
tw-lvr extract --where "苗栗縣竹南鎮" --from 2026 --to 2026 --presale --community "藏富天下"

tw-lvr glossary       # 解釋每個輸出欄位、來源與公式
tw-lvr --help / --version
```

完整參數：
```
tw-lvr extract --where <地址> --from <YYYY> --to <YYYY>
               [--refine] [--ptype 1,2] [--query biz|sale | --presale]
               [--top N | --limit N] [--community <社區名>]
               [--out <檔案|資料夾>] [--format json|csv] [--pretty]
```
- 預設 `--query biz`（成屋買賣）；`--presale` 切到預售屋。
- **讓資料不進 context**：超過幾列就用 `--out` 寫檔，再讀回需要的片段。
- 大範圍／長年期請分段（每次 ≤5 年）；單次回應過大會以 `ERR_NETWORK` 失敗。
- exit code：`0` 成功/無資料 · `2` 輸入錯誤 · `3` 網站改版 · `4` 網路 · `5` 被限流 · `6` 環境/瀏覽器 · `7` 部分成功。
- 從原始碼開發：`bun install && bun run build`，再用 `node dist/cli.js extract ...`。
- 想程式化呼叫？同一顆引擎可直接 `import`（`extract` / `extractRefined`，型別見 `src/index.ts`）。

---

## 架構

```
Resolve → Fetch → Normalize → Refine
```
- **Resolve**：把人類可讀的地址與年份解析成政府網站的查詢參數。
- **Fetch**：啟動短暫的 headless Chromium，依網站載入流程擷取原始 `QueryPrice` 交易列。
- **Normalize**：把政府原始列轉成乾淨、帶型別的 `CleanRawRecord`——統一欄位名稱、單位（坪／萬元）、民國日期，不做主觀判斷。
- **Refine**（加 `--refine` 才有）：在 Clean Raw 之上加網站顯示的調整後單價、排除旗標（親友／純車位／非住宅）與 `confidence`。

---

## 資料與授權

- **資料**：內政部不動產實價登錄開放資料，採**政府資料開放授權條款（OGDL，可轉 CC BY 4.0）**；**須標示來源為內政部**；資料依法去識別化（平均地權條例 §47），請勿嘗試重新識別。
- **程式碼**：Apache-2.0（見 `LICENSE` 與 `NOTICE`）。
- 與內政部無任何關係；本工具按現狀提供，不負擔保責任。

---

## <a id="english"></a>English

**tw-lvr-cli** is a **low-context-footprint CLI for Taiwan's real-price registry (內政部實價登錄), packaged with a portable Agent Skill (`SKILL.md`) as a Claude/Codex-compatible plugin** — it turns the latest building-level transactions into clean JSON that stays on disk, out of the model's context, so an agent can pull a whole district without bloating its context. It also works as an importable TypeScript library + CLI — no server to host. Deterministic by design — the same query always returns the same result, fast (~2s/query), with clean JSON/CSV output.

→ **Full English README: [README.en.md](./README.en.md)**

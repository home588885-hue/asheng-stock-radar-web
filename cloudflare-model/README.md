# 阿勝底部起漲雷達：S 盤後資料、C 完整選股遷移

**狀態：部分已準備，尚未切換任何生產環境選股路由。**

## 目標分工

- **Supabase (S)**：保留 xiang-che.com、LINE、登入和持股紀錄。股票部分的最終工作應縮小為**既有受保護盤後更新**，產出可重用的日K/籌碼/營收輸入；不再負責完整選股計算。
- **Cloudflare (C)**：以完整歷史 K 棒和盤後基本面/籌碼資料，計算 MA10／MA20／MA60、KD、MACD、現有 A/B/C/V5、首根、回踩、風險、防追高與持股判斷，處理三區盤中報價。結果需儲存於 C 的資料庫/物件儲存，並可提供既有前台讀取。
- **硬性安全條件**：網站和 LINE 優先；不動現有選股門檻及 MA20 出場規則；不得把 C 初篩或技術基礎直接當作正式買點；不得多設自動排程；不得提高股票在 S 的受保護用量。

## 現有真實障礙

1. S 的 `spring-swallow-analyze` 目前向 FinMind 直接抓取約四年的歷史日K，並在函式內計算模型。S 公開資料表只有 `spring_swallow_scan_results` 等結果，**沒有**完整、可逐根供 C 計算的股票歷史 K 線表。不可假裝從結果欄位能反推出完整模型。
2. S 模型還使用月營收、法人、融資融券及歷史回測。若直接搬移全模型需建立 C 原始資料供應、cache / KV / R2 / D1，並對照每檔輸出。初篩只提供單日 OHLCV，**不能**完整計算以上指標。
3. Cloudflare Workers Free 每請求 **10 毫秒 CPU**，有每日 **100,000** 請求額度。完整四年資料加回測的 CPU、FinMind 額度及資料容量均未驗證；不可直接宣稱免費版可完整跑全市場。
4. GitHub 專案 **public**。不得將任何 FINMIND_TOKEN、Supabase service_role、Cloudflare secret、登入 JWT 或後台私密資料加入 GitHub；完整專有策略建議改由**私人原始碼倉庫**管理。
5. 本會話沒有 Cloudflare 帳戶的正式部署與 D1/R2 綁定工具；GitHub 提交不等於 Cloudflare Worker 已部署。

## 已建立的 C 技術基礎 Worker（無正式接入）

- `cloudflare-model/src/index.js`：獨立 `asheng-model-engine` Worker。提供 `GET /health` 與 `POST /technical-basis`；只處理單檔 260～1200 根已取得的完整日K。
- `/technical-basis` 需要 Cloudflare Secret `MODEL_INPUT_KEY`（至少 32 字元），未設定則拒絕。**絕不可把這個 Key 放在 HTML、GitHub 或使用者裝置。**
- 只計算 MA10/20/60、KD、MACD 和既有 K 棒風險基礎；明確回傳 `model_complete:false` / `actionable:false`，不計算完整 A/B/C、V5、籌碼或持股策略。**現在不可以用於交易或替代 S。**
- 原 S 2026-10-06 K 棒風險基礎公式，對 340 根人工資料的同樣輸入，已逐欄一致；這不代表真實 2,142 檔全數驗證，亦未量測 C CPU。
- `cloudflare-model/wrangler.toml` 無 Cron；沒有自動更新、沒有 S 寫入、沒有新增月費或修改既有 C 報價 Worker。
- 新 Worker 尚未實際部署；需要透過 Cloudflare 設定 Secret 和必要的持久化環境。此時所有雷達正式頁面仍繼續讀取舊 S 模型資料。

## 真正讓「S 只做盤後更新」生效前的驗收條件

- 日K初次歷史補齊、每天增量與缺資料自動偵錯可用；S 不需要在新架構下每檔反覆重新抓 4 年資料。
- 籌碼、營收、法人、融資融券按更新時間低耗量補齊，不超過內部保護額度。不能影響房產網站與 LINE 的 Edge / Egress / Postgres 用量。
- C 產生完整股票模型訊號，逐檔與既有 S 模型同日對照：分數、階段、第一根／回踩、風險降級、持股動作、來源日全部一致；結果不能只比較幾個均線。
- C Free CPU 10ms / 請求及 FinMind rate limit 實際通過，否則需重新拆分批次或詢問使用者是否接受成本，不能自行升級付費。
- 管理員與會員權限、個別持股私密性與正式頁面穩定性全部驗證，禁止臨時讓會員看到管理員已買進。
- **通過後**才把正式前台選股請求指向 C 的已驗證資料讀取 API；回退時仍可讀 S 舊快照但不得額外重掃。
- **絕對不會**為遷移而先停用網站／LINE 的 S Project、抬高 S 股票月額度，或自行增加任何排程。

## 操作邊界

- 此提交為新 C 引擎準備，不更動正式雷達運作的 JS 進場策略、會員持股或 Supabase 函式。
- 目前的 C 官方盤後價量初篩只是觀察預覽；與這個 C 完整模型遷移是不同層級。

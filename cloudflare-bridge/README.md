# 阿勝行情通道｜Cloudflare Worker

## 目前狀態
- GitHub 專用分支：`cloudflare-market-bridge-setup-20261010`
- Cloudflare Worker：`asheng-market-bridge`（Wrangler 根目錄 `cloudflare-bridge/`）
- `GET /health`：檢查目前實際部署版號與服務狀態，不能只憑 GitHub 提交判定已部署。
- `GET /quotes?symbols=2330:tse,2317:tse`：沿用原 Supabase `asheng-live-quotes` 的 TWSE MIS 取價格式，最多 30 檔。
- `/quotes` 必須使用目前管理員登入的 Supabase JWT（`Authorization: Bearer ...`），Worker 透過既有 `asheng-member-api?action=me` 確認 admin 且 active。會員不能使用，JWT 不寫入 GitHub 或網址。無效權限一律回 401。
- 台北交易日有效成交價與量才標 `has_today_trade:true`。不拿昨收、買價、賣價或休市資料冒充即時成交。
- 管理員專屬 `admin.html` 的 Cloudflare 行情連接與既有選股 UI 適配已放入相同測試分支。**`MARKET_BRIDGE_URL` 目前留空**，未核實 Worker 正式網址以前不會切掉 Supabase。
- 管理員候選改為每 180 秒低頻取價（只有 Cloudflare 連線設好且交易時段有效才啟用）；不新增盤後掃描。既有 MA10／MA20／MA60 模型、風險規則、夜間補掃、持股與會員頁不變。
- 既有盤後模型快照仍在 Supabase；FinMind 等歷史資料 API 不在這次 MIS 報價移轉範圍。不要對外宣稱全市場盤中重掃或完整脫離 Supabase。

## 上線驗證關卡
1. 確認 Cloudflare Worker Git 分支與 Root directory `cloudflare-bridge`，部署 commit 與 `/health.deployment_marker` 一致。
2. 取得 Cloudflare 實際 `https://<worker>.<account>.workers.dev` URL，測試 401／允許管理員登入／拒絕會員／09:00～13:30 有效成交資料。
3. 在 `admin.html` 設定已驗證的 Worker 正式 URL，確認管理員三區顯示盤中價格、模型基準與報價時間，沒有舊價當新價。
4. 實際測試成功後再合併管理員改動到 `main`；不可替換 `member.html`、夜間選股或其他專案。
5. 比對 Supabase `asheng-live-quotes` 請求減少情況與 Cloudflare 免費額度。沒有確切結果不宣稱流量已節省。

注意：原有服務保持運作。資料取得方式仍應符合來源使用規範，技術可呼叫與使用授權是兩件事。

# 阿勝 Cloudflare 行情中轉（安全測試版）

## 狀態
目前僅提供 Cloudflare Worker 的 **/health** 健康檢查，並不呼叫證交所 MIS，也不連接 Supabase。此專案準備在證交所確認 **個人程式化行情資料的授權及可接受使用條件** 後，才可能啟用 /quotes。

## 啟動測試
Cloudflare Workers 中 Worker 名稱使用 `asheng-market-bridge`。
經由 Wrangler 或控制台部署 `src/index.js`。
開啟 Worker 的 `/health`，預期取得 `status:standby` 與 `twse_mis_enabled:false`。
呼叫 `/quotes` 應回 HTTP 503，且絕不輸出看似最新的舊報價。

## 後續整合要求
- 先取得並遵守 MIS / 授權供應商的個人非揭示用途、雲端中轉和請求量限制。
- 先實際驗證新通道資料品質及時間戳，再讓管理員前台在新通道與舊通道間選擇。
- 不能在公開 GitHub 存放 API 金鑰、個人持股清單、掃描模型和服務角色金鑰。
- 不擴大或修改三區選股規則、MA10/MA20/MA60 模型和持股資料。
- 未經測試成功，不停用現有 Supabase `asheng-live-quotes`。
- 只限個人使用；不要把原始行情開放給會員。

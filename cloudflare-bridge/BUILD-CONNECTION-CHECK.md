# Cloudflare Workers Builds 連線測試

- 目的：在設定 GitHub 連線與 Build watch paths = `cloudflare-bridge/**` 後，觸發首次建置。
- 安全方式：Worker Deploy command 應為 `npx wrangler versions upload --config cloudflare-bridge/wrangler.toml`，只上傳 Worker 版本、不啟用流量。
- 正式 `asheng-market-bridge` 仍維持原本運行版本；須在 Cloudflare 部署紀錄確認 Upload 成功及版本來源，才決定是否啟用。
- 本檔無憑證、無選股機密、無新排程、無 Supabase 請求。
- C 完整 A/B/C、V5、籌碼、持股模型 **尚未部署**；請勿將報價橋接程式誤認為完整模型。

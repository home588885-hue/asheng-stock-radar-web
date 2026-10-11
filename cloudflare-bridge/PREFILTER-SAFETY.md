# Cloudflare 盤後價量初篩｜獨立測試與房產/LINE保護

更新日期：2026-10-11。**本分支未部署到正式 Cloudflare Worker，正式管理員頁也未啟用初篩。**

## 設計硬性限制

1. 房產網站 xiang-che.com、LINE 自動對話、Supabase 房產物件同步，**全部不得修改**。
2. 不修改或覆蓋現有 MA10/20/60、KD、MACD、籌碼、第一根、防追高及 MA20 持股模型。
3. C 初篩與 S 盤後模型分離；本版**零 S 掃描請求、零資料庫寫入**（僅沿用既有 admin 身分驗證 API，可能產生一次 S 驗證讀取）。
4. 不新增排程、不增加 S 的 21:00～21:55 掃描頻率、不動 S 保護額度/網站/LINE/持股/會員頁。
5. 不將初篩股視為可試單、正式買點或已通過完整模型。未覆蓋全市場時必須顯示不完整。
6. 遇資料來源異常、HTTP 403/5xx、逾時、上市或上櫃資料有缺失、CPU 超限、交易日不一致，停止初篩啟用，**絕不能轉由 S 全市場補抓**。

## 預備測試路由

- `GET /eod-prefilter?market=tse`：上市官方最新盤後行情 `openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL`。
- `GET /eod-prefilter?market=otc`：上櫃官方最新盤後行情 `www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes`。
- 每次僅處理一個市場的批次資料，以免超過 Workers Free 的 10ms CPU 限制；僅管理員 Supabase JWT 可用。
- 股票類型只看四位數非零開頭普通股代號，初篩最低成交量 1,000 張；回傳最新有效資料日、來源總筆數、合格股票數、最多 120 筆預覽（有 `result_capped` 標記）。
- 使用 Cloudflare Cache API 30 分鐘降低官方來源請求；無 Cron 或背景自動重抓。
- **尚未驗證 TPEX 能從 Cloudflare Worker 正常取得資料，亦未驗證 10ms CPU 內可完成大批次 JSON 解析；本功能不能上正式線。**

## 部署前的硬性驗收

- 確認 TWSE/TPEX API 回應格式、連續不同交易日的日期、上市上櫃覆蓋數及資料授權。若單市場無法成功，不能宣稱全市場涵蓋完成。
- Cloudflare 端實測 CPU、429/403/5xx、快取命中與每日呼叫數。若常超過免費版 CPU 10ms，禁止正式切換或意外升級付費。
- 未登入與會員身份回 401；只有管理員可讀。不得公開持股、會員、JWT 或權限資料。
- 驗收初篩至少包含「未通過流動性門檻」和「突破第一根」的歷史對照案例，確保高品質候選未遭過度刪減。
- **原理上無法用當日 OHLCV 完全替代 60 日均線與 KD/MACD。** 若要 C 真正將全市場初篩排序後送少量 S 深度分析，必須先解決歷史日 K 資料和安全寫入通道，並在隔離環境比對原 S 模型。
- 盤中既有 `GET /quotes` 路由完全不變；實測 `/health`、`/quotes` 及三區畫面都無回歸。
- **當前 S 與房產/LINE 共用 Supabase 專案資源**。即使股票有內部 invocation 節流額度，也不能保證 S 的官方 Edge/Egress/資料庫實際額度。要達到真正的專案級資源隔離，日後需另行評估分專案及帳單，未經屋主授權不做。
- 沒通過上述任何一項：保持 S 盤後與現有三區正常運作，切勿擴大 S 股票請求數。

## 還原與上線狀態

- 本次只寫入 `cloudflare-prefilter-safe-20261011` 分支，不合併 `main`。
- 尚未透過 Cloudflare 儀表板或 API 部署；C 正式 Worker 仍是既有行情路由。
- 回退方式：不部署本分支即可；既有正式三區與房產、LINE 無須回退。

# vNext 正式部署紀錄（2026-10-23）

## 已正式部署、實際驗收

**僅「唯讀 EOD 前瞻驗證層」正式部署到 Supabase；新獲利交易策略沒有部署為買點。**

- Supabase 專案：`qexbtubfoyfsllaiecvv`
- 正式 migration：`20261023023607_asheng_vnext_readonly_eod_shadow_release_20261023`
- 兩個 `private` view：`asheng_vnext_eod_shadow`、`asheng_vnext_eod_shadow_daily`
- 原始 SQL：`diagnostics/vnext-eod-shadow-prod-migration-20261023.sql`
- 驗收 SQL：`diagnostics/vnext-eod-shadow-prod-smoke-20261023.sql`

**實際驗證（2026-10-23）**
- 來源歷史記錄 1,998 筆，最新資料日 2026-10-22，共 367 檔。
- 2026-10-22 EOD: `v5.entry_confirmed` 2 檔、`precision_confirmed` 1 檔、待進場 1 檔；內部 EOD 資料衝突 0 筆。
- 已明確區分 `stage=WATCH` 與 `V5_EOD_PENDING_LIVE`；EOD 條件不等於有 C 授權有效成交、不等於正式可買。
- 所有歷史 view 記錄 `buy_authorized=false`、`strategy_switch_authorized=false`、`interface_change_authorized=false`，違反 0 筆。
- 0050 大盤驗證與新成長波動模型不具備完整即時資料，在 view 中固定 `NULL`，絕不假造已通過。
- 僅 `service_role` 可查詢，`anon`、`authenticated` 無讀取權限；兩個 view 均為 `security_invoker=true`。無新的 API 暴露。
- 透過既有 `public.spring_swallow_scan_results` 讀取，因此只有原掃描器下一次正常更新後才有新的日資料，**未新增觸發器、排程、掃描、實時行情請求或重複寫入**。
- 2026-10-23 收盤前沒有新的「凍結後 EOD」記錄，故前瞻合格數為 0。不能用歷史回測冒充真正的前瞻盈利證據。
- 正式 GitHub Pages `main`、`admin.html`、即時 Edge Functions、原三區 UI、持股成本及 -5/+5/+10 交易規則均未變動。

**不能直接正式切換 vNext 交易核心的原因**：先前 2026 年 97 檔不同股票樣本、保守滑價及真實交易路徑研究未通過。正式買進策略升級仍被證據閘門阻擋，這是避免虧損策略推到正式買點，不是環境故障。

**回復方式（預留，不執行）**：若未來需要回退唯讀驗證層，只能在受控 migration 先 `DROP VIEW private.asheng_vnext_eod_shadow_daily;`，再 `DROP VIEW private.asheng_vnext_eod_shadow;`。兩者都不會動到基礎表，未要求回退前不應執行。

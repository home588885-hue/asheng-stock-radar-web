# vNext 安全正式部署：掃描涵蓋率校正 + 前瞻樣本封存（2026-10-23）

**已實際部署到正式 Supabase，尚未發布新買點交易核心。原來三區版面不變。**

## 關鍵漏洞與修正

原 `spring_swallow_scan_results` 以 `stock_id` 為主鍵，僅保留每檔最近一筆掃描，**不是每天完整股票市場的歷史資料**。2026-10-22 active master=2,132檔，但同日回傳367檔（17.21%）。當日 400次既有 EOD 嘗試：367 written、3 failed、30 claimed。先前 view 用日資料>=100筆作前瞻完整覆蓋認定不正確。

正式已修補：
- migration `asheng_vnext_shadow_rotating_coverage_failclosed_20261023`
- `private.asheng_vnext_eod_shadow` 的 `forward_data_eligible` **只有真的遍歷所有 active master 股票且收盤時間與版本都通過才可能 true**。
- 新私有 `private.asheng_vnext_eod_coverage_audit` 提供 active universe、掃描覆蓋率與當前每股 EOD 嘗試狀態，明示 `per_stock_latest_only=true`、`append_only_daily_history_available=false`、`proof_of_future_profit=false`。
- QA `diagnostics/vnext-eod-shadow-coverage-prod-regression-20261023.sql` 查41個已知日期，全部屬部分掃描；不安全的「假完整市場」0筆；3個私有 view 權限與 `security_invoker` 合格。

## 不新增掃描、版面或排程的前瞻資料保全

因為最新股票資料會覆寫舊記錄，要取得**真正日後才產生的 EOD 訊號**，已用 migration `asheng_vnext_sampled_eod_future_archive_safe_20261023` 啟用唯一**輕量、fail-open**寫入鏈：

- 新 `private.asheng_vnext_sampled_eod_archive`，主鍵 `(as_of,stock_id)`，只存2026-10-23以後成功讀取的收盤後股票樣本，保留原始 EOD 的時間、版本、V5確認狀態、來源摘要、metrics 雜湊。缺少V5欄位即當 false，不忽略負樣本。
- 利用現有 `spring_swallow_scan_results` 的 AFTER INSERT/UPDATE，只寫每股/每日**第一次**合格EOD樣本；ON CONFLICT DO NOTHING，已存的樣本不被同日修改。
- 將 `EXCEPTION WHEN OTHERS` 和 `RETURN NEW` 作為防火牆，即便新研究留存失敗，不會中斷原本 scan upsert。
- 新 `private.asheng_vnext_sampled_eod_archive_daily` 每日聚合樣本（正、負訊號及內部狀態衝突）；**明確標註 sampled cohort only**，不聲稱全市場、未證實買進淨利。與 S/C 授權、盤中存活互不干擾。
- 只授權 `service_role`，anon/authenticated 無權存取，private表RLS已開。
- 每日 450 次以內的既有掃描額度、Cloudflare C 報價、月使用額度、現有網站、LINE、已買進與正式停損停利完全不動。
- 在2026-10-23白天完成部署，**正式前瞻合格樣本應為0**，待下一個交易日現有掃描成功寫入才有資料；不假造未來成果。
- 研究封存增加少量資料庫寫入（每當 existing scanner 成功 upsert，最多每股每日一行），**不增加外部 API 掃描或付費呼叫**。首次實際掃描成功後還需核對觸發器運作及時間成本，尚不可宣稱第一天實際樣本已成功封存。

驗收：表RLS=true、service_role具INSERT/SELECT、anon/authenticated無讀取、觸發器 enabled、source function SECURITY INVOKER、帶去重及fail-open、私有 view security_invoker=true；archive 此刻0筆、交易及版面授權違規0筆。

SQL來源：
- `diagnostics/vnext-eod-shadow-coverage-fix-20261023.sql`
- `diagnostics/vnext-eod-shadow-coverage-prod-regression-20261023.sql`
- `diagnostics/vnext-sampled-eod-archive-prod-migration-20261023.sql`
- `diagnostics/vnext-sampled-eod-archive-prod-smoke-20261023.sql`

**新獲利核心仍然因2026年異股票94筆交易虧損的證據而封鎖，只有實際完成前瞻資料並通過保守滑價及風控驗收後，才可以考慮正式更換。**

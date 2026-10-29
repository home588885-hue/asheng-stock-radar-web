# 阿勝正式風控 A：隔離單元測試（2026-10-29）

**風控 A 計算器仍僅隔離測試，並未整合正式雷達。唯獨另行查出的舊版持股 API 安全漏洞，已單獨部署身份驗證修正 v3；不代表整體風控部署完成。**

## 使用者已確定的正式規則
- 成本下跌 **10%**：停損提醒。
- 自買入之後的**有效最高價**第一次達成本的 **+20%**，啟動移動停利。
- 啟動後最高價向下回落 **5%**：出場提醒（不自動下單）。
- 最高價與保護線只向上更新，**不能降低**；取消舊 -5% / +10% 固定規則。
- MA20 連 3 個交易日收盤失守屬獨立的隔日出場風險審查，不能誤當成當日行情撮合完成。
- 不預設允許虧損攤平；現有例外加碼規則需獨立取得現價/成本/量能/均線合法驗證。

## 隔離原型
- `supabase/functions/_shared/asheng-holding-risk-a.mjs`：純 JavaScript、無網路、無資料庫、無交易、無排程；回傳警示與風控版本。
- `diagnostics/holding-risk-policy-a-20261029.test.mjs`：測試成本、+20% 啟動、-5% 回落、-10% 停損、狀態分離、資料不足/過期、MA20 審查、最高價只上移。
- `.github/workflows/qa-holding-risk-a.yml`：PR 限定的唯讀單元測試。**不得藉此部署。**

## 待完成正式整合的兩個關鍵阻擋
1. `spring_swallow_holdings` 有 38 筆有效持股，全部 38 筆有 `peak_close` 及匹配的持股成本與買進時間基準。然而 `peak_close` 是**最高收盤價**，不是經逐筆或有效日高確認的**買進後最高價**；直接拿它冒充最高價會造成少報警示。必須建立可信且與該筆買入身份綁定的已驗證最高價來源（實際行情、有效日高、歷史追溯）與永久保存。
2. `radar_member_holdings` 10 筆有效持股，目前表格沒有獨立的最高價欄位。禁止以其他使用者或舊持股的高點代入。

另外，已現場核實 ACTIVE `spring-swallow-analyze` v55 與 `spring-swallow-picks` v73 仍輸出 `-5%/+10%` 舊風控。更正必須同時完整覆蓋分析端、picks 回傳、個人持股訊號、前端／LINE 提示，不能只更新顯示文字。

## 正式驗收門檻
1. 單元測試全過；持股每一筆唯一身分（user/portfolio/stock/bought_at/cost）驗證，重買、賣出重建、加碼成本變動安全處理。
2. 有效最高價從買進時間起算，無歷史完整性時顯示「缺乏可信最高價」，不宣稱移動停利已生效；不能把過期行情當作當日出場提醒。
3. 真實獨立行情測試，保護線**只上移**；驗證 -10% 停損／+20% 啟動／回撤 5% 與 MA20 三收失守、其他優先順序及不攤平。
4. 舊歷史資料只做標記，不把舊規則覆蓋成新版虛構歷史；正式新訊號必須有唯一相同 policy_version。
5. 由新分支完整整合及逐路驗證後，**才可依使用者授權部署**；不得擅改正式持股、掃描額度、LINE、房產網站或自動交易。

原始阻擋追蹤：[Issue #4](https://github.com/home588885-hue/asheng-stock-radar-web/issues/4)。資料研究另見草稿 PR #3。

## 2026-10-29 第二輪實際稽核（已完成）

- 現有正式 `admin.html` 在前端已獨立使用 `HOLDING_RISK_VERSION='2026-10-23-B-hard10-trail20-5-v1'`，並以 `stopHard:price<=cost*.90`、`maxGain>=20`、`peak*.95` 計算持股提醒。**先前「正式雷達完全沒用新規則」的說法需限縮**：目前可以確認「前端局部已使用新規則」，但 ANALYZE/PICKS 的結構化 `metrics.holding_management` 仍輸出 -5%/+10%，有來源不一致風險；須端到端查清是否另有讀取該舊欄位的下游提醒。
- `admin.html` 的最高觀察價格目前由既有 `spring_swallow_holdings.peak_close`、當前 C/S 價與瀏覽器 `localStorage` 取最大；**這是已觀察高點**，不是完整買進後逐筆最高成交價。跨瀏覽器僅具有限 EOD 高水位共享。
- 38 筆有效 `spring_swallow_holdings`：36 筆 `peak_as_of` 在買進日之後；2 筆與買進日相同；**25 筆 `peak_close < avg_cost` 是可能的合法狀態**（例如買進後開低且監測起點晚於買入），已修改測試版，不能錯判資料毀損。只有 4 筆最高觀察收盤價 >= 成本 +20%，這不是完整觸發次數統計。
- 另 10 筆 `radar_member_holdings` 有有效買入時間/成本，但沒有獨立共享高水位欄位。仍需確認使用者身分、帳戶別與持股事件的關聯。
- 已新增最高價來源驗證函式 `acceptObservedHigh`：買進後的時間戳、時區、證實的來源、帳戶／股票／買進事件綁定、日期不得倒退、價格不得降低；**不將買進當日未具交易時間的日高當作買後已到達高價**，也不覆蓋正式持股。
- GitHub Actions [#40798962104](https://github.com/home588885-hue/asheng-stock-radar-web/actions/runs/40798962104)：**15/15 tests passed**，僅在測試分支執行，無正式環境 API 呼叫。
- **主分支、正式分析/選股 Edge Functions 未修改；但舊版 `spring-swallow-holdings` 已單獨部署安全修正 v3。** 完整最高價來源、歷史時點與雙帳戶整合仍未完成，不得宣稱正式跨裝置移動停利已修復。

### 仍必須補足的真實整合

1. 盤點前端、ANALYZE/PICKS 結構化欄位、LINE 和每個持股卡片的取值優先順序，移除錯誤的 -5/+10 提示，唯一版本不再互相覆蓋。
2. 建立以帳戶/持股事件隔離的可信可持久化高點來源。既有 `peak_close` 可作為 **EOD-close observation**，不能冒充經完整回溯的 daily high，更不能將買入當日不確定的日高當作買後高點。
3. 所有正式回寫與讀取須驗證 RLS / service-role 權限，不容許跨帳戶讀取。
4. 跑真實 EOD 與 C 行情端到端測試，再保留回滾與舊政策區分標籤正式部署；持股不自動買賣。

## 主線身分與 API 拆分補充驗證（同日唯讀）

- 正式 `admin.html` 把 `HOLDINGS_API` 指向 `asheng-member-api?action=holdings`，使用既有 Supabase 會員登入的 JWT。**不是直接使用**名為 `spring-swallow-holdings` 的舊函式。
- `asheng-member-api` 有 `auth.getUser()`、會員身分確認。管理員讀寫 `spring_swallow_holdings`，其他會員讀寫按 `auth.uid()` 隔離的 `radar_member_holdings`。資料庫目前 38 筆前者有效、10 筆後者有效；兩者是**不同持股來源，不可混合計數或交叉引用高點**。
- 已讀到會員 `save_holding` 的正式程式會在「編輯現有有效持股」時保留原 `bought_at`，賣出再買另起；測試版對買入事件和成本變更加入明確隔離。
- 目前另有舊版 `spring-swallow-holdings` 函式仍 ACTIVE 且 `verify_jwt=false`。此服務是否仍被其他客戶端使用未完全確認，存在權限稽核必要；另開 [Issue #6](https://github.com/home588885-hue/asheng-stock-radar-web/issues/6)。**不應透過舊函式實作跨裝置高價同步**。該函式已於 2026-10-29 單獨部署安全修正 v3；正式頁面仍使用 `asheng-member-api`。
- 正式跨裝置高水位應優先在已驗證 JWT 的 `asheng-member-api` 或具嚴格 RLS / RPC 保護的獨立服務實作。未驗收權限與完整時間戳前不新增資料寫入。

## 舊版端點安全熱修實際結果（2026-10-29）

- 將已讀取的正式 `spring-swallow-holdings` v2 原始碼在測試分支加上會員 JWT `auth.getUser()` 驗證、`radar_memberships.role=admin` 權限檢查、GET/POST 的管理員帳戶綁定，以及缺少 `ASHENG_ADMIN_PORTFOLIO_ID` 環境設定時預設拒絕的保護。
- 完整預先驗收 [GitHub Actions #40800447882](https://github.com/home588885-hue/asheng-stock-radar-web/actions/runs/40800447882)：**22/22 Node 測試通過**；`deno check supabase/functions/spring-swallow-holdings/index.ts` 通過。這些是純測試與程式碼檢查，非有登入測試帳戶的 HTTP E2E。
- 單獨呼叫 Supabase 部署介面更新此 **舊版** Edge Function，回報 `version=3`、`status=ACTIVE`。部署後以 `get_edge_function` / `list_edge_functions` 核對服務來源確實含身份驗證、管理員與帳戶檢查。為由 handler 驗證 token 的模式，保留原 `verify_jwt=false`，不可將平台未驗 JWT 誤認為全匿名放行。
- **外部匿名 HTTP 及真實管理員帳戶端到端測試尚未成功執行**（執行環境網路工具無法連通該網址），不得宣稱 live E2E 100% 驗收。部署需要 `ASHENG_ADMIN_PORTFOLIO_ID` 伺服器端環境值；其實際是否已設定無法用現有工具驗證。若未設定則此舊端點按設計回 503、拒絕讀寫；主介面 `admin.html` 的持股主路徑為另一個 `asheng-member-api`，未修改。
- 原 Issue #6 保持開啟，待確認合法舊客戶端需求、環境設定與合法登入回歸測試，才能結案。
- **未修改正式 main、`asheng-member-api`、`spring-swallow-analyze`、`spring-swallow-picks`、持股資料、排程、LINE 或房產網站。**

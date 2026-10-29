# 阿勝底部起漲雷達｜正式系統說明

> **本文件已於 2026-10-29 核對正式程式與安全風控服務。** 不要引用舊版 README 裡關於「候選不接 C 盤中報價」「已買進只在13:00取價」「舊會員版」的敘述。正式程式來源是 GitHub Pages `admin.html` 及以下現役 Supabase Edge Functions。過往版本字串出現在歷史資料或原有 V5 研究層，不表示可以恢復舊掃描器。

## 單一正式入口與服務路徑

- 正式前台：`https://home588885-hue.github.io/asheng-stock-radar-web/admin.html`。
- `index.html` 僅轉址到 `admin.html`；不再提供獨立會員頁。
- 退役 Supabase `asheng-radar-web` 只會 HTTP 308 轉址正式頁面；退役 `spring-swallow-scan-batch` 只會 HTTP 410。**不得再接回任何一個退役服務。**
- 三區目前分工：**發動前、進場雷達、已買進**。前兩區必須使用完整新版山川模型及原有 V5／MA10／MA20／MA60 風控；持股獨立使用原持股來源，成本 -10% 停損、買進後已證實高點曾達成本 +20% 才啟動從高點回落 5% 的移動停利提醒；MA20 連三收失守另為風險複核。
- 現役資料函式：`spring-swallow-picks`、`spring-swallow-v5-picks`、`spring-swallow-analyze`、`asheng-pullback-watch`、`asheng-scan-bridge`、`asheng-stock-scan-runner`、持股 API。掃描必須經由現役受保護的 runner / bridge 路徑，不得讓舊 batch 重新執行。

## 交易模型與顯示模型要嚴格分開

- **新版山川完整簽章**：`metrics.box_strategy.model_generation=shanchuan-independent-v2`，`metrics.box_strategy.discovery.version=2026-10-16-shanchuan-independent-v2`，`discovery.as_of === row.as_of`，且 `metrics.shanchuan_v2.mother_child.lifecycle` 必須存在。少其中一項，不能進新版候選。
- **顯示／跨日觀察**：前次已完成的**正版 v2** 資料可在應更新日落後不超過五個日曆日的範圍內保留；必須註明來源模型日、待補算、非買點。新交易日來了不代表舊候選全部刪除，但也不表示它仍是今日有效買點。
- **橘色小量試單／綠色正式買點**：需要目標交易日模型、當日有效 C 成交及原始全部風控；5 分鐘內成交只是一項必要條件。歷史樣本外驗證未放行時，**正式買點維持關閉**。不得用顯示用的五日保留政策繞過交易資格。
- **追蹤狀態**：「資料庫持續追蹤」「今日模型已驗證」「新日 K 尚未補算」「風控失效」須分開。缺少新日 K 只能列待補算，不能假淘汰；真正滿足失效條件才進失效歷史。盤後小量試單準備不得冒充盤中已確認試單。
- 原本 MA10／MA20／MA60、V5、量價、籌碼、MA20 連三天跌破等趨勢複核、防追高及持股資料均保留；山川 v2 是獨立輔助判讀，不代替舊有交易風控。

## 三區報價與防止重複消耗

- 台股盤中三區都使用 Cloudflare C 當日成交價。只對**正在觀看的區域**以既有約三分鐘節奏取樣，**不是**三區同時背景輪詢。無今日有效成交不能以昨日收盤價冒充；超過五分鐘標成「今日前次成交（非即時）」。
- 股價來源 C；盤後完整日 K 選股來源 S。不可因 C 故障改成每三分鐘重新呼叫 S 分析器。週末／收盤後保留已驗證模型與最後可核對的成交時間，不新增 C 盤後行情輪詢。
- 股票 Supabase 內部月上限 **120,000**、夜間安全預留 **20,000**、每日掃描計數上限 **500**、每批最多 **20**。此為**股票自訂加權計數**，不是官方 Pro 兩百萬 Edge Function 呼叫數。不得自行擴額、增排程或搶房產網站及 LINE 的資源。
- 已成功算過的股票，同一完整交易日日 K＋同一新版模型不可無限重算；有限異常補救亦不得超過原來的嘗試上限。
- **快取**只能保存經上述簽章驗證的候選。API 暫時空回覆、iOS 分頁恢復、13:35 交易日切換，不得清除最後經驗證的跨日候選；顯示仍受日期與風控安全閘門限制。PWA `sw.js` 使用網路優先、不快取 HTML／C／S API。
- `admin.html` 裡較早期 `load()` 分支已在入口被直接導向現役 `loadLiveMonitor()` 與 `loadHoldingCards()`。不得重新將過時載入分支接回正式三區。

## 每次更動後的強制驗收（無額度耗費）

```bash
node diagnostics/radar-regression-gates.js
```

必須通過：新版完整模型、週末／盤後保留、舊版不可混入、API 空回覆不清空候選、單一正式 UI 路徑、今日買點嚴格驗證、跨日追蹤待補算明顯可見、三區 C 報價與 PWA 不回舊版。這組測試只讀取本機原始碼，**不會呼叫 Supabase 或 Cloudflare，也不會建立排程**。

仍須分開驗證 GitHub Pages 部署紀錄、當日真實 API／資料庫覆蓋率，以及有管理員授權時的實際 C `/quotes`。靜態測試通過不代表管理員盤中端到端已測過。

## 明確排除

**不得**在本專案修改 `xiang-che.com` 房產物件同步、LINE 自動對話、原持股記錄、管理員權限，或沒有使用者授權的新服務／收費計畫。

## 2026-10-29 風控與驗證高水位正式進度

- 正式分析 `spring-swallow-analyze v56` 和讀取 `spring-swallow-picks v74` 均已部署 ACTIVE，持股政策欄位改為 `2026-10-29-hard10-arm20-peaktrail5-v1`：**-10% 停損、+20% 才啟動、由買入後已驗證高點下滑 5% 觸發移動停利提醒**。取消舊的 +10% 固定全數停利欄位；既有舊日K仍是歷史快照，讀取時有舊來源版本標記，不可假稱歷史資料已重算。S 公共快照不具個人持股成本和最高價，不能直接計算個人出場價。
- 已建立 `asheng_holding_verified_peaks` 空起始表與單調遞增的 service-role-only 更新函式；RLS 開啟，authenticated 只可 SELECT 本人的紀錄，無匿名存取／會員直接寫入權。**不可填補未真正觀察到的買進後歷史高點**。
- `asheng-holding-peak v1` ACTIVE：讀取當前經過身份驗證的使用者持股，最多 30 檔為一批向 TWSE MIS 查詢，只接受有效當日成交；同日買進不得用可能發生在買進前的日高。沒有背景掃描、付費日K或自動交易。
- 正式 `admin.html` 已經由 [PR #5](https://github.com/home588885-hue/asheng-stock-radar-web/pull/5) 合併入 main。只有在使用者打開「已買進」時才從受驗證服務讀取跨裝置觀察高點，遇錯不清除持股或覆蓋原有 S/C 顯示。資料來源仍必須標明為**已觀察高點**，不能視為完整歷史最高成交價。
- 舊版持股 API `spring-swallow-holdings v3` 已修補管理員身份及帳戶權限，正式會員頁原有路徑仍是 `asheng-member-api v23`。兩種持股表分別隔離，不混用用戶成本或高點。
- [GitHub Actions #40803705351](https://github.com/home588885-hue/asheng-stock-radar-web/actions/runs/40803705351)：43 項純測試、全套舊雷達回歸 QA、匿名對新持股高點端點實際 HTTP 401、Deno 編譯與 TS 語法檢查通過。資料庫內的單調高點與重買重置 SQL 在單次 `BEGIN`／`ROLLBACK` 交易中驗證，不留下測試持股或假高點。
- **仍未完成的真實環境驗收**：需要真正已登入的會員／管理員正向 HTTP GET/POST 與跨裝置畫面核對；GitHub Pages CDN 即時發布狀態也無法從目前連線工具直接核對。因此不應宣稱全鏈路 100% 已驗證。既有持股、LINE、房產網站、選股核心與掃描排程均未改。

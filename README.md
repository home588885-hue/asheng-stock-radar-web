# 阿勝底部起漲雷達｜正式系統說明

> **本文件以 2026-10-19 正式程式為準。** 不要引用舊版 README 裡關於「候選不接 C 盤中報價」「已買進只在13:00取價」「舊會員版」的敘述。正式程式來源是 GitHub Pages `admin.html` 及以下現役 Supabase Edge Functions。過往版本字串出現在歷史資料或原有 V5 研究層，不表示可以恢復舊掃描器。

## 單一正式入口與服務路徑

- 正式前台：`https://home588885-hue.github.io/asheng-stock-radar-web/admin.html`。
- `index.html` 僅轉址到 `admin.html`；不再提供獨立會員頁。
- 退役 Supabase `asheng-radar-web` 只會 HTTP 308 轉址正式頁面；退役 `spring-swallow-scan-batch` 只會 HTTP 410。**不得再接回任何一個退役服務。**
- 三區目前分工：**發動前、進場雷達、已買進**。前兩區必須使用完整新版山川模型及原有 V5／MA10／MA20／MA60 風控；持股獨立走原本持股記錄及 MA20 出場規則。
- 現役資料函式：`spring-swallow-picks`、`spring-swallow-v5-picks`、`spring-swallow-analyze`、`asheng-pullback-watch`、`asheng-scan-bridge`、`asheng-stock-scan-runner`、持股 API。掃描必須經由現役受保護的 runner / bridge 路徑，不得讓舊 batch 重新執行。

## 交易模型與顯示模型要嚴格分開

- **新版山川完整簽章**：`metrics.box_strategy.model_generation=shanchuan-independent-v2`，`metrics.box_strategy.discovery.version=2026-10-16-shanchuan-independent-v2`，`discovery.as_of === row.as_of`，且 `metrics.shanchuan_v2.mother_child.lifecycle` 必須存在。少其中一項，不能進新版候選。
- **顯示／跨日觀察**：前次已完成的**正版 v2** 資料可在應更新日落後不超過五個日曆日的範圍內保留；必須註明來源模型日、待補算、非買點。新交易日來了不代表舊候選全部刪除，但也不表示它仍是今日有效買點。
- **橘色小量試單／綠色正式買點**：需要目標交易日模型、當日有效 C 成交及原始全部風控；5 分鐘內成交只是一項必要條件。歷史樣本外驗證未放行時，**正式買點維持關閉**。不得用顯示用的五日保留政策繞過交易資格。
- **追蹤狀態**：「資料庫持續追蹤」「今日模型已驗證」「新日 K 尚未補算」「風控失效」須分開。缺少新日 K 只能列待補算，不能假淘汰；真正滿足失效條件才進失效歷史。盤後小量試單準備不得冒充盤中已確認試單。
- 原本 MA10／MA20／MA60、V5、量價、籌碼、MA20 連三天跌破等出場、20% 分批減碼、防追高及持股資料均保留；山川 v2 是獨立輔助判讀，不代替舊有交易風控。

## 三區報價與防止重複消耗

- 台股盤中三區都使用 Cloudflare C 當日成交價。只對**正在觀看的區域**以既有約三分鐘節奏取樣，**不是**三區同時背景輪詢。無今日有效成交不能以昨日收盤價冒充；超過五分鐘標成「今日前次成交（非即時）」。
- 股價來源 C；盤後完整日 K 選股來源 S。不可因 C 故障改成每三分鐘重新呼叫 S 分析器。週末／收盤後保留已驗證模型與最後可核對的成交時間，不新增 C 盤後行情輪詢。
- 股票 Supabase 內部月上限 **120,000**、夜間安全預留 **20,000**、每日掃描計數上限 **450**、每批最多 **20**。此為**股票自訂加權計數**，不是官方 Pro 兩百萬 Edge Function 呼叫數。不得自行擴額、增排程或搶房產網站及 LINE 的資源。
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

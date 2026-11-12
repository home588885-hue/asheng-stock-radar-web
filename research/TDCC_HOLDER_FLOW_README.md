# TDCC 大戶資金流向：獨立研究分支（尚未接正式雷達）

## 研究目標

檢驗阿勝原本的第一根突破、回踩再突破訊號，搭配集保 400 張及 1,000 張以上持股比例連增，是否能在相同訊號日期、股票及樣本期間下，改善後續 10 日報酬、勝率與不利波動。研究結果不得直接開啟試單、買進或加碼。

## 官方資料、週期與授權

- 臺灣集保結算所「集保戶股權分散表」：https://www.tdcc.com.tw/portal/zh/smWeb/qryStock
- 政府資料集 11452：https://data.gov.tw/dataset/11452
- 官方 OpenAPI 文件提供 GET /v1/opendata/1-5；CSV 公開來源：https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5 。正式網路連線可用性仍待實測。
- 歷史 CSV 公開備份：https://github.com/wirelessr/tdcc-opendata-archive。目前有 2021 年約 13 週、2026-04-30 至 2026-10-22 的每週快照，並沒有完整 2025 年備份。第三方快照需檢查完整性並標示來源。
- 持股分級 12～15 為超過 400 張，15 為超過 1000 張。16 是差異調整，17 是合計，不得誤加為大戶。
- 發表公開研究報告需標示臺灣集中保管結算所來源並遵守政府資料開放授權條款第 1 版：https://data.gov.tw/license

## 防止偷看未公布資料

1. 計算每檔每週 400+ 及 1000+ 集保戶持股占比，百分點變化以及連續 2 週增減。
2. 僅相隔 4～11 日的快照才算連續；缺關鍵分級不強行計算。
3. 週資料保守到「快照日之後第一個星期二」才允許研究訊號使用；這不是宣稱官方精確發佈時間，而是保守防偷看的假設。
4. 舊資料距訊號日超過 20 天自動視為缺漏。
5. 原策略比較組只包含同樣具有有效集保資料的股票訊號，避免比較樣本不公平。
6. 比較原策略、400 張連增 2 週、1000 張連增 2 週、兩級連增、400 張連增加上現有法人代理等五組。統計樣本數、10 日平均報酬、勝率、平均最大不利波動及觸及 -10% 比率。
7. 原歷史研究事件使用 r10、mae10，各研究 run 的買賣成本口徑須先核對；2025～2026 的研究期間已反覆使用，不能宣稱是真正未接觸過的樣本外測試。

## 手動研究執行，沒有自動排程

準備 Node.js 18+，在本機或獨立研究環境：

手動獲取資料（唯讀外部來源，寫入本機資料夾，不會觸發交易掃描）：
- 從集保官網取得最新一期：node research/tdcc-fetch-weekly.mjs --latest --dest research-data/tdcc
- 從公開授權週備份取得 2026 年資料：node research/tdcc-fetch-weekly.mjs --archive --since 2026-04-30 --dest research-data/tdcc
- 單獨驗證下載資料格式：node --test research/tdcc-fetch-weekly.test.mjs
- 若官方端點網路不可及、資料格式不符或週日期混雜，程式會報錯而不宣稱成功；目前並未在正式環境下載或開啟排程。


- 將 TDCC 1-5 格式的多個每週 CSV 放到同一資料夾。
- 從 Supabase 只讀研究事件資料匯出 CSV，最低欄位：stock_id,signal_date,family,r10,mae10。
- 額外比較法人代理需附欄位 chip_score,inst_net5,inst_pos_days。
- 執行：node research/tdcc-holder-flow.mjs --tdcc-dir /path/to/weekly-csv --events /path/to/research_events.csv --out /path/to/report.json
- 測試：node --test research/tdcc-holder-flow.test.mjs

從 Supabase 匯出研究事件的唯讀 SQL（日期限於現有公開週資料）：

    SELECT stock_id, signal_date, family, r10, mae10, chip_score, inst_net5, inst_pos_days
    FROM public.spring_swallow_v5_research_events
    WHERE signal_date BETWEEN DATE '2026-05-01' AND DATE '2026-08-31'
      AND family IN ('FIRST_BREAKOUT','PULLBACK_REBREAK','BB_B_SQUEEZE_OPEN','BB_C_SQUEEZE_OPEN')
      AND r10 IS NOT NULL
    ORDER BY signal_date,stock_id,family;

嚴禁將持股紀錄、會員資訊、私人 API key 或未脫敏的研究數據上傳公開 GitHub。

## 安全界線與目前尚未完成

- 此分支只有研究程式、測試和文件。沒有修改 admin.html、交易策略、停損、持股、掃描額度、Supabase、LINE、房產網站或其他排程。
- 沒有正式部署，也沒有啟用定時下載。後續週更新必須先驗證官方資料端點的 HTTP 回應、格式、時間戳、歷史週檔缺漏，避免假資料。
- 尚未取得真正的權證最近 7 日認購買超歷史檔。集保大戶持股、法人買超都不能冒充權證投資人買超。
- 已使用無網路合成樣本做資料解析、防未來資訊與比較流程測試。尚未跑完整真實集保歷史 CSV 和研究事件的端到端回測，不可宣稱資金流資料已改善勝率。

-- 阿勝雷達：同一三區、不增加 UI 的買點一致性唯讀驗收。
-- 研究分支；請勿部署成買進訊號或新增任何卡片、區塊、按鈕。
-- 同一筆 scan_results 既可能包含 `stage=WATCH` 和 V5 candidate。
-- 訊號確認≠實際可買：正式買點須另符合最新有效成交 C、
-- 盤中存活確認、成本風控與正式雷達統一主狀態。
-- 以 `as_of` 最新一天確認候選；不可把 S 收盤確認當成盤中已買進。

WITH most_recent AS (SELECT max(as_of) AS dt FROM public.spring_swallow_scan_results),
rows AS (
 SELECT x.as_of,x.stock_id,x.stage,x.score,
   (x.metrics#>>'{v5,entry_confirmed}')::boolean IS TRUE AS v5_entry,
   (x.metrics#>>'{v5,precision_confirmed}')::boolean IS TRUE AS v5_precision,
   (x.metrics#>>'{v5,pending_ready}')::boolean IS TRUE AS v5_pending,
   x.metrics#>>'{trade_lifecycle,entry,state}' AS eod_state,
   (x.metrics#>>'{trade_lifecycle,entry,live_confirmation_required}')::boolean IS TRUE AS live_required
 FROM public.spring_swallow_scan_results x
 JOIN most_recent d ON x.as_of=d.dt
)
SELECT max(as_of) AS as_of,
       count(*) AS scanned_symbols,
       count(*) FILTER(WHERE v5_entry) AS v5_entry_confirmed_eod,
       count(*) FILTER(WHERE v5_precision) AS v5_precision_confirmed_eod,
       count(*) FILTER(WHERE v5_pending) AS v5_pending_ready_eod,
       count(*) FILTER(WHERE v5_entry AND stage='WATCH') AS v5_confirmed_with_stage_watch,
       count(*) FILTER(WHERE v5_entry AND eod_state='formal_candidate') AS eod_formal_candidate,
       count(*) FILTER(WHERE v5_entry AND live_required) AS still_requires_live_confirmation
FROM rows;

-- 對照時特別留意：
-- * `WATCH` 是原技術 stage；`formal_candidate` 是 EOD V5 候選狀態，兩者並非已成交。
-- * 只有真正授權、最新 C 報價與存活確認之後，才能在既有版面給正式買點。
-- * 不可為了讓畫面有綠燈，就把候選改成可買。
-- * 研究資料中沒有 C 的回放與 12 分鐘存活序列，不能宣稱已驗證即時買點。

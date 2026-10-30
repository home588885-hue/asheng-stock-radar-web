-- Read-only audit. Run in Supabase SQL editor against qexbtubfoyfsllaiecvv.
-- Research run 86c2305a-3b60-493c-9ec8-2addbf754e78; data ends 2026-08-24.
-- 2025/2026 have already been examined repeatedly; NOT a pristine holdout.
-- Signal-day EOD information only. Check publication/weekly-K timing before any live use.
-- Eight historically suspicious price-event symbols excluded for sensitivity; audit all separately.
-- Dates and stops are NOT an executable order simulation.
WITH cleaned AS (
  SELECT stock_id,signal_date,entry_date,r10,r20,mae10,mfe10,
         deviation20,signal_return_pct,weekly_k,monthly_k,chip_score,
         pullback_days,pullback_depth_pct,avg20_volume_lots,volume_lots
  FROM public.spring_swallow_v5_research_events
  WHERE run_id='86c2305a-3b60-493c-9ec8-2addbf754e78'
    AND family='PULLBACK_REBREAK'
    AND stock_id NOT IN ('2867','3036','3432','5314','4763','6919','2327','8422')
    AND r10 BETWEEN -60 AND 60 AND r20 BETWEEN -60 AND 60
), all_events AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY stock_id,DATE_TRUNC('month',signal_date)
                               ORDER BY signal_date,entry_date) AS rn
  FROM cleaned
), strict_events AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY stock_id,DATE_TRUNC('month',signal_date)
                               ORDER BY signal_date,entry_date) AS rn
  FROM cleaned
  WHERE weekly_k>=80 AND monthly_k>=80 AND chip_score>=60
    AND pullback_days BETWEEN 3 AND 8
    AND pullback_depth_pct BETWEEN -4 AND 3
    AND avg20_volume_lots>=500 AND volume_lots>=1000
), samples AS (
  SELECT 'all_pullback' AS cohort,stock_id,signal_date,r10,r20,mae10,mfe10 FROM all_events WHERE rn=1
  UNION ALL
  SELECT 'strict_v5' AS cohort,stock_id,signal_date,r10,r20,mae10,mfe10 FROM strict_events WHERE rn=1
  UNION ALL
  SELECT 'strict_v5_bias20_max20' AS cohort,stock_id,signal_date,r10,r20,mae10,mfe10
  FROM strict_events WHERE rn=1 AND deviation20<=20
)
SELECT CASE WHEN signal_date<'2024-01-01' THEN 'development_2022_23'
            WHEN signal_date<'2025-01-01' THEN 'selection_2024'
            WHEN signal_date<'2026-01-01' THEN 'retrospective_2025'
            ELSE 'retrospective_2026' END AS period,
       cohort,COUNT(*) AS signals,COUNT(DISTINCT stock_id) AS symbols,
       ROUND(AVG(r10)::numeric,2) AS mean_r10,
       ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP(ORDER BY r10))::numeric,2) AS median_r10,
       ROUND(AVG(r10) FILTER(WHERE r10 BETWEEN -30 AND 30)::numeric,2) AS no_extreme30_mean_r10,
       ROUND(AVG((r10>0)::int)::numeric,3) AS positive10,
       ROUND(AVG((r10<=-10)::int)::numeric,3) AS lost10,
       ROUND(AVG((mae10<=-8)::int)::numeric,3) AS drawdown8
FROM samples GROUP BY 1,2 ORDER BY 1,2;

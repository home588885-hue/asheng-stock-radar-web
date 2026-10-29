-- 阿勝雷達 A/B/C: evidence-only, zero writes or C/S scans.
-- Original immutable historical research events; do not present these as a
-- re-run of today's trading permissions. 2025+ was seen during prior research.
-- FIRST_BREAKOUT (A) / PULLBACK_REBREAK (B proxy) / BC8_MA60 (C proxy)
-- Returns r5/r10/r20 are PRECOMPUTED source metrics, not fresh broker replay.
-- Use both event n and monthly dispersion; overlap means not a portfolio curve.

-- 1: Per-year performance and cost-independent stress indicators
SELECT family,
 CASE WHEN signal_date<DATE '2025-01-01' THEN '2022-24 development'
      WHEN signal_date<DATE '2026-01-01' THEN '2025 retrospective'
      WHEN signal_date<DATE '2026-07-01' THEN '2026 Jan-Jun'
      ELSE '2026 Jul-Aug' END AS period,
 COUNT(*) AS n,
 ROUND(AVG(r5),2) AS avg_r5,ROUND(AVG(r10),2) AS avg_r10,
 ROUND(AVG(r20),2) AS avg_r20,
 ROUND(100*AVG((r10>0)::int),1) AS win_r10_pct,
 ROUND(AVG(mae10),2) AS avg_mae10,
 ROUND(100*AVG((r10<=-10)::int),1) AS r10_loss10_pct,
 ROUND(100*AVG((mfe10>=3 AND r10<=0)::int),1) AS observed_gain3_then_nonpositive_r10_pct
FROM public.spring_swallow_v5_research_events
WHERE family IN ('BOTTOM_BREAKOUT','FIRST_BREAKOUT','PULLBACK_REBREAK',
                 'BC8_MA60','MA4_BREAKOUT_BASE')
AND signal_date BETWEEN DATE '2022-01-01' AND DATE '2026-08-31'
GROUP BY 1,2 ORDER BY family,period;

-- 2: MA20 extension sensitivity and 2026 July downside
SELECT family,
 CASE WHEN deviation20 BETWEEN 0 AND 12
      THEN 'bias0to12' ELSE 'over12_or_missing' END AS bias_group,
 COUNT(*) n,
 ROUND(AVG(r10),2) avg_r10,ROUND(AVG(r20),2) avg_r20,
 ROUND(100*AVG((r10<=-10)::int),1) AS r10_loss10_rate,
 ROUND(100*AVG((mae10<=-10)::int),1) AS ten_day_mae_below10_rate
FROM public.spring_swallow_v5_research_events
WHERE family IN ('FIRST_BREAKOUT','PULLBACK_REBREAK','BC8_MA60')
AND signal_date BETWEEN DATE '2026-07-01' AND DATE '2026-07-31'
GROUP BY 1,2 ORDER BY 1,2;

-- 3: Safe-leaning B proxy (DO NOT TURN INTO BUY PERMISSION).
-- Only signal-day features, NO future gain/MAE in selection.
WITH candidate AS(
 SELECT *,
 CASE WHEN signal_date<DATE '2025-01-01' THEN 'development'
      WHEN signal_date<DATE '2026-01-01' THEN '2025'
      ELSE '2026H1' END AS period
 FROM public.spring_swallow_v5_research_events
 WHERE family='PULLBACK_REBREAK'
 AND signal_date<DATE '2026-07-01'
 AND deviation20 BETWEEN 0 AND 12
 AND ma20_slope5_pct>0
 AND volume_ratio_day BETWEEN 1 AND 2.5
 AND signal_return_pct<=5
 AND pullback_days BETWEEN 3 AND 8
 AND pullback_depth_pct BETWEEN -4 AND 0
)
SELECT period, COUNT(*) AS n,
 ROUND(AVG(r5),2) AS avg_r5,ROUND(AVG(r10),2) avg_r10,
 ROUND(AVG(r20),2) avg_r20,
 ROUND(100*AVG((r10>0)::int),1) AS win10_pct,
 ROUND(100*AVG((r10<=-10)::int),1) AS loss10_pct,
 ROUND(AVG(mae10),2) AS avg_mae10
FROM candidate GROUP BY period ORDER BY period;

-- 4: Monthly robustness, prevents annual wins hiding regime crashes.
WITH m AS (
 SELECT family,date_trunc('month',signal_date)::date AS month_start,
 COUNT(*) n, AVG(r10) AS r10, AVG(r20) AS r20
 FROM public.spring_swallow_v5_research_events
 WHERE family IN ('FIRST_BREAKOUT','PULLBACK_REBREAK','BC8_MA60')
 AND signal_date BETWEEN DATE '2025-01-01' AND DATE '2026-06-30'
 GROUP BY 1,2)
SELECT family,date_part('year',month_start)::int yr,COUNT(*) months,
 COUNT(*) FILTER(WHERE r10>0) AS positive_months_r10,
 COUNT(*) FILTER(WHERE r20>0) AS positive_months_r20,
 ROUND(AVG(r10),2) AS avg_monthly_r10,
 ROUND(MIN(r10),2) AS worst_month_r10,
 ROUND(MAX(r10),2) AS best_month_r10
FROM m GROUP BY 1,2 ORDER BY 1,2;

-- Missing by design:
-- - 30-trading-day net outcomes not stored
-- - true intraday real C confirmation/backtest bid-ask/replay unavailable
-- - portfolio-level overlap sizing / drawdown
-- - untouched OOS after all the research/development trials
-- - no right to claim positive expectancy or unlock formal buys

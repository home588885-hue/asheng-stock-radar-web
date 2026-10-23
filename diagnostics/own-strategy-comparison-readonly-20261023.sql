-- 阿勝雷達原策略對照｜唯讀；不更改正式交易模型、持股、掃描額度。
-- 2026-10-23，研究訊號可能重疊；統計不是完整交易組合報酬。
-- V5 精準組是用歷史 PULLBACK_REBREAK 欄位重建的「近似條件」，
-- 不是正式 production gate 的逐日狀態回放。

WITH signals AS(
 SELECT EXTRACT(YEAR FROM signal_date)::int AS yr, stock_id, signal_date,
        family, r10, r20, mae10, mfe10,
        volume_lots, avg20_volume_lots, pullback_days, pullback_depth_pct,
        weekly_k, monthly_k, chip_score, close_location, upper_wick_pct,
        volume_ratio_day
 FROM public.spring_swallow_v5_research_events
 WHERE signal_date BETWEEN '2022-01-01' AND '2026-08-01'
   AND family IN('FIRST_BREAKOUT','BOTTOM_BREAKOUT','COMPRESSION_BREAKOUT','PULLBACK_REBREAK')
   AND volume_lots>=1000
   -- Suspected price split/unreliable rows excluded ONLY from this read-only report.
   AND r10 BETWEEN -30 AND 100 AND r20 BETWEEN -40 AND 100
   AND mae10>-30 AND mfe10<100
), candidate AS (
 SELECT s.*,v.variant
 FROM signals s
 CROSS JOIN LATERAL (VALUES
   ('FIRST_BREAKOUT',family='FIRST_BREAKOUT'),
   ('BOTTOM_BREAKOUT',family='BOTTOM_BREAKOUT'),
   ('COMPRESSION_BREAKOUT',family='COMPRESSION_BREAKOUT'),
   ('PULLBACK_REBREAK',family='PULLBACK_REBREAK'),
   ('V5_BASIC_PROXY',family='PULLBACK_REBREAK'
       AND avg20_volume_lots>=500
       AND pullback_days BETWEEN 3 AND 8 AND pullback_depth_pct BETWEEN -4 AND 3
       AND weekly_k>=80 AND monthly_k>=80 AND chip_score>=60),
   ('V5_PRECISION_PROXY',family='PULLBACK_REBREAK'
       AND avg20_volume_lots>=500
       AND pullback_days BETWEEN 3 AND 8 AND pullback_depth_pct BETWEEN -4 AND 3
       AND weekly_k>=80 AND monthly_k>=80 AND chip_score>=65
       AND close_location>=60 AND upper_wick_pct<=1
       AND volume_ratio_day BETWEEN 1.2 AND 1.8)
 ) AS v(variant,pass)
 WHERE v.pass
)
SELECT yr,variant,COUNT(*) historical_signals,COUNT(DISTINCT stock_id) stocks,
       ROUND(AVG(r10),3) net_fixed_10d_pct,
       ROUND(AVG(r20),3) net_fixed_20d_pct,
       ROUND(100*AVG((r20>0)::int),1) fixed_20d_profitable_pct,
       ROUND(100*AVG((mae10<=-5)::int),1) touched_stop_minus5_in_first10d_pct
FROM candidate
GROUP BY yr,variant ORDER BY yr,variant;

-- Additional archived TRADING-exit simulation with different exit rules.
-- These outcomes are NOT -5/+5 breakeven/+10 max30 policy.
WITH precision AS (
 SELECT DISTINCT stock_id,signal_date
 FROM public.spring_swallow_v5_research_events
 WHERE family='PULLBACK_REBREAK' AND volume_lots>=1000 AND avg20_volume_lots>=500
   AND pullback_days BETWEEN 3 AND 8 AND pullback_depth_pct BETWEEN -4 AND 3
   AND weekly_k>=80 AND monthly_k>=80 AND chip_score>=65
   AND close_location>=60 AND upper_wick_pct<=1
   AND volume_ratio_day BETWEEN 1.2 AND 1.8
), ex AS (
 SELECT e.*,p.stock_id IS NOT NULL AS is_precision
 FROM public.spring_swallow_exit_research_results e
 LEFT JOIN precision p ON e.stock_id=p.stock_id AND e.signal_date=p.signal_date
 WHERE e.strategy='H15_TP5_SL5'
)
SELECT EXTRACT(YEAR FROM signal_date)::int yr,
       CASE WHEN is_precision THEN 'V5_PRECISION_MATCHED' ELSE 'OTHER_RESEARCH_MATCHED' END AS strategy_group,
       COUNT(*) trades,COUNT(DISTINCT stock_id) stocks,
       ROUND(AVG(net_return_pct),3) archived_average_net_pct,
       ROUND(100*AVG((net_return_pct>0)::int),1) archived_win_pct
FROM ex
GROUP BY 1,2 ORDER BY 1,2;

-- Do not authorize core replacement based on fixed-horizon averages
-- or this archive's 15-day +5%/-5% simulation.

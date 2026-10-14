-- Research-only SQL; no UPDATE/INSERT/DDL and no production scanner calls.
-- Source: public.spring_swallow_v5_research_events, signal data through 2026-06-30.
-- Emphasis: do not use future r5 to decide an original signal-day entry.
-- One family event per stock per calendar month minimizes repeated signals;
-- historical cohort is not an actual independently executable portfolio.
WITH source AS (
 SELECT stock_id,signal_date,r5,r20,chip_score,daily_k,
 row_number() OVER (
   PARTITION BY stock_id,date_trunc('month',signal_date)
   ORDER BY signal_date
 ) AS rn
 FROM public.spring_swallow_v5_research_events
 WHERE family='V5_PRE5'
   AND volume_lots>=1000 AND signal_date<'2026-07-01'
), events AS (
 SELECT *,extract(year from signal_date)::int AS yr
 FROM source
 WHERE rn=1 AND r5 BETWEEN -60 AND 100 AND r20 BETWEEN -60 AND 150
)
SELECT yr,count(*) AS all_entries,
round(100.0*count(*) FILTER(WHERE r20>0)/count(*),1) AS initial_entry_win_at20,
count(*) FILTER(WHERE r5>2) AS day5_up_more_than2_n,
round(100.0*count(*) FILTER(WHERE r5>2 AND r20>0)/nullif(count(*) FILTER(WHERE r5>2),0),1)
 AS original_entry_positive_at20_given_day5_up2,
round(100.0*count(*) FILTER(WHERE r5>2 AND r20>r5)/nullif(count(*) FILTER(WHERE r5>2),0),1)
 AS additional_gain_from_day5_to_day20_if_day5_up2,
count(*) FILTER(WHERE r5<=0) AS day5_nonpositive_n,
round(100.0*count(*) FILTER(WHERE r5<=0 AND r20>0)/nullif(count(*) FILTER(WHERE r5<=0),0),1)
 AS early_losers_recovered_by_day20
FROM events GROUP BY yr ORDER BY yr;

-- Audit retrospective threshold: wins in recent period are NOT evidence
-- that the same threshold works through a bear market.
WITH source AS (
 SELECT stock_id,signal_date,r20,chip_score,daily_k,
 row_number() OVER (
   PARTITION BY stock_id,date_trunc('month',signal_date)
   ORDER BY signal_date
 ) AS rn
 FROM public.spring_swallow_v5_research_events
 WHERE family='V5_PRE5' AND volume_lots>=1000 AND signal_date<'2026-07-01'
)
SELECT extract(year from signal_date)::int yr,
count(*) FILTER (WHERE chip_score>=75 AND daily_k<=75) n,
round(100.0*count(*) FILTER (WHERE chip_score>=75 AND daily_k<=75 AND r20>0)
  /nullif(count(*) FILTER (WHERE chip_score>=75 AND daily_k<=75 AND r20 IS NOT NULL),0),1) w20
FROM source WHERE rn=1 GROUP BY 1 ORDER BY 1;

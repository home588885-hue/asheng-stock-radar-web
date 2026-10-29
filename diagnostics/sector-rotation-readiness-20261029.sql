-- Sector turnover-shift and RRG readiness, READ ONLY, safe to re-run.
-- A single latest scan per ticker cannot provide two matched full EOD sessions.
SELECT 'scan_last_snapshot' AS source,COUNT(*) AS rows,
 COUNT(DISTINCT stock_id) AS distinct_tickers,
 COUNT(DISTINCT as_of) AS date_labels,
 COUNT(*)-COUNT(DISTINCT stock_id) AS repeated_stock_rows,
 MIN(as_of) AS first_date,MAX(as_of) AS last_date
FROM public.spring_swallow_scan_results;
SELECT 'sampled_archive' AS source,COUNT(*) AS rows,
 COUNT(DISTINCT stock_id) AS distinct_tickers,
 COUNT(DISTINCT as_of) AS date_labels,
 MIN(as_of) AS first_date,MAX(as_of) AS last_date
FROM private.asheng_vnext_sampled_eod_archive;
-- This archive stores model flags + metrics_md5, NOT price / traded value history.
SELECT as_of,COUNT(*) AS archived_symbols,
 COUNT(*) FILTER(WHERE research_context ? 'close'
   AND research_context ? 'trade_value_twd') AS archived_real_cash_value
FROM private.asheng_vnext_sampled_eod_archive GROUP BY as_of ORDER BY as_of DESC;
WITH paired AS (
 SELECT a.stock_id FROM private.asheng_vnext_sampled_eod_archive a
 JOIN private.asheng_vnext_sampled_eod_archive b USING(stock_id)
 WHERE a.as_of=(SELECT MAX(as_of) FROM private.asheng_vnext_sampled_eod_archive)
 AND b.as_of=(SELECT MIN(as_of) FROM private.asheng_vnext_sampled_eod_archive)
)
SELECT 'archive_ticker_overlap_only_no_cash_values' AS check_name,
 COUNT(DISTINCT stock_id) overlap_tickers FROM paired;
-- A future official-EOD archive MUST have actual exchange trade_value_twd,
-- stable market+stock identity, complete session dates, sector snapshot, provenance,
-- adjusted closes and a verified benchmark, before computing sector pp or RS 50/10.

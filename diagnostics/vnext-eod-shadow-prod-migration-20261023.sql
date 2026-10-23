-- ASHENG V5/vNext safe production release: RESEARCH-ONLY EOD observation.
-- No scans, cron, new UI, shareable endpoints, orders, or trading rule overrides.
-- This SQL is idempotent, security_invoker, private schema, service-role read-only.
-- Never treat EOD candidates as live confirmed buy points.

CREATE OR REPLACE VIEW private.asheng_vnext_eod_shadow
WITH (security_invoker = true)
AS
WITH source AS (
 SELECT
  x.as_of,
  x.stock_id,
  x.stock_name,
  x.stage AS source_stage,
  x.score AS source_score,
  x.scanned_at,
  count(*) OVER (PARTITION BY x.as_of) AS source_day_rows,
  x.metrics #>> '{model,version}' AS source_model_version,
  (x.metrics #>> '{v5,entry_confirmed}') = 'true' AS v5_eod_entry,
  (x.metrics #>> '{v5,precision_confirmed}') = 'true' AS v5_eod_precision,
  (x.metrics #>> '{v5,pending_ready}') = 'true' AS v5_eod_pending,
  x.metrics #>> '{trade_lifecycle,entry,state}' AS source_entry_state,
  (x.metrics #>> '{trade_lifecycle,entry,live_confirmation_required}') = 'true' AS needs_live_confirmation,
  x.scanned_at >= ((x.as_of::timestamp + interval '13 hours 30 minutes') AT TIME ZONE 'Asia/Taipei')
    AS captured_after_market_close
 FROM public.spring_swallow_scan_results x
)
SELECT
 s.as_of,
 s.stock_id,
 s.stock_name,
 s.source_stage,
 s.source_score,
 s.scanned_at,
 s.source_day_rows,
 s.source_model_version,
 s.v5_eod_entry,
 s.v5_eod_precision,
 s.v5_eod_pending,
 s.source_entry_state,
 s.needs_live_confirmation,
 s.captured_after_market_close,
 (
  s.as_of > DATE '2026-10-23'
  AND s.source_day_rows >= 100
  AND s.source_model_version = '2026-09-21-v5'
  AND s.captured_after_market_close
 ) AS forward_data_eligible,
 (
  s.v5_eod_entry
  AND s.source_entry_state IS DISTINCT FROM 'formal_candidate'
 ) AS eod_internal_conflict,
 CASE
   WHEN s.v5_eod_entry AND s.source_entry_state IS DISTINCT FROM 'formal_candidate'
     THEN 'SOURCE_STATUS_CONFLICT'
   WHEN s.v5_eod_precision AND s.v5_eod_entry
     THEN 'PRECISION_EOD_PENDING_LIVE'
   WHEN s.v5_eod_entry
     THEN 'V5_EOD_PENDING_LIVE'
   WHEN s.v5_eod_pending
     THEN 'V5_EOD_WATCH'
   ELSE 'NO_EOD_ENTRY'
 END::text AS unified_eod_observation,
 NULL::boolean AS verified_0050_regime,
 NULL::boolean AS verified_new_growth_lowrange_model,
 FALSE::boolean AS buy_authorized,
 FALSE::boolean AS strategy_switch_authorized,
 FALSE::boolean AS interface_change_authorized,
 'RESEARCH_ONLY_EOD'::text AS release_scope
FROM source s;

REVOKE ALL ON TABLE private.asheng_vnext_eod_shadow FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE private.asheng_vnext_eod_shadow TO service_role;
COMMENT ON VIEW private.asheng_vnext_eod_shadow IS
 'Production read-only EOD V5 observer only: no 0050 regime validation, no live C, no buy/strategy/UI permission. Updated through existing daily scan table.';

CREATE OR REPLACE VIEW private.asheng_vnext_eod_shadow_daily
WITH (security_invoker = true)
AS
SELECT
  as_of,
  MAX(source_day_rows)::bigint AS source_day_rows,
  COUNT(DISTINCT stock_id)::bigint AS distinct_stocks,
  COUNT(*) FILTER (WHERE forward_data_eligible)::bigint AS forward_eligible_rows,
  COUNT(*) FILTER (WHERE v5_eod_entry)::bigint AS eod_entry_candidates,
  COUNT(*) FILTER (WHERE v5_eod_precision AND v5_eod_entry)::bigint AS precision_candidates,
  COUNT(*) FILTER (WHERE v5_eod_pending AND NOT v5_eod_entry)::bigint AS pending_candidates,
  COUNT(*) FILTER (WHERE eod_internal_conflict)::bigint AS data_conflicts,
  COUNT(*) FILTER (WHERE NOT captured_after_market_close)::bigint AS scanned_before_close,
  COUNT(*) FILTER (WHERE source_model_version IS DISTINCT FROM '2026-09-21-v5')::bigint AS model_version_mismatch,
  BOOL_AND(NOT buy_authorized AND NOT strategy_switch_authorized AND NOT interface_change_authorized)
    AS no_trade_no_ui_invariant
FROM private.asheng_vnext_eod_shadow
GROUP BY as_of;

REVOKE ALL ON TABLE private.asheng_vnext_eod_shadow_daily FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE private.asheng_vnext_eod_shadow_daily TO service_role;
COMMENT ON VIEW private.asheng_vnext_eod_shadow_daily IS
 'Read-only whole-universe vNext data coverage and V5 EOD candidate consistency; not a buy signal.';

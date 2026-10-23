-- Production minimal append-only archive for future *sampled* scanner outcomes.
-- Isolated private schema, no cron, no external scanning, no UI or trading changes.
-- Only records after 2026-10-23; earlier rotating snapshots are not backfilled or invented.
CREATE TABLE IF NOT EXISTS private.asheng_vnext_sampled_eod_archive (
  as_of date NOT NULL,
  stock_id text NOT NULL,
  scanned_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  scan_version text,
  source_stage text,
  lifecycle_state text,
  v5_eod_entry boolean NOT NULL DEFAULT false,
  v5_eod_precision boolean NOT NULL DEFAULT false,
  v5_eod_pending boolean NOT NULL DEFAULT false,
  needs_live_confirmation boolean NOT NULL DEFAULT true,
  sampled_stock_universe boolean NOT NULL DEFAULT true,
  full_market_coverage_claim boolean NOT NULL DEFAULT false,
  buy_authorized boolean NOT NULL DEFAULT false,
  interface_change_authorized boolean NOT NULL DEFAULT false,
  metrics_md5 text,
  research_context jsonb,
  PRIMARY KEY (as_of,stock_id),
  CONSTRAINT archive_no_trading CHECK (buy_authorized IS FALSE AND interface_change_authorized IS FALSE AND full_market_coverage_claim IS FALSE),
  CONSTRAINT archive_valid_source_date CHECK (as_of > DATE '2026-10-23'),
  CONSTRAINT archive_stock_id CHECK (stock_id ~ '^[0-9]{4}$')
);
ALTER TABLE private.asheng_vnext_sampled_eod_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.asheng_vnext_sampled_eod_archive FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON TABLE private.asheng_vnext_sampled_eod_archive TO service_role;
COMMENT ON TABLE private.asheng_vnext_sampled_eod_archive IS 'Append-only first-after-close per-stock observations from existing rotating scanner. Sampled cohort only, no full-market claim, no live-buy permission, no schedules.';

CREATE OR REPLACE FUNCTION private.asheng_archive_vnext_sampled_eod_v1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path=pg_catalog,private,public
AS $body$
BEGIN
  -- Strictly future, after market close; no new scans, never add old research as forward data.
  IF NEW.as_of IS NULL OR NEW.as_of <= DATE '2026-10-23' OR
     NEW.scanned_at IS NULL OR
     NEW.scanned_at < ((NEW.as_of::timestamp + interval '13 hours 30 minutes') AT TIME ZONE 'Asia/Taipei') OR
     NEW.stock_id !~ '^[0-9]{4}$' THEN
    RETURN NEW;
  END IF;
  -- Dedup by (as_of,stock_id). Retains the first EOD observation, preventing revised outcomes from replacing past proof.
  INSERT INTO private.asheng_vnext_sampled_eod_archive
      (as_of,stock_id,scanned_at,scan_version,source_stage,lifecycle_state,
       v5_eod_entry,v5_eod_precision,v5_eod_pending,needs_live_confirmation,
       metrics_md5,research_context)
  VALUES
      (NEW.as_of,NEW.stock_id,NEW.scanned_at,
       NULLIF(NEW.metrics #>> '{model,version}',''), NEW.stage,
       NEW.metrics #>> '{trade_lifecycle,entry,state}',
       COALESCE((NEW.metrics #>> '{v5,entry_confirmed}')='true',false),
       COALESCE((NEW.metrics #>> '{v5,precision_confirmed}')='true',false),
       COALESCE((NEW.metrics #>> '{v5,pending_ready}')='true',false),
       COALESCE((NEW.metrics #>> '{trade_lifecycle,entry,live_confirmation_required}')='true',true),
       md5(COALESCE(NEW.metrics::text,'')),
       jsonb_build_object(
         'source_version',NEW.metrics #>> '{model,version}',
         'v5_entry',NEW.metrics #>> '{v5,entry_confirmed}',
         'v5_precision',NEW.metrics #>> '{v5,precision_confirmed}',
         'v5_pending',NEW.metrics #>> '{v5,pending_ready}',
         'v5_depth',NEW.metrics #>> '{v5,pullback_depth_pct}',
         'v5_days',NEW.metrics #>> '{v5,pullback_days}',
         'v5_chip',NEW.metrics #>> '{v5,chip_score}',
         'chase_pass',NEW.metrics #>> '{chase_risk,pass}',
         'source_eod_state',NEW.metrics #>> '{trade_lifecycle,entry,state}'
       ))
  ON CONFLICT (as_of,stock_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Fail open for the EXISTING scanner. A research archive fault must never roll back
  -- a successful stock scan. The source audit will reveal missing archive coverage.
  RAISE LOG 'asheng sampled research EOD archive skipped, SQLSTATE=%',SQLSTATE;
  RETURN NEW;
END
$body$;

DROP TRIGGER IF EXISTS asheng_archive_vnext_sampled_eod_v1
  ON public.spring_swallow_scan_results;
CREATE TRIGGER asheng_archive_vnext_sampled_eod_v1
AFTER INSERT OR UPDATE OF metrics,as_of
ON public.spring_swallow_scan_results
FOR EACH ROW
EXECUTE FUNCTION private.asheng_archive_vnext_sampled_eod_v1();

CREATE OR REPLACE VIEW private.asheng_vnext_sampled_eod_archive_daily
WITH (security_invoker=true) AS
SELECT a.as_of,COUNT(*)::bigint AS sampled_records,
  COUNT(*) FILTER(WHERE v5_eod_entry)::bigint AS eod_entry_candidates,
  COUNT(*) FILTER(WHERE v5_eod_precision AND v5_eod_entry)::bigint AS eod_precision_candidates,
  COUNT(*) FILTER(WHERE v5_eod_pending AND NOT v5_eod_entry)::bigint AS eod_watch_candidates,
  COUNT(*) FILTER(WHERE scan_version IS DISTINCT FROM '2026-09-21-v5')::bigint AS mismatched_model_versions,
  COUNT(*) FILTER(WHERE v5_eod_entry AND lifecycle_state IS DISTINCT FROM 'formal_candidate')::bigint AS status_conflicts,
  COUNT(*) FILTER(WHERE NOT needs_live_confirmation)::bigint AS cases_without_live_confirmation_flag,
  COUNT(*) FILTER(WHERE buy_authorized OR interface_change_authorized OR full_market_coverage_claim)::bigint AS unsafe_authorizations,
  MIN(scanned_at) AS first_scanned_at,MAX(scanned_at) AS last_scanned_at,
  TRUE::boolean AS sampled_cohort_only,
  FALSE::boolean AS full_market_or_proven_profit
FROM private.asheng_vnext_sampled_eod_archive a
GROUP BY as_of;
REVOKE ALL ON TABLE private.asheng_vnext_sampled_eod_archive_daily FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE private.asheng_vnext_sampled_eod_archive_daily TO service_role;
COMMENT ON VIEW private.asheng_vnext_sampled_eod_archive_daily IS 'Daily incremental sampled scan evidence, never full-market or live-buy proof. Earliest eligible observation after 2026-10-23.';

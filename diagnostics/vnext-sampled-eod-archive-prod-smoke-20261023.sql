-- Production QA for EOD sampled archive, safe to rerun any time, read-only.
WITH archive AS (
 SELECT COUNT(*)::bigint AS rows,
        COUNT(*) FILTER(WHERE buy_authorized OR interface_change_authorized OR full_market_coverage_claim)::bigint AS unsafe,
        COUNT(*) FILTER(WHERE as_of<=DATE '2026-10-23')::bigint AS backdated,
        COUNT(*) FILTER(WHERE scanned_at < ((as_of::timestamp+interval '13 hours 30 minutes') AT TIME ZONE 'Asia/Taipei'))::bigint AS before_close,
        COUNT(*)-COUNT(DISTINCT (as_of,stock_id))::bigint AS duplicates
 FROM private.asheng_vnext_sampled_eod_archive
), valid_trigger AS (
 SELECT
  COUNT(*) FILTER(WHERE t.tgenabled='O')::int AS enabled_triggers,
  COUNT(*) FILTER(WHERE
    pg_get_functiondef(t.tgfoid) ILIKE '%ON CONFLICT (as_of,stock_id) DO NOTHING%'
    AND pg_get_functiondef(t.tgfoid) ILIKE '%EXCEPTION WHEN OTHERS%'
    AND p.prosecdef IS FALSE)::int AS validated_fail_open_funcs
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname='spring_swallow_scan_results'
 AND t.tgname='asheng_archive_vnext_sampled_eod_v1'
), priv AS (
 SELECT count(*) FILTER(WHERE
     NOT has_table_privilege('anon',c.oid,'SELECT')
     AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
     AND has_table_privilege('service_role',c.oid,'SELECT')
     AND (c.relkind <> 'v' OR c.reloptions @> ARRAY['security_invoker=true']::text[])
   ) AS secured_objects
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='private'
 AND c.relname IN ('asheng_vnext_sampled_eod_archive','asheng_vnext_sampled_eod_archive_daily',
     'asheng_vnext_eod_shadow','asheng_vnext_eod_shadow_daily','asheng_vnext_eod_coverage_audit')
)
SELECT a.rows archived_count,a.unsafe,a.backdated,a.before_close,a.duplicates,
 t.enabled_triggers,t.validated_fail_open_funcs,p.secured_objects,
 (a.unsafe=0 AND a.backdated=0 AND a.before_close=0 AND a.duplicates=0
  AND t.enabled_triggers=1 AND t.validated_fail_open_funcs=1 AND p.secured_objects=5) AS production_archive_smoke_pass
FROM archive a CROSS JOIN valid_trigger t CROSS JOIN priv p;

-- Asheng vNext EOD shadow production smoke test, read-only SQL.
-- This test must pass without any new scheduling, UI or live trading permission.
WITH latest AS (SELECT max(as_of) AS last_day FROM public.spring_swallow_scan_results),
v AS (
  SELECT
    COUNT(*) AS rows_count,
    COUNT(*) FILTER(WHERE buy_authorized OR strategy_switch_authorized OR interface_change_authorized) AS unsafe_rows,
    COUNT(*) FILTER(WHERE verified_0050_regime IS NOT NULL OR verified_new_growth_lowrange_model IS NOT NULL) AS fabricated_model_verification,
    COUNT(*) FILTER(WHERE eod_internal_conflict) AS internal_conflicts,
    MAX(as_of) AS last_view_day
  FROM private.asheng_vnext_eod_shadow
), meta AS (
 SELECT
   COUNT(*) FILTER(WHERE reloptions @> ARRAY['security_invoker=true']::text[]) AS secured_views,
   COUNT(*) FILTER(WHERE NOT has_table_privilege('anon',oid,'SELECT') AND
                             NOT has_table_privilege('authenticated',oid,'SELECT') AND
                             has_table_privilege('service_role',oid,'SELECT')) AS private_views
 FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
 WHERE n.nspname='private'
   AND c.relname IN ('asheng_vnext_eod_shadow','asheng_vnext_eod_shadow_daily')
)
SELECT
 v.rows_count,
 v.last_view_day,
 latest.last_day,
 v.unsafe_rows,
 v.fabricated_model_verification,
 v.internal_conflicts,
 meta.secured_views,
 meta.private_views,
 (v.rows_count >= 100 AND v.last_view_day=latest.last_day AND
  v.unsafe_rows=0 AND v.fabricated_model_verification=0 AND
  v.internal_conflicts=0 AND meta.secured_views=2 AND meta.private_views=2)
  AS shadow_release_smoke_test_pass
FROM v CROSS JOIN meta CROSS JOIN latest;

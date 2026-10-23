-- Regression guard after 2026-10-23 coverage fix. Read-only.
-- As of 2026-10-23 10:xx Taipei daily rotating scanner has max 450 calls vs 2132 active stocks.
-- 'as_of' stock table is latest-per-stock PK, so only partial cohorts are recorded per day.
WITH coverage AS (
SELECT c.as_of,c.active_stocks,c.latest_stock_rows_for_as_of,c.active_stocks_observed,
 c.full_active_universe_verified,c.coverage_status,c.latest_attempt_failed,c.latest_attempt_claimed,
 d.forward_eligible_rows,d.eod_entry_candidates,
 d.no_trade_no_ui_invariant
FROM private.asheng_vnext_eod_coverage_audit c
JOIN private.asheng_vnext_eod_shadow_daily d ON d.as_of=c.as_of
),privileges AS (
SELECT
 count(*) AS secured_view_count,
 count(*) FILTER(WHERE c.reloptions @> ARRAY['security_invoker=true']::text[]
 AND NOT has_table_privilege('anon',c.oid,'SELECT')
 AND NOT has_table_privilege('authenticated',c.oid,'SELECT')
 AND has_table_privilege('service_role',c.oid,'SELECT')) AS secured_private_service_read
FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid
WHERE n.nspname='private'
AND c.relname IN ('asheng_vnext_eod_shadow','asheng_vnext_eod_shadow_daily','asheng_vnext_eod_coverage_audit')
)
SELECT
 count(*)::int AS observed_dates,
 count(*) FILTER(WHERE NOT full_active_universe_verified)::int AS partial_dates,
 count(*) FILTER(WHERE NOT full_active_universe_verified AND forward_eligible_rows<>0)::int AS unsafe_false_full_cohorts,
 count(*) FILTER(WHERE as_of>DATE '2026-10-23' AND full_active_universe_verified=false AND forward_eligible_rows>0)::int AS unsafe_forward_eligible_after_freeze,
 count(*) FILTER(WHERE no_trade_no_ui_invariant IS DISTINCT FROM TRUE)::int AS unauthorized_trade_or_ui,
 count(*) FILTER(WHERE latest_stock_rows_for_as_of>active_stocks)::int AS impossible_active_cohort_rows,
 max(as_of)::text AS latest_source_date,
 max(active_stocks)::bigint AS master_active_count,
 max(latest_stock_rows_for_as_of)::bigint AS max_per_date_rows,
 max(latest_attempt_failed) FILTER(WHERE as_of=(SELECT max(as_of) FROM coverage))::bigint AS latest_failed,
 max(latest_attempt_claimed) FILTER(WHERE as_of=(SELECT max(as_of) FROM coverage))::bigint AS latest_claimed,
 privileges.secured_view_count,
 privileges.secured_private_service_read,
 (count(*)>0
 AND count(*) FILTER(WHERE NOT full_active_universe_verified AND forward_eligible_rows<>0)=0
 AND count(*) FILTER(WHERE no_trade_no_ui_invariant IS DISTINCT FROM TRUE)=0
 AND privileges.secured_view_count=3
 AND privileges.secured_private_service_read=3) AS regression_pass
FROM coverage CROSS JOIN privileges
GROUP BY privileges.secured_view_count,privileges.secured_private_service_read;

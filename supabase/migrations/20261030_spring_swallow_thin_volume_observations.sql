-- Applied to production 2026-10-30. Generic low-turnover observations only.
-- Preserve all original candidate, liquidity, risk, formal-entry and schedule rules.
-- This migration records the live DB function for repeatable environments.
CREATE OR REPLACE FUNCTION public.spring_swallow_picks_candidates(p_since timestamp with time zone)
 RETURNS SETOF spring_swallow_scan_results
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select r.*
  from public.spring_swallow_scan_results r
  where r.scanned_at >= p_since
    and (
      r.stage in ('B','C')
      or coalesce((r.metrics->>'current_volume_lots')::numeric,0) >= 1000
      or coalesce((r.metrics#>>'{bottom_start,confirmed}')::boolean,false)
      or coalesce((r.metrics#>>'{bottom_start,current_base}')::boolean,false)
      or r.metrics#>>'{trade_lifecycle,entry,state}' in ('formal_candidate','starter','near')
      or coalesce((r.metrics#>>'{ma_cluster,breakout_detected_raw}')::boolean,false)
      or coalesce((r.metrics#>>'{ma_cluster,watch_ready}')::boolean,false)
      or coalesce((r.metrics#>>'{ma_cluster,breakout_first_bar}')::boolean,false)
      or coalesce((r.metrics#>>'{launch_sequence,second_buy_candidate}')::boolean,false)
      or coalesce((r.metrics#>>'{ma_cluster,launch_sequence,second_buy_candidate}')::boolean,false)
      or coalesce(r.metrics#>>'{scan_intelligence,effective_lifecycle}','NONE') in ('PRELAUNCH','ACTIVE','ENTRY')
      or (
        coalesce(
          (r.metrics#>>'{launch_sequence,days_since_first}')::numeric,
          (r.metrics#>>'{ma_cluster,launch_sequence,days_since_first}')::numeric
        ) between 1 and 5
      )
      or coalesce((r.metrics#>>'{launch_candidate,eligible}')::boolean,false)
      or (
        coalesce((r.scores->>'A')::numeric,0) >= 80
        and coalesce((r.metrics->>'position_1y_pct')::numeric,999) <= 35
      )
      or (
        -- Low-liquidity anomaly is admitted to S observation transport ONLY.
        -- No change to scanned universe, trade eligibility, quotas or risk model.
        coalesce((r.metrics->>'avg_volume_20_lots')::numeric,0) >= 5
        and coalesce((r.metrics->>'avg_volume_20_lots')::numeric,0) < 200
        and coalesce((r.metrics->>'current_volume_lots')::numeric,0) >= 10
        and coalesce((r.metrics->>'current_volume_lots')::numeric,0) < 1000
        and (r.metrics->>'current_volume_lots')::numeric /
            nullif((r.metrics->>'avg_volume_20_lots')::numeric,0) between 1.5 and 15
        and coalesce((r.metrics->>'position_1y_pct')::numeric,999) between 0 and 84.999
        and coalesce((r.metrics->>'close')::numeric,0)>0
        and coalesce((r.metrics->>'ma20')::numeric,0)>0
        and (
          (
            coalesce((r.metrics->>'first_breakout20')::boolean,false)
            and coalesce((r.metrics->>'current_volume_lots')::numeric,0)>=20
            and (r.metrics->>'current_volume_lots')::numeric /
                nullif((r.metrics->>'avg_volume_20_lots')::numeric,0)>=2.5
            and coalesce((r.metrics->>'high20_prev')::numeric,0)>0
            and (r.metrics->>'close')::numeric >= (r.metrics->>'high20_prev')::numeric
          )
          or (
            coalesce((r.metrics->>'high20_prev')::numeric,0)>0
            and (r.metrics->>'close')::numeric >= (r.metrics->>'high20_prev')::numeric * .94
            and (r.metrics->>'close')::numeric < (r.metrics->>'high20_prev')::numeric
            and (r.metrics->>'close')::numeric /
                nullif((r.metrics->>'ma20')::numeric,0) between .97 and 1.12
          )
        )
      )
    )
  order by r.score desc, r.scanned_at desc, r.stock_id asc;
$function$;

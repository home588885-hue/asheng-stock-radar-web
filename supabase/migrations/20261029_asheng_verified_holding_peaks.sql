-- Additive, forward-only authenticated peak evidence store; does not touch holding prices,
-- positions, existing old peak_close, scan budget, scheduler or trading decisions.
-- A verified peak is an observed post-purchase price, NOT full historical highest price.
create table if not exists public.asheng_holding_verified_peaks (
 user_id uuid not null references auth.users(id) on delete cascade,
 stock_id text not null check (stock_id ~ '^[0-9A-Z.-]{2,12}$'),
 position_bought_at timestamptz not null,
 position_avg_cost numeric not null check (position_avg_cost > 0),
 position_updated_at timestamptz not null,
 peak_price numeric not null check (peak_price > 0),
 peak_observed_at timestamptz not null,
 peak_source text not null check (peak_source in (
    'twse_mis_last_trade','twse_mis_daily_high_postbuy')),
 last_checked_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint verified_peak_after_purchase check (peak_observed_at >= position_bought_at),
 primary key(user_id,stock_id)
);
alter table public.asheng_holding_verified_peaks enable row level security;
revoke all on table public.asheng_holding_verified_peaks from public, anon, authenticated;
grant select on table public.asheng_holding_verified_peaks to authenticated;
grant select,insert,update,delete on table public.asheng_holding_verified_peaks to service_role;
create policy "authenticated holders read only their observed peaks"
on public.asheng_holding_verified_peaks for select to authenticated
using ((select auth.uid()) = user_id);

-- Invoker privileges are service_role-only. This single statement serializes concurrent
-- updates for a user/stock. It never lowers an observation for an unchanged position.
create or replace function public.asheng_upsert_verified_holding_peak(
 p_user_id uuid, p_stock_id text, p_bought_at timestamptz, p_cost numeric,
 p_position_updated_at timestamptz, p_peak numeric, p_observed_at timestamptz,
 p_source text
) returns setof public.asheng_holding_verified_peaks
language sql security invoker set search_path=''
as $$
 insert into public.asheng_holding_verified_peaks
 (user_id,stock_id,position_bought_at,position_avg_cost,position_updated_at,
  peak_price,peak_observed_at,peak_source,last_checked_at,updated_at)
 values (p_user_id,p_stock_id,p_bought_at,p_cost,p_position_updated_at,
         p_peak,p_observed_at,p_source,now(),now())
 on conflict (user_id,stock_id) do update set
 position_bought_at=excluded.position_bought_at,
 position_avg_cost=excluded.position_avg_cost,
 position_updated_at=excluded.position_updated_at,
 peak_price=case when
  public.asheng_holding_verified_peaks.position_bought_at=excluded.position_bought_at
  and public.asheng_holding_verified_peaks.position_avg_cost=excluded.position_avg_cost
  then greatest(public.asheng_holding_verified_peaks.peak_price,excluded.peak_price)
  else excluded.peak_price end,
 peak_observed_at=case when
  public.asheng_holding_verified_peaks.position_bought_at=excluded.position_bought_at
  and public.asheng_holding_verified_peaks.position_avg_cost=excluded.position_avg_cost
  and public.asheng_holding_verified_peaks.peak_price>=excluded.peak_price
  then public.asheng_holding_verified_peaks.peak_observed_at
  else excluded.peak_observed_at end,
 peak_source=case when
  public.asheng_holding_verified_peaks.position_bought_at=excluded.position_bought_at
  and public.asheng_holding_verified_peaks.position_avg_cost=excluded.position_avg_cost
  and public.asheng_holding_verified_peaks.peak_price>=excluded.peak_price
  then public.asheng_holding_verified_peaks.peak_source
  else excluded.peak_source end,
 last_checked_at=now(),
 updated_at=now()
 where (
  public.asheng_holding_verified_peaks.position_bought_at=excluded.position_bought_at
  and public.asheng_holding_verified_peaks.position_avg_cost=excluded.position_avg_cost
  and excluded.position_updated_at>=public.asheng_holding_verified_peaks.position_updated_at
  and excluded.peak_observed_at>=public.asheng_holding_verified_peaks.peak_observed_at
 ) or (
  excluded.position_bought_at>public.asheng_holding_verified_peaks.position_bought_at
  and excluded.position_updated_at>public.asheng_holding_verified_peaks.position_updated_at
 ) or (
  excluded.position_bought_at=public.asheng_holding_verified_peaks.position_bought_at
  and excluded.position_avg_cost<>public.asheng_holding_verified_peaks.position_avg_cost
  and excluded.position_updated_at>public.asheng_holding_verified_peaks.position_updated_at
 )
 returning *;
$$;
revoke all on function public.asheng_upsert_verified_holding_peak(
 uuid,text,timestamptz,numeric,timestamptz,numeric,timestamptz,text)
 from public,anon,authenticated;
grant execute on function public.asheng_upsert_verified_holding_peak(
 uuid,text,timestamptz,numeric,timestamptz,numeric,timestamptz,text)
 to service_role;

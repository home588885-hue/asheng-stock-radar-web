import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { buildSectorRotation } from './rotation-score.mjs';
import {fixedSectorCohort, verifiedMisTrade, summarizeVerifiedLive, marketClock} from './intraday-score.mjs';

const headers={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,OPTIONS',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type',
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private,no-store'
};
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});

const nowBucket=(now:Date)=>new Date(Math.floor(now.getTime()/300000)*300000).toISOString();
const hideSamples=(raw:any)=>{
  const {samples, ...publicPayload}=raw;
  return publicPayload;
};
async function fetchMisSamples(cohort:any[],now:Date){
  const trades:any[]=[];
  const batches=[];
  for(let i=0;i<cohort.length;i+=30)batches.push(cohort.slice(i,i+30));
  for(let i=0;i<batches.length;i+=2){
    const work=batches.slice(i,i+2);
    const results=await Promise.allSettled(work.map(async(batch)=>{
      const byId=new Map(batch.map((x:any)=>[x.stock_id,x]));
      const ch=batch.map((x:any)=>(x.market==='tpex'?'otc':'tse')+'_'+x.stock_id+'.tw').join('|');
      const url='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+
         encodeURIComponent(ch)+'&json=1&delay=0&_='+now.getTime();
      const reply=await fetch(url,{headers:{
         Accept:'application/json,text/plain,*/*',
         Referer:'https://mis.twse.com.tw/stock/index.jsp',
         'User-Agent':'Mozilla/5.0'
       },signal:AbortSignal.timeout(6000)});
      if(!reply.ok)throw new Error('twse_quote_status');
      const data=await reply.json();
      const rows=Array.isArray(data?.msgArray)?data.msgArray:[];
      return rows.map((row:any)=>verifiedMisTrade(row,byId.get(String(row?.c||'')),now)).filter(Boolean);
    }));
    for(const r of results)if(r.status==='fulfilled')trades.push(...r.value);
  }
  return trades;
}
async function intradaySnapshot(db:any,data:any[],asOf:string,fallback:any,now=new Date()){
  const clock=marketClock(now);
  const sourceDiff=(Date.parse(clock.day+'T00:00:00Z')-Date.parse(asOf+'T00:00:00Z'))/86400000;
  const unavailable=(reason:string)=>({...fallback,mode:'eod_fallback',
    live:false,intraday_status:reason,model_as_of:asOf});
  if(!clock.samplingReady)return unavailable('outside_verified_market_window');
  if(!(sourceDiff>=1 && sourceDiff<=5))return unavailable('prior_eod_cohort_not_fresh');
  const cohort=fixedSectorCohort(data,asOf);
  if(cohort.length<24)return unavailable('insufficient_frozen_cohort');
  // Shared 5-minute bucket avoids writing duplicate snapshots. Read only on
  // foreground requests; there is no background worker, cron or paid scan.
  const {data:recent,error:re}=await db.from('asheng_sector_intraday_observations')
    .select('observation,observed_at').eq('market_date',clock.day)
    .eq('model_as_of',asOf).gte('observed_at',new Date(now.getTime()-90000).toISOString())
    .order('observed_at',{ascending:false}).limit(1);
  if(!re && recent?.[0]?.observation?.scope==='subset_of_verified_current_trade_not_full_market'){
    const cached=recent[0].observation;
    if(cached?.live===true)return {...hideSamples(cached),mode:'intraday',cache_hit:true,
      eod_fallback:fallback};
  }
  const trades=await fetchMisSamples(cohort,now);
  const raw=summarizeVerifiedLive(trades,cohort,asOf,now);
  if(!raw.live)return unavailable('quotes_insufficient_or_stale');
  const observed={
    ...raw,scanned_sector_count:raw.sectors.filter((x:any)=>x.kind!=='insufficient').length
  };
  // A prospective study snapshot contains observed symbol prices and timestamps,
  // frozen here, BEFORE any future 5/10/20-day EOD outcomes are known.
  const {error:writeError}=await db.from('asheng_sector_intraday_observations').upsert({
    bucket_start:nowBucket(now),market_date:clock.day,model_as_of:asOf,
    observed_at:now.toISOString(),selected_count:cohort.length,
    valid_count:raw.valid_count,observation:observed
  },{onConflict:'bucket_start'});
  if(writeError){
    console.error('sector_forward_snapshot_not_saved',String(writeError.message||''));
    // Fail closed: don't label a research sample as tracked if persistence failed.
    return {...hideSamples(observed),mode:'intraday',forward_record_saved:false,
      eod_fallback:fallback};
  }
  return {...hideSamples(observed),mode:'intraday',forward_record_saved:true,
    eod_fallback:fallback};
}

Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='GET')return respond({ok:false,error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
  const bearer=req.headers.get('Authorization')||'';
  if(!url||!key||!anon)return respond({ok:false,error:'config_missing'},503);
  if(!/^Bearer\s+\S+$/.test(bearer))return respond({ok:false,error:'unauthorized'},401);
  try{
    // Enforce identity in the handler. Never trust arbitrary client portfolio IDs.
    const auth=createClient(url,anon,{global:{headers:{Authorization:bearer}},
      auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await auth.auth.getUser();
    if(userError||!userData?.user?.id)return respond({ok:false,error:'unauthorized'},401);
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:latest,error:le}=await db.from('spring_swallow_scan_results')
      .select('as_of').order('as_of',{ascending:false}).limit(1);
    if(le||!latest?.[0]?.as_of)throw new Error('no_valid_snapshot_date');
    const asOf=String(latest[0].as_of);
    // Only the most recent EOD model date. Never mix scans from other days.
    const {data,error}=await db.from('spring_swallow_scan_results')
      .select('stock_id,industry,as_of,close:metrics->>close,prev_close:metrics->>prev_close,current_volume_lots:metrics->>current_volume_lots,avg_volume_20_lots:metrics->>avg_volume_20_lots')
      .eq('as_of',asOf).order('stock_id',{ascending:true}).limit(1000);
    if(error||!Array.isArray(data))throw new Error('snapshot_read_failed');
    const result=buildSectorRotation(data,asOf,new Date(),data.length>=1000);
    if(new URL(req.url).searchParams.get('mode')==='intraday'){
      const live=await intradaySnapshot(db,data,asOf,result);
      return respond({...live,generated_at:new Date().toISOString(),
        is_net_inflow:false,
        caveat:'盤中為TWSE MIS有效成交與凍結的前日K樣本；不是全市場或主力法人資金淨流入，不能單獨作為買進依據。'});
    }
    return respond({...result,generated_at:new Date().toISOString(),
      caveat:'量價僅為最新完整日K掃描樣本，不是全市場或法人資金淨流入，也不是即時成交。'});
  }catch(e){
    console.error('asheng_sector_rotation_failed',String(e));
    return respond({ok:false,error:'sector_rotation_unavailable',live:false},503);
  }
});

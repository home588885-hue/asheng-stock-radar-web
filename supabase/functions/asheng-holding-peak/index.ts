import {createClient} from 'npm:@supabase/supabase-js@2.117.3';
import {verifiedTwsePeak} from '../_shared/asheng-twse-peak-evidence.mjs';

// An authenticated, on-demand, free-MIS observation endpoint.
// No scanner, cron, automatic trading, cross-account access, or client-supplied price.
const ADMIN_PORTFOLIO_ID = 'd092f22e-9d7a-408a-8e8b-4c95e31e3a10';
const H={'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization,apikey,content-type',
 'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
const output=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:H});
const stockOK=(s:unknown)=>typeof s==='string' && /^[0-9A-Z.-]{2,12}$/.test(s);
const validMoney=(x:unknown)=>x!==null && x!==undefined && Number.isFinite(Number(x)) && Number(x)>0;
const dateOK=(a:unknown,b:unknown)=>Number.isFinite(Date.parse(String(a))) &&
 Number.isFinite(Date.parse(String(b))) && Date.parse(String(a))===Date.parse(String(b));
function samePosition(p:any,row:any) {
 return p?.active===true && dateOK(p.bought_at,row.position_bought_at)
  && validMoney(p.avg_cost) && validMoney(row.position_avg_cost)
  && Math.abs(Number(p.avg_cost)-Number(row.position_avg_cost))<=Math.max(1e-6,Number(p.avg_cost)*1e-8);
}
async function getExchangeQuotes(rows:any[]) {
 const market=new Map<string,string>();
 for(const x of rows) market.set(String(x.stock_id),String(x.market).toLowerCase()==='tpex'?'otc':'tse');
 const channels=[...market].map(([id,m])=>m+'_'+id+'.tw').join('|');
 const url='https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch='+
  encodeURIComponent(channels)+'&json=1&delay=0&_='+Date.now();
 const response=await fetch(url,{headers:{
  Accept:'application/json,text/plain,*/*',
  Referer:'https://mis.twse.com.tw/stock/index.jsp',
  'User-Agent':'Mozilla/5.0'
 },signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('exchange_quote_unavailable');
 const json=await response.json();
 const result=new Map<string,any>();
 const positive=(v:unknown)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
 for(const q of Array.isArray(json?.msgArray)?json.msgArray:[]){
  const id=String(q.c||'').toUpperCase();
  if(!market.has(id) || result.has(id))continue;
  const localDay=String(q.d||'').replace(/[^0-9]/g,'');
  const primary=positive(q.z),nested=positive(q?.trade?.z);
  const price=primary??nested;
  const time=String(primary!==null?q.t:(q?.trade?.t||q.t||''));
  const volume=positive(q.v);
  result.set(id,{
    quote_date:localDay,quote_time:time,
    price,high:positive(q.h),volume_lots:volume,
    has_today_trade:price!==null&&volume!==null,
    price_source:primary!==null?'mis_last_trade':'mis_trade_last'
  });
 }
 return result;
}

Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:H});
 if(req.method!=='GET'&&req.method!=='POST')return output({ok:false,error:'method_not_allowed'},405);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
 const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const authHeader=req.headers.get('Authorization')||'';
 if(!url||!anon||!serviceKey) return output({ok:false,error:'service_config_missing'},503);
 if(!/^Bearer\s+\S+$/.test(authHeader))return output({ok:false,error:'unauthorized'},401);
 const userClient=createClient(url,anon,{
  global:{headers:{Authorization:authHeader}},
  auth:{persistSession:false,autoRefreshToken:false}
 });
 const {data:ud,error:ue}=await userClient.auth.getUser();
 if(ue||!ud?.user?.id)return output({ok:false,error:'unauthorized'},401);
 const user=ud.user;
 const {data:member,error:membershipError}=await userClient.from('radar_memberships')
  .select('role,status,current_period_end').eq('user_id',user.id).maybeSingle();
 if(membershipError)return output({ok:false,error:'membership_unavailable'},503);
 const isAdmin=member?.role==='admin';
 const isActive=isAdmin||(member&&['trialing','active'].includes(String(member.status))
    &&(!member.current_period_end||Date.parse(member.current_period_end)>Date.now()));
 if(!isActive)return output({ok:false,error:'membership_required'},403);
 const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 const holdingsQuery=(isAdmin?service.from('spring_swallow_holdings')
   .select('stock_id,avg_cost,bought_at,updated_at,active')
   .eq('portfolio_id',ADMIN_PORTFOLIO_ID)
   :userClient.from('radar_member_holdings')
   .select('stock_id,avg_cost,bought_at,updated_at,active')
   .eq('user_id',user.id)).eq('active',true);
 const {data:positions,error:he}=await holdingsQuery;
 if(he||!Array.isArray(positions))return output({ok:false,error:'holdings_unavailable'},503);
 const held=new Map(positions.filter((p:any)=>stockOK(p.stock_id)).map((p:any)=>[p.stock_id,p]));
 const {data:oldPeaks,error:pe}=await service.from('asheng_holding_verified_peaks')
  .select('stock_id,position_bought_at,position_avg_cost,peak_price,peak_observed_at,peak_source,last_checked_at')
  .eq('user_id',user.id);
 if(pe)return output({ok:false,error:'peak_state_unavailable'},503);
 const known=new Map((oldPeaks||[]).map((x:any)=>[x.stock_id,x]));
 const expose=()=>[...held].map(([id,pos])=>{
  const state:any=known.get(id);
  return {stock_id:id,peak:state&&samePosition(pos,state)?{
    price:Number(state.peak_price),observed_at:state.peak_observed_at,
    source:state.peak_source,history_complete:false
  }:null};
 });
 if(req.method==='GET')return output({ok:true,observations:expose(),history_complete:false});
 let body:any;
 try{body=await req.json()}catch{return output({ok:false,error:'invalid_json'},400)}
 if(body?.action!=='observe')return output({ok:false,error:'unknown_action'},400);
 const ids=Array.isArray(body?.stock_ids)?body.stock_ids:null;
 if(!ids||!ids.length||ids.length>30||new Set(ids).size!==ids.length
    ||ids.some((id:unknown)=>!stockOK(id)||!held.has(id)))
  return output({ok:false,error:'invalid_or_unowned_stocks'},400);
 const now=new Date();
 // Network call is a single TWSE MIS batch of <=30, not a paid full-K scan.
 const {data:stocks,error:se}=await service.from('spring_swallow_stock_master')
  .select('stock_id,market').in('stock_id',ids).eq('active',true);
 if(se)return output({ok:false,error:'stock_directory_unavailable'},503);
 let quotes:Map<string,any>;
 try {quotes=await getExchangeQuotes(stocks||[])}
 catch{return output({ok:false,error:'exchange_quote_unavailable',observations:expose()},503)}
 let updated=0;const rejected:{stock_id:string,reason:string}[]=[];
 for(const id of ids){
  const holding:any=held.get(id);
  const previous:any=known.get(id);
  if(previous&&samePosition(holding,previous) && previous.last_checked_at &&
    now.getTime()-Date.parse(previous.last_checked_at)<60000){
    rejected.push({stock_id:id,reason:'recently_checked'});continue;
  }
  const q=quotes.get(id);
  const evidence=verifiedTwsePeak(q,holding,now);
  if(!evidence.ok){rejected.push({stock_id:id,reason:evidence.reason});continue;}
  if(!('high' in evidence)||!('source' in evidence)||!('observedAt' in evidence)){
    rejected.push({stock_id:id,reason:'no_verifiable_high'});continue;
  }
  const {data:stored,error:writeError}=await service.rpc('asheng_upsert_verified_holding_peak',{
    p_user_id:user.id,p_stock_id:id,p_bought_at:holding.bought_at,
    p_cost:Number(holding.avg_cost),p_position_updated_at:holding.updated_at,
    p_peak:evidence.high,p_observed_at:evidence.observedAt,p_source:evidence.source
  });
  if(writeError||!Array.isArray(stored)||stored.length!==1) {
    rejected.push({stock_id:id,reason:'peak_persist_failed_or_superseded'});continue;
  }
  known.set(id,stored[0]);updated++;
 }
 return output({ok:true,updated,rejected,observations:expose(),history_complete:false});
});

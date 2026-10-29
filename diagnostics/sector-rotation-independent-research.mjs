/**
 * Independently derived, read-only industry research (no ToAlpha data/code).
 * The "flow" is CHANGE IN SHARE OF TRADED VALUE in percentage points.
 * It is not foreign/institutional net buying and not a cash inflow.
 * Operates only on equal, paired stock cohorts at two completed EOD sessions.
 */
const positive=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))&&Number(x)>0;
const safe=(value)=>Number(value);
// Official exchange TRADED VALUE (TWD), not close × volume. The latter
// systematically distorts volatility/turnover and is not an actual value.
const money=row=>safe(row.trade_value_twd);
const validDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x||''));
function dateMap(rows,date){
  const found=new Map();
  const duplicates=new Set();
  for(const row of rows||[]){
    const id=String(row?.stock_id||''),group=String(row?.industry||'').trim();
    const market=String(row?.market||'').toLowerCase();
    const key=market+':'+id;
    if(!id||!['twse','tpex'].includes(market)||!group||group==='其他'
      ||String(row?.date||'')!==date||!positive(row?.close)
      ||!positive(row?.trade_value_twd))continue;
    if(found.has(key)){duplicates.add(key);continue;}
    found.set(key,{stock_id:id,market,industry:group,amount:money(row),close:Number(row.close)});
  }
  for(const id of duplicates)found.delete(id);
  return found;
}
export function comparableTurnoverShift(prevRows,todayRows,prevDate,todayDate,{
  minOverall=25,minGroup=8,minCoverage=.85
}={}){
  if(!validDate(prevDate)||!validDate(todayDate)||todayDate<=prevDate)
    return {ok:false,reason:'bad_as_of_dates',groups:[]};
  const a=dateMap(prevRows,prevDate),b=dateMap(todayRows,todayDate);
  const totalUniverse=new Set([...a.keys(),...b.keys()]).size;
  const paired=[];
  for(const [id,older] of a){
    const latest=b.get(id);
    if(!latest||older.industry!==latest.industry||older.market!==latest.market)continue;
    const pct=100*(latest.close/older.close-1);
    if(!Number.isFinite(pct)||Math.abs(pct)>35)continue; // suspected split/data issue
    paired.push({id,industry:latest.industry,prev:older.amount,today:latest.amount});
  }
  const coverage=totalUniverse>0?paired.length/totalUniverse:0;
  if(paired.length<minOverall||coverage<minCoverage)return {
    ok:false,reason:'noncomparable_or_low_coverage',count:paired.length,
    candidate_count:totalUniverse,coverage_pct:Math.round(coverage*1000)/10,groups:[]
  };
  const previousTotal=paired.reduce((sum,r)=>sum+r.prev,0);
  const todayTotal=paired.reduce((sum,r)=>sum+r.today,0);
  if(!(previousTotal>0&&todayTotal>0))return {ok:false,reason:'zero_trade_value',groups:[]};
  const groups=new Map();
  for(const x of paired){
    const v=groups.get(x.industry)||{industry:x.industry,n:0,previous:0,today:0};
    v.n++;v.previous+=x.prev;v.today+=x.today;groups.set(x.industry,v);
  }
  const outcomes=[...groups.values()].map(v=>{
    const sharePrev=v.previous/previousTotal*100;
    const shareToday=v.today/todayTotal*100;
    const pp=shareToday-sharePrev;
    return {industry:v.industry,n:v.n,share_previous_pct:+sharePrev.toFixed(3),
      share_today_pct:+shareToday.toFixed(3),turnover_share_shift_pp:+pp.toFixed(3),
      status:v.n<minGroup?'insufficient':pp>0.2?'share_gaining':pp< -0.2?'share_losing':'stable'};
  }).sort((x,y)=>y.turnover_share_shift_pp-x.turnover_share_shift_pp);
  return {ok:true,flow_type:'relative_official_traded_value_share_shift_pp_not_net_buying',
    source_requirement:'official_actual_trade_value_twd_not_price_times_volume',
    previous_date:prevDate,today_date:todayDate,complete_eod_only:true,
    comparable_count:paired.length,candidate_count:totalUniverse,
    coverage_pct:Math.round(coverage*1000)/10,
    groups:outcomes};
}
/**
 * Independent relative-strength research:
 * ratio = sector equal-weight price index / benchmark index;
 * RS = current ratio / prior 50-period mean * 100;
 * momentum = RS / RS 10 sessions earlier * 100.
 * Missing or unadjusted data => do not infer a quadrant.
 */
export function relativeRotation(series,{lookback=50,momentum=10}={}){
  if(!Array.isArray(series)||series.length<lookback+momentum)return {
    ok:false,reason:'not_enough_point_in_time_trading_sessions'
  };
  const rs=[];
  let lastDay='';
  for(const x of series){
    if(!validDate(x?.date)||x.date<=lastDay||!positive(x.sector_index)||!positive(x.market_index))
      return {ok:false,reason:'missing_unadjusted_or_duplicate_session'};
    lastDay=x.date;
    rs.push(Number(x.sector_index)/Number(x.market_index));
  }
  const scores=[];
  for(let i=lookback-1;i<rs.length;i++){
    const segment=rs.slice(i-lookback+1,i+1);
    const mean=segment.reduce((a,b)=>a+b,0)/lookback;
    scores.push(mean>0?rs[i]/mean*100:null);
  }
  if(scores.length<=momentum||scores.some(x=>!Number.isFinite(x)))
    return {ok:false,reason:'no_valid_rs'};
  const current=scores.at(-1),before=scores.at(-1-momentum);
  const rsm=before>0?current/before*100:null;
  if(!Number.isFinite(rsm))return {ok:false,reason:'invalid_momentum'};
  const quadrant=current>=100?(rsm>=100?'leading':'weakening'):(rsm>=100?'improving':'lagging');
  return {ok:true,date:series.at(-1).date,relative_strength:+current.toFixed(3),
    relative_momentum:+rsm.toFixed(3),quadrant,
    scope:'point_in_time_independent_research_only'};
}

// Read-only, end-of-day *sample* sector rotation. Never infer actual net buying.
export const rotationVersion='2026-10-29-eod-sample-v1';
const valid=(value)=>value!==null && value!==undefined && value!=='' && Number.isFinite(Number(value));
const number=(value)=>valid(value)?Number(value):null;
const dateOnly=(value)=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''));
export function taipeiDate(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(now);
  const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
  return p.year+'-'+p.month+'-'+p.day;
}
const utcDays=(date)=>Date.parse(date+'T00:00:00Z')/86400000;
export function buildSectorRotation(rows,asOf,now=new Date(),sourceTruncated=false) {
  const today=taipeiDate(now);
  const ageDays=dateOnly(asOf)?utcDays(today)-utcDays(asOf):NaN;
  const stale=sourceTruncated || !Number.isFinite(ageDays)||ageDays<0||ageDays>3;
  const usable=[];
  const once=new Set();
  for(const row of Array.isArray(rows)?rows:[]){
    const id=String(row?.stock_id||''),industry=String(row?.industry||'').trim();
    const close=number(row?.close),prev=number(row?.prev_close);
    const vol=number(row?.current_volume_lots),avg20=number(row?.avg_volume_20_lots);
    if(!id || once.has(id) || !industry || industry==='其他'
       || String(row?.as_of)!==asOf || close===null||close<=0
       || prev===null||prev<=0||vol===null||vol<=0)continue;
    once.add(id);
    const pct=(close/prev-1)*100;
    if(!Number.isFinite(pct)||Math.abs(pct)>35)continue; // reject unadjusted splits/anomalies
    usable.push({industry,pct,ratio:avg20!=null&&avg20>0?vol/avg20:null,
       valueEstimate:close*vol*1000});
  }
  const marketMean=usable.length?usable.reduce((a,b)=>a+b.pct,0)/usable.length:null;
  const groups=new Map();
  for(const x of usable){
    const a=groups.get(x.industry)||[];
    a.push(x);groups.set(x.industry,a);
  }
  const sectors=[...groups].map(([industry,a])=>{
    const n=a.length,up=a.filter(x=>x.pct>0.1).length,down=a.filter(x=>x.pct< -0.1).length;
    const avg=a.reduce((s,x)=>s+x.pct,0)/n;
    const rel=marketMean!=null?avg-marketMean:null;
    const volume=a.map(x=>x.ratio).filter(x=>Number.isFinite(x)&&x>0&&x<20).sort((x,y)=>x-y);
    const medRatio=volume.length?volume[Math.floor((volume.length-1)/2)]:null;
    const breadth=n?up/n:null;
    const amount=a.reduce((s,x)=>s+x.valueEstimate,0);
    const sufficient=!stale&&n>=8&&volume.length>=Math.max(5,Math.ceil(n*.6));
    // Relative to the *scanned cohort*, never a market-wide benchmark.
    const kind=!sufficient?'insufficient'
      :breadth>=.6&&rel>=.6&&medRatio>=1.0?'strong'
      :breadth<=.4&&rel<=-.6?'weak':'mixed';
    return {industry,sample_count:n,up,down,up_pct:breadth==null?null:Math.round(breadth*1000)/10,
      mean_change_pct:Math.round(avg*100)/100,relative_to_scan_pct:rel==null?null:Math.round(rel*100)/100,
      median_volume_ratio:medRatio==null?null:Math.round(medRatio*100)/100,
      estimated_turnover_twd:Math.round(amount),kind,
      label:kind==='strong'?'🟢樣本相對偏強':kind==='weak'?'🟠樣本相對偏弱'
        :kind==='mixed'?'⚪樣本分化':'⚪樣本不足／過期'};
  }).sort((a,b)=>b.sample_count-a.sample_count);
  return {ok:true,version:rotationVersion,as_of:asOf||null,live:false,
    is_net_inflow:false,scope:'subset_of_EOD_scans_not_full_market',
    stale,source_truncated:!!sourceTruncated,
    total_valid_samples:usable.length,market_sample_mean_pct:marketMean==null?null:Math.round(marketMean*100)/100,
    sectors};
}

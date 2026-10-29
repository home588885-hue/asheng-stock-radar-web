// Pure intraday sample research. Uses only TWSE MIS verified trades and a frozen
// prior-EOD stock universe. This is NOT real net institutional/big-holder inflow.
export const INTRADAY_VERSION='2026-10-29-twse-mis-sampled-v1';
const pos=n=>n!==null&&n!==undefined&&n!==''&&Number.isFinite(Number(n))&&Number(n)>0?Number(n):null;
const dateParts=(now)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
  weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
}).formatToParts(now).map(x=>[x.type,x.value]));
export const marketClock=(now=new Date())=>{
  const p=dateParts(now),min=Number(p.hour)*60+Number(p.minute);
  return {day:p.year+'-'+p.month+'-'+p.day, minute:min,
    open:!['Sat','Sun'].includes(p.weekday)&&min>=540&&min<=810,
    samplingReady:min>=570&&min<=810&& !['Sat','Sun'].includes(p.weekday)};
};
const rollingHash=(s)=>{let h=2166136261;for(const c of s){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return h>>>0};
export function fixedSectorCohort(rows,eodDate,{maxSectors=10,perSector=12,maxSymbols=120}={}){
  const groups=new Map();
  for(const x of rows||[]){
    const id=String(x.stock_id||'').trim(),industry=String(x.industry||'').trim();
    const market=String(x.market||'').toLowerCase();
    if(!/^[0-9A-Z]{4,6}$/.test(id)|| !industry||industry==='其他' ||
       !['twse','tpex'].includes(market)||String(x.as_of||'')!==eodDate ||
       !pos(x.avg_volume_20_lots)|| !pos(x.close))continue;
    const a=groups.get(industry)||[];
    if(!a.some(r=>r.stock_id===id))a.push({...x,stock_id:id,market});
    groups.set(industry,a);
  }
  const sorted=[...groups.entries()].filter(([,a])=>a.length>=8)
    .sort((x,y)=>y[1].length-x[1].length||x[0].localeCompare(y[0])).slice(0,maxSectors);
  const selected=sorted.flatMap(([industry,a])=>a
    .sort((x,y)=>rollingHash(eodDate+':'+x.stock_id)-rollingHash(eodDate+':'+y.stock_id))
    .slice(0,perSector).map(x=>({...x,industry})));
  return selected.slice(0,maxSymbols);
}
export function verifiedMisTrade(row,expected,now=new Date()){
  if(!row||!expected)return null;
  const clock=marketClock(now),date=String(row.d||'').replace(/[^0-9]/g,'');
  const id=String(row.c||'');
  if(date!==clock.day.replace(/-/g,'')||id!==String(expected.stock_id)||!clock.open)return null;
  const last=pos(row.z)??pos(row?.trade?.z),volume=pos(row.v),prev=pos(row.y);
  if(!last||!volume||!prev)return null;
  const t=String(pos(row.z)!=null?row.t:(row?.trade?.t||row.t||''));
  const match=/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(t);
  if(!match)return null;
  const hh=Number(match[1]),mm=Number(match[2]),ss=Number(match[3]||0);
  if(hh<9||hh>13||(hh===13&&mm>30))return null;
  const ts=Date.parse(clock.day+'T'+String(hh).padStart(2,'0')+':'+match[2]+':'+String(ss).padStart(2,'0')+'+08:00');
  const age=(now.getTime()-ts)/1000;
  if(!Number.isFinite(age)||age< -120||age>720)return null; // 12-minute freshness ceiling
  const pct=(last/prev-1)*100;
  if(Math.abs(pct)>35)return null; // possible split, bad market data
  const avg=pos(expected.avg_volume_20_lots);
  const elapsed=Math.max(15,hh*60+mm-540);
  return {stock_id:id,industry:expected.industry,market:expected.market,
    price:last,prev_close:prev,pct,volume_lots:volume,
    projected_ratio:avg?volume/avg*270/elapsed:null,
    trade_at:new Date(ts).toISOString(),freshness_seconds:Math.round(age)};
}
export function summarizeVerifiedLive(trades,cohort,eodDate,now=new Date()){
  const clock=marketClock(now),selected=cohort||[],unique=new Map();
  const targetCounts=new Map();
  for(const r of selected)targetCounts.set(r.industry,(targetCounts.get(r.industry)||0)+1);
  for(const x of trades||[])if(x&&!unique.has(x.stock_id)&&selected.some(y=>y.stock_id===x.stock_id))unique.set(x.stock_id,x);
  const valid=[...unique.values()];
  const avg=valid.length?valid.reduce((s,x)=>s+x.pct,0)/valid.length:null;
  const by=new Map();
  for(const x of valid){const a=by.get(x.industry)||[];a.push(x);by.set(x.industry,a);}
  const sectors=[...targetCounts].map(([industry,target])=>{
    const a=by.get(industry)||[],n=a.length;
    const up=a.filter(x=>x.pct>0.1).length,down=a.filter(x=>x.pct< -0.1).length;
    const width=n?up/n:0;
    const mean=n?a.reduce((s,x)=>s+x.pct,0)/n:null;
    const relative=mean!=null&&avg!=null?mean-avg:null;
    const ratios=a.map(x=>x.projected_ratio).filter(x=>Number.isFinite(x)&&x>0&&x<20).sort((x,y)=>x-y);
    const median=ratios.length?ratios[Math.floor((ratios.length-1)/2)]:null;
    const coverage=target?n/target:0;
    const enough=clock.samplingReady&&n>=8&&coverage>=.7&&ratios.length>=Math.ceil(n*.6);
    const kind=!enough?'insufficient':width>=.6&&relative>=.5&&median>=1.0?'strong':
      width<=.4&&relative<=-.5?'weak':'mixed';
    return {industry,sample_count:n,target_count:target,coverage_pct:Math.round(coverage*1000)/10,
      up,down,up_pct:Math.round(width*1000)/10,mean_change_pct:mean==null?null:Math.round(mean*100)/100,
      relative_to_scan_pct:relative==null?null:Math.round(relative*100)/100,
      median_projected_volume_ratio:median==null?null:Math.round(median*100)/100,
      kind,label:kind==='strong'?'🟢盤中樣本偏強':kind==='weak'?'🟠盤中樣本偏弱':
        kind==='mixed'?'⚪盤中樣本分化':'⚪盤中樣本不足'};
  });
  return {ok:true,version:INTRADAY_VERSION,as_of:clock.day,model_as_of:eodDate,
    observed_at:now.toISOString(),live:clock.samplingReady&&valid.length>=24,
    scope:'subset_of_verified_current_trade_not_full_market',
    is_net_inflow:false,source:'TWSE MIS valid trade',
    selected_count:selected.length,valid_count:valid.length,
    coverage_pct:selected.length?Math.round(valid.length/selected.length*1000)/10:0,
    sectors, samples:valid.map(x=>({stock_id:x.stock_id,industry:x.industry,
      price:x.price,prev_close:x.prev_close,trade_at:x.trade_at}))};
}

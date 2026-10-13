async (tools,options={}) => {
  // Reproducible, read-only, historical replay. Not a production strategy.
  // Original universe: archived FIRST_BREAKOUT events, liquidity >= 1000 lots,
  // signal close between MA20 +0% and +5%. Improved filter uses only signal-day
  // volume ratio <2.5 and MA60 5-day slope >0. No lookahead in selection.
  // Proxy only: intraday 12-minute survival and exact v39 historical snapshots
  // cannot be reconstructed from this public historical archive.
  const ids=(options.ids||[]).map(String).filter(x=>/^\d{4}$/.test(x)).slice(0,4);
  if(!ids.length)return {error:"no eligible stock ids"};
  const sourceRepo="voidful/tw_stocker",project="qexbtubfoyfsllaiecvv";
  const clause=ids.map(x=>"'"+x+"'").join(",");
  const sql="select stock_id,signal_date,entry_date,close_price,r20,volume_ratio_day,ma60_slope5_pct,chip_score from public.spring_swallow_v5_research_events "+
    "where family='FIRST_BREAKOUT' and stock_id in ("+clause+") "+
    "and signal_date between '2024-06-01' and '2026-02-12' and volume_lots>=1000 "+
    "and deviation20 between 0 and 5 and r20 is not null order by stock_id,signal_date";
  const sr=await tools.mcp__Supabase__execute_sql({project_id:project,query:sql});
  const source=JSON.parse(sr.text).result||"";
  const match=source.match(/<untrusted-data-[^>]*>\s*(\[[\s\S]*?\])\s*<\/untrusted-data/);
  const events=match?JSON.parse(match[1]):[];
  const barsFrom=csv=>{
    const records=new Map();
    const lines=csv.split("\n");
    for(let n=1;n<lines.length;n++){
      const f=lines[n].split(",");
      if(f.length<6)continue;
      const date=f[0].slice(0,10),o=+f[1],h=+f[2],l=+f[3],c=+f[4],volume=+f[5];
      if(date<"2024-02-15"||date>"2026-04-01")continue;
      if(![o,h,l,c].every(v=>Number.isFinite(v)&&v>0))continue;
      const prev=records.get(date);
      if(prev){prev.h=Math.max(prev.h,h);prev.l=Math.min(prev.l,l);prev.c=c;prev.v+=Number.isFinite(volume)?volume:0}
      else records.set(date,{date,o,h,l,c,v:Number.isFinite(volume)?volume:0});
    }
    return [...records.values()].sort((a,b)=>a.date.localeCompare(b.date));
  };
  const avg=(bars,index,size,key)=> {
    if(index<size-1)return NaN;
    let sum=0;for(let j=index-size+1;j<=index;j++)sum+=bars[j][key];return sum/size;
  };
  const B=.001425,S=.004425;
  const simulate=(bars,start,horizon,withAdds=true)=>{
    if(start<65||start+horizon>bars.length)return null;
    const entry=bars[start].o;
    let invested=1,cash=0,shares=1/(entry*(1+B)),added=false,taken=false;
    let below20=0,queued=null,exitReason="horizon",exitSessions=horizon,maxDD=0,peak=1;
    for(let t=start;t<start+horizon;t++){
      const day=bars[t];
      if(queued){
        if(queued==="stop"){
          cash+=shares*day.o*(1-S);shares=0;exitReason="3_closes_below_MA20";exitSessions=t-start+1;break;
        }
        if(queued==="add"&&!added){const amount=1/3;shares+=amount/(day.o*(1+B));invested+=amount;added=true;}
        if(queued==="profit"&&!taken){const sold=shares/3;cash+=sold*day.o*(1-S);shares-=sold;taken=true;}
        queued=null;
      }
      // Intraday low not used for drawdown: only fully observed daily close.
      const equity=(cash+shares*day.c*(1-S))/invested;
      peak=Math.max(peak,equity);
      maxDD=Math.min(maxDD,(equity/peak-1)*100);
      if(t===start+horizon-1){cash+=shares*day.c*(1-S);shares=0;break;}
      const ma20=avg(bars,t,20,"c"),ma10=avg(bars,t,10,"c");
      const previous=bars[t-1],previousMa20=avg(bars,t-1,20,"c"),previousMa10=avg(bars,t-1,10,"c");
      below20=day.c<ma20?below20+1:0;
      if(below20>=3){queued="stop";continue;}
      // Partial profit at +20% measured from weighted gross average purchase cost.
      const averageEntry=invested/shares;
      if(!taken&&day.c>=averageEntry*1.20){queued="profit";continue;}
      const vol20=avg(bars,t,20,"v"),ratio=vol20>0?day.v/vol20:NaN;
      if(withAdds&&!added&&!taken&&t>start&&day.c>=ma20&&day.c<=ma20*1.05
        &&day.v>=1e6&&vol20>=5e5&&ratio>=.8&&ratio<=2.2
        &&(day.c>day.o||day.c>=previous.h*.995)&&day.c>=previous.l*.996){
        const ma10Bounce=day.l<=ma10*1.02&&day.c>=ma10;
        const ma20Retest=(day.l<ma10||previous.c<previousMa10)&&day.l>=ma20*.97&&day.l<=ma20*1.02;
        const ma20Reclaim=previous.c<previousMa20&&day.c>=ma20;
        if(ma10Bounce||ma20Retest||ma20Reclaim)queued="add";
      }
    }
    return {net:100*(cash-invested)/invested,dd:maxDD,sessions:exitSessions,added,taken,exit:exitReason};
  };
  const group=(arr)=>{
    if(!arr.length)return {n:0};
    const avgKey=k=>arr.reduce((s,x)=>s+x[k],0)/arr.length;
    const rate=fn=>100*arr.filter(fn).length/arr.length;
    return {n:arr.length,distinctStocks:new Set(arr.map(x=>x.id)).size,
      net20:+avgKey("net20").toFixed(3),win20:+rate(x=>x.net20>0).toFixed(1),
      net30:+avgKey("net30").toFixed(3),win30:+rate(x=>x.net30>0).toFixed(1),
      drawdown30:+avgKey("dd30").toFixed(3),worstTradeDD30:+Math.min(...arr.map(x=>x.dd30)).toFixed(2),
      adds30:+rate(x=>x.added).toFixed(1),profitTakes30:+rate(x=>x.taken).toFixed(1),
      stops30:+rate(x=>x.exit==="3_closes_below_MA20").toFixed(1),meanSessions:+avgKey("sessions").toFixed(1)};
  };
  const fetched=await Promise.all(ids.map(async id=>{
    try{
      const f=await tools.mcp__GitHub__fetch_file({repository_full_name:sourceRepo,path:"data/"+id+".csv"});
      const csv=f.result.content||
        (await tools.mcp__GitHub__fetch_blob({repository_full_name:sourceRepo,blob_sha:f.result.sha})).result.content;
      return {id,bars:barsFrom(csv)};
    }catch(error){return {id,error:String(error).slice(0,150)}}
  }));
  const accepted=[],skipped=[];
  for(const item of fetched){
    if(item.error){skipped.push({id:item.id,reason:"source_unavailable",error:item.error});continue}
    const index=new Map(item.bars.map((x,i)=>[x.date,i]));
    let lastAccepted=-1000;
    for(const event of events.filter(x=>x.stock_id===item.id)){
      const signal=index.get(event.signal_date),start=index.get(event.entry_date);
      if(signal==null||start==null||start!==signal+1){skipped.push({id:item.id,reason:"missing_date"});continue}
      if(Math.abs(item.bars[signal].c/Number(event.close_price)-1)>.02){
        skipped.push({id:item.id,reason:"signal_price_mismatch"});continue;
      }
      // Study's r20 is day 20 after signal, with next-day open and fixed costs.
      const day20=signal+20;
      if(day20>=item.bars.length)continue;
      const r20archived=100*((item.bars[day20].c*(1-S))/(item.bars[start].o*(1+B))-1);
      if(Math.abs(r20archived-Number(event.r20))>3.0){
        skipped.push({id:item.id,reason:"future_path_mismatch"});continue;
      }
      // 30 trading-session exclusion, both for original and optimized pools.
      if(start-lastAccepted<30)continue;
      const a=simulate(item.bars,start,20),b=simulate(item.bars,start,30);
      if(!a||!b){skipped.push({id:item.id,reason:"short_history"});continue}
      lastAccepted=start;
      accepted.push({id:item.id,year:event.signal_date.slice(0,4),
        eligible:Number(event.volume_ratio_day)<2.5&&Number(event.ma60_slope5_pct)>0,
        net20:a.net,net30:b.net,dd30:b.dd,added:b.added,taken:b.taken,
        exit:b.exit,sessions:b.sessions});
    }
  }
  const byYear={};
  for(const year of ["2024","2025","2026"]){
    const sub=accepted.filter(x=>x.year===year);
    byYear[year]={baseline:group(sub),optimized:group(sub.filter(x=>x.eligible)),
      excluded:group(sub.filter(x=>!x.eligible))};
  }
  return {ids,eventsInDB:events.length,accepted:accepted.length,skipCount:skipped.length,
    skipReasons:skipped.reduce((r,x)=>(r[x.reason]=(r[x.reason]||0)+1,r),{}),
    baseline:group(accepted),optimized:group(accepted.filter(x=>x.eligible)),
    excluded:group(accepted.filter(x=>!x.eligible)),byYear,
    assumption:"next open entry; 1/3 initial capital once on confirmed MA10/MA20 add; sell 1/3 position at +20% next open; third consecutive close below MA20 sell next open; 20/30 trading-session caps; 0.1425% buy and 0.4425% sell; no slippage; daily-close drawdown; historical proxy not exact v39 intraday signal"};
}
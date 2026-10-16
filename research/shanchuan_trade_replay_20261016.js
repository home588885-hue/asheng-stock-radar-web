async (tools,options={})=>{
  // Read-only 2024-2026 reproducible daily OHLCV replay, signal selection fixed.
  // No live production writes, financial claim, or requests outside Github/Supabase.
  const ids=(options.ids||[]).filter(id=>/^[0-9]{4}$/.test(String(id))).slice(0,4);
  if(!ids.length)return {error:"invalid ids"};
  const clause=ids.map(x=>"'"+x+"'").join(",");
  const sql="select a.stock_id,a.signal_date,a.entry_date,a.entry_price,a.r20 as archived_r20,v.close_price as signal_close "
  +"from public.asheng_bottom_backtest_events a left join public.spring_swallow_v5_research_events v "
  +"on a.stock_id=v.stock_id and a.signal_date=v.signal_date and v.run_id='86c2305a-3b60-493c-9ec8-2addbf754e78' and v.family='FIRST_BREAKOUT' "
  +"where a.signal_type='FIRST_BREAKOUT' and a.stock_id in ("+clause+") "
  +"and a.signal_date between '2024-06-01' and '2026-02-10' order by a.stock_id,a.signal_date";
  const db=await tools.mcp__Supabase__execute_sql({project_id:"qexbtubfoyfsllaiecvv",query:sql});
  const raw=JSON.parse(db.text).result;
  const match=raw.match(/(\[[\s\S]*?\])\s*<\/untrusted-data/);
  if(!match)return {error:"sql result not recognized"};
  const events=JSON.parse(match[1]);
  const feeBuy=.001425,feeSell=.004425,sourceRepo="voidful/tw_stocker";
  const avg=(bars,t,n,k)=>{if(t<n-1)return null;let sum=0;for(let j=t-n+1;j<=t;j++)sum+=bars[j][k];return sum/n};
  function simulate(bars,start,horizon,variant) {
    if(start<60||start+horizon>=bars.length)return null;
    const entry=bars[start].o;
    let cash=0,spent=1,shares=1/(entry*(1+feeBuy)),buyGross=entry*shares,buyShares=shares;
    let added=false,taken=false,protectedPart=false,streak20=0,pending=null;
    let peak=entry,peakEquity=1,maxDrawdown=0,sellIdx=start+horizon,why="horizon",triggerDay=null;
    for(let t=start;t<=start+horizon;t++){
      const bar=bars[t],prev=bars[t-1];
      // At the session cap, exit the whole remainder once at the open.
      // Avoid a queued partial sale and full exit at the same price/open.
      if(t===start+horizon){cash+=shares*bar.o*(1-feeSell);shares=0;why="horizon_open";sellIdx=t;break}
      if(pending){
        if(pending==="exit"){cash+=shares*bar.o*(1-feeSell);shares=0;why="three_ma20_closes";sellIdx=t;break}
        if(pending==="add"&&!added){const investment=1/3,quantity=investment/(bar.o*(1+feeBuy));shares+=quantity;spent+=investment;buyShares+=quantity;buyGross+=bar.o*quantity;added=true}
        if(pending==="take"&&!taken){const selling=shares/3;cash+=selling*bar.o*(1-feeSell);shares-=selling;taken=true}
        if(pending==="protect"&&!protectedPart){const selling=shares/3;cash+=selling*bar.o*(1-feeSell);shares-=selling;protectedPart=true}
        pending=null;
      }
      const equity=(cash+shares*bar.c*(1-feeSell))/spent;
      peakEquity=Math.max(peakEquity,equity);
      maxDrawdown=Math.min(maxDrawdown,(equity/peakEquity-1)*100);
      peak=Math.max(peak,bar.h);
      const ma20=avg(bars,t,20,"c"),ma10=avg(bars,t,10,"c"),ma5=avg(bars,t,5,"c");
      const priorMA20=avg(bars,t-1,20,"c"),priorMA10=avg(bars,t-1,10,"c");
      streak20=bar.c<ma20?streak20+1:0;
      if(streak20>=3){pending="exit";continue;}
      if(!taken&&bar.c>=buyGross/buyShares*1.2){pending="take";continue;}
      const ratioVol=avg(bars,t-1,20,"v")>0?bar.v/avg(bars,t-1,20,"v"):null;
      const gain=(peak/entry-1)*100,retreat=(peak-bar.c)/peak*100;
      const breaksLow=bar.c<prev.l*.996;
      const twoBlack=t>=start+2&&bar.c<bar.o&&prev.c<prev.o&&bar.c<prev.c;
      const guardA=gain>=5&&retreat>=1.5&&(breaksLow||(bar.c<ma5&&twoBlack));
      const guardB=gain>=8&&retreat>=2.5&&breaksLow&&((ratioVol||0)>=1.2||twoBlack);
      if(variant!=="baseline"&&!protectedPart&&!taken&&t>=start+1
        &&(variant==="guard_A"?guardA:variant==="guard_B"?guardB:(guardA||guardB))){
        triggerDay=bar.d;pending="protect";continue;
      }
      if(!added&&!taken&&t>start&&bar.c>=ma20&&bar.c<=ma20*1.05
        &&bar.v>=1000000&&avg(bars,t-1,20,"v")>=500000
        &&ratioVol>=.8&&ratioVol<=2.2&&(bar.c>bar.o||bar.c>=prev.h*.995)
        &&bar.c>=prev.l*.996){
        const bounce=bar.l<=ma10*1.02&&bar.c>=ma10;
        const retest=(bar.l<ma10||prev.c<priorMA10)&&bar.l>=ma20*.97&&bar.l<=ma20*1.02;
        const reclaim=prev.c<priorMA20&&bar.c>=ma20;
        if(bounce||retest||reclaim)pending="add";
      }
    }
    return {net:Number((100*(cash-spent)/spent).toFixed(4)),
      drawdown:Number(maxDrawdown.toFixed(4)),held:sellIdx-start,added,taken,
      protectedPart,triggerDay,exit:why};
  }
  const sources=await Promise.all(ids.map(async id=>{
    try{
      const f=await tools.mcp__GitHub__fetch_file({repository_full_name:sourceRepo,path:"data/"+id+".csv"});
      const b=await tools.mcp__GitHub__fetch_blob({repository_full_name:sourceRepo,blob_sha:f.result.sha});
      const daily=new Map();
      for(const line of b.result.content.split("\n").slice(1)){
        const a=line.split(",");if(a.length<6)continue;
        const d=a[0].slice(0,10),o=+a[1],h=+a[2],l=+a[3],c=+a[4],v=+a[5];
        if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||![o,h,l,c].every(z=>Number.isFinite(z)&&z>0))continue;
        let x=daily.get(d);
        if(x){x.h=Math.max(x.h,h);x.l=Math.min(x.l,l);x.c=c;x.v+=Number.isFinite(v)?v:0}
        else daily.set(d,{d,o,h,l,c,v:Number.isFinite(v)?v:0});
      }
      const bars=[...daily.values()].sort((a,b)=>a.d.localeCompare(b.d));
      return {id,bars,days:bars.length,from:bars[0]?.d,to:bars.at(-1)?.d};
    }catch(e){return {id,error:String(e).slice(0,160)}}
  }));
  const trades=[],skipReasons={},audit=[];
  for(const f of sources){
    const evs=events.filter(x=>x.stock_id===f.id);
    if(f.error){skipReasons.source_missing=(skipReasons.source_missing||0)+evs.length;continue}
    const bars=f.bars,index=new Map(bars.map((x,i)=>[x.d,i]));let last=-1000;
    for(const ev of evs){
      const si=index.get(ev.signal_date),en=index.get(ev.entry_date);
      let reason=null;
      if(si==null||en==null||en!==si+1)reason="missing_or_nonadjacent_session";
      else if(!Number.isFinite(Number(ev.signal_close))||Math.abs(bars[si].c/Number(ev.signal_close)-1)>.02)reason="signal_close_mismatch";
      else if(Math.abs(bars[en].o/Number(ev.entry_price)-1)>.02)reason="entry_open_mismatch";
      else if(en+30>=bars.length)reason="not_enough_future_bars";
      else{
        const r20=((bars[si+20].c*(1-feeSell))/(bars[en].o*(1+feeBuy))-1)*100;
        if(!Number.isFinite(r20)||Math.abs(r20-Number(ev.archived_r20))>3.0)reason="archive_r20_mismatch";
      }
      if(reason){skipReasons[reason]=(skipReasons[reason]||0)+1;continue}
      if(en-last<30){skipReasons.overlap_cooldown=(skipReasons.overlap_cooldown||0)+1;continue}
      last=en;
      audit.push({id:f.id,signal:ev.signal_date,entry:ev.entry_date});
      for(const horizon of [20,30]){
        const replay={};
        for(const variant of ["baseline","guard_A","guard_B"]){replay[variant]=simulate(bars,en,horizon,variant)}
        if(replay.baseline&&replay.guard_A&&replay.guard_B){
          trades.push({id:f.id,signal:ev.signal_date,year:ev.signal_date.slice(0,4),horizon,...replay});
        }
      }
    }
  }
  return {version:"2026-10-16-shanchuan-protect-pilot-v2",ids,source:sourceRepo,
    coverage:sources.map(x=>({id:x.id,days:x.days,from:x.from,to:x.to,error:x.error})),
    events:events.length,accepted:trades.length/2,skipReasons,audit,trades,
    assumptions:{feeBuy,feeSell,signal:"archived MA10/20/60 FIRST_BREAKOUT, not production intraday",
      entry:"next open",add:"once near MA10/20 on day-close and next open 1/3 initial capital",
      profit:"at +20% from weighted average gross buy cost, next-open sell 1/3 current shares",
      exit:"third consecutive close below MA20, next open exit, at 20/30 sessions otherwise",
      protect_A:"peak high +5% then giveback >=1.5%, close below previous low OR below MA5 with two bearish daily candles, sell 1/3 next open",
      protect_B:"peak high +8% then giveback >=2.5%, close below prev low with vol>=1.2*prior20d or 2 bearish daily candles, sell 1/3 next open",
      capital:"no margin, no position limit; fees 0.1425% buy, 0.4425% sell incl tax; no slippage",maxDrawdown:"trade equity close-to-close after sale fee",
      validation:"exclude stale historical 5-minute CSV bars with signal/entry mismatch >2% or archived r20 mismatch >3%; holdout not untouched; research only"}
  };
}
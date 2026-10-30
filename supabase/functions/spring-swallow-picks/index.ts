const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'GET, OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'public, max-age=55, s-maxage=55, stale-while-revalidate=120'};
function out(x:any,s=200){return new Response(JSON.stringify(x),{status:s,headers:H})}
const CHASE_RULE_VERSION='2026-10-20-bias-8-12-15-v1';
const TW50=new Set('2330 2454 2308 2317 3711 2383 2303 3037 2891 2881 2345 2882 1303 2327 3017 2887 2382 2885 2360 2059 6669 2886 2884 3231 2408 2344 2357 2301 2412 2890 2883 3008 2880 2892 3665 1216 3443 3653 7769 4958 2368 2395 6446 2449 5880 8046 2603 4904 3045 6505'.split(' '));
const cap=(x:any)=>TW50.has(String(x.stock_id))?8:
  x?.metrics?.verified_cap_tier==='small_spike'?15:x?.metrics?.verified_cap_tier==='large'?8:12;
const chase=(x:any,price?:number)=>{const p=price===undefined?Number(x?.metrics?.close):Number(price),m=Number(x?.metrics?.ma20);
  return p>0&&m>0&&Number.isFinite(p)&&Number.isFinite(m)&&(p/m-1)*100<=cap(x)+1e-9};
const signedNew=x=>x?.metrics?.chase_rule_version===CHASE_RULE_VERSION
  &&x?.metrics?.chase_risk?.version===CHASE_RULE_VERSION;
const CURRENT_HOLDING_POLICY='2026-10-29-hard10-arm20-peaktrail5-v1';
const CURRENT_HOLDING_RULE='風控A：成本-10%停損；買進後經確認高點首次達成本+20%才啟動最高價回落5%移動停利提醒，沒有固定+10%全數停利。此公用S快照不具個人成本與高點，不能計算實際出場價；僅保留技術加碼觀察，虧損不自動攤平，需持股端獨立驗證；歷史舊訊號不得補發買點';
function applyEntryValidationHold(x:any){
  if(!x)return x;
  const y=JSON.parse(JSON.stringify(x));
  const v=String(y?.metrics?.model?.version||'');
  if(v.startsWith('2026-09-21-v4')){
    y.metrics=y.metrics||{};y.metrics.model=y.metrics.model||{};
    y.metrics.model.source_version=v;y.metrics.model.version='2026-09-21-entry-validation-hold';
    y.metrics.model.entry_validation='hold_oos_failed';
    y.metrics.model.entry_validation_note='全市場walk-forward回測未通過2025+樣本外正期望，正式進場暫停，只保留候選/觀察訊號';
  }
  const m=y.metrics||{},hm=m.holding_management;
  if(hm&&hm.policy_version!==CURRENT_HOLDING_POLICY){
    // Older stored scan history is not recalculated. Remove legacy ADD permissions on read.
    // Keep historical close, MA20 days, selection scores, labels and timestamps intact.
    hm.source_policy_version=String(hm.policy_version||'legacy');
    hm.policy_version='legacy-snapshot-readonly-sanitized-for-'+CURRENT_HOLDING_POLICY;
    hm.add_ready=false;hm.add_requires_cost_validation=true;hm.add_setup_ready=false;
    hm.ma10_add_ready=false;hm.ma20_retest_add_ready=false;hm.ma20_reclaim_add_ready=false;
    hm.strong_add_ready=false;hm.strong_add_trigger=null;hm.add_mode=null;
    hm.rule=CURRENT_HOLDING_RULE;hm.add_rule=CURRENT_HOLDING_RULE;
    hm.stop_pct=-10;hm.breakeven_arm_pct=null;hm.take_profit_full_pct=null;hm.trailing_arm_profit_pct=20;hm.trailing_retrace_from_peak_pct=5;hm.trailing_peak_source='verified_post_buy_required';hm.alert_only=true;
    hm.profit_add_min_pct=3;hm.max_add_fraction_first_position=.5;
    const h=m.trade_lifecycle?.holding;
    if(h){
      if(h.state==='pullback_add'||h.state==='strong_add')h.state='hold';
      h.add_mode=null;h.strong_add_ready=false;h.pullback_add_ready=false;
      h.add_setup_ready=false;h.add_requires_cost_validation=true;
      h.policy_version=hm.policy_version;h.rule=CURRENT_HOLDING_RULE;
      h.stop_pct=-10;h.breakeven_arm_pct=null;h.take_profit_full_pct=null;h.trailing_arm_profit_pct=20;h.trailing_retrace_from_peak_pct=5;h.trailing_peak_source='verified_post_buy_required';h.alert_only=true;
    }
  }
  return y;
}
async function db(path:string,opts:any={}){const url=Deno.env.get('SUPABASE_URL')!;const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;const headers:any={apikey:key,'Content-Type':'application/json',...(opts.headers||{})};if(!String(key).startsWith('sb_'))headers.Authorization='Bearer '+key;return fetch(url+'/rest/v1/'+path,{...opts,headers})}

const TDCC_GATE_VERSION='2026-10-28-tdcc-ma20-0-8-two-weeks-v1';
async function attachTDCC(rows:any[]){
 if(!rows?.length)return rows;
 const ids=[...new Set(rows.map((x:any)=>String(x?.stock_id||'')).filter((x:string)=>/^\d{4}$/.test(x)))];
 const flowMap=new Map<string,any>();
 for(let start=0;start<ids.length;start+=100){
  const keys=ids.slice(start,start+100).join(',');
  try{
   const r=await db('spring_swallow_tdcc_holder_flow?select=stock_id,snapshot_date,usable_from,status,pct_400,pct_1000,change_400_pp,change_1000_pp,streak_400_weeks,streak_1000_weeks,streak_both_weeks,streak_history_snapshots,two_week400_up,two_week1000_up,two_week_both_up,source_kind&stock_id=in.('+keys+')');
   if(r.ok)for(const item of await r.json())flowMap.set(String(item.stock_id),item);
  }catch{}
 }
 return rows.map((x:any)=>{
  if(!x)return x;const m=x.metrics||{},row=flowMap.get(String(x.stock_id)),day=String(x.as_of||'');
  const close=Number(m.close),ma20=Number(m.ma20),bias=close>0&&ma20>0?(close/ma20-1)*100:null;
  const age=row?(Date.parse(day+'T00:00:00Z')-Date.parse(String(row.snapshot_date)+'T00:00:00Z'))/86400000:NaN;
  const covered=!!(row?.status==='complete'&&row.usable_from<=day&&age>=0&&age<=20);
  const biasOk=bias!==null&&Number.isFinite(bias)&&bias>=0&&bias<=8;
  const passed=covered&&biasOk&&row.two_week400_up===true&&row.two_week1000_up===true;
  const signed=m.tdcc_holder_flow?.version===TDCC_GATE_VERSION
      &&m.tdcc_holder_flow?.as_of===day&&m.tdcc_holder_flow?.snapshot_date===row?.snapshot_date
      &&m.tdcc_holder_flow?.pass===true;
  const verified=passed&&signed;
  m.tdcc_holder_flow={version:TDCC_GATE_VERSION,source:'third_party_archive_of_public_tdcc_csv',snapshot_date:row?.snapshot_date??null,
   usable_from:row?.usable_from??null,as_of:day,covered,pass:passed,entry_gate_verified:false,source_verified:covered,trade_gate_applied_to_new_entries:false,
   bias20_pct:bias,ma20_bias_0_8_pass:biasOk,holder_400_pct:row?.pct_400??null,holder_1000_pct:row?.pct_1000??null,delta_400_pp:row?.change_400_pp??null,delta_1000_pp:row?.change_1000_pp??null,
   two_week400_up:row?.two_week400_up===true,two_week1000_up:row?.two_week1000_up===true,
   two_week_both_up:row?.two_week_both_up===true,
   streak_400_weeks:row?.streak_400_weeks??null,streak_1000_weeks:row?.streak_1000_weeks??null,
   streak_both_weeks:row?.streak_both_weeks??null,streak_history_snapshots:row?.streak_history_snapshots??null,
   streak_display_only:true,
   reason:!covered?'missing_or_not_yet_available':!biasOk?'ma20_bias_out_of_0_8':!passed?'holder_two_week_increase_not_confirmed':!signed?'await_latest_analyzer_scan':'confirmed',
   no_historical_buy_upgrade:true};
  if(m.model?.advanced_data)m.model.advanced_data.large_small_holder=covered;
  return {...x,metrics:m};
 });
}

async function textSample(r:Response){try{return (await r.clone().text()).slice(0,300)}catch{return ''}}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  if(req.method!=='GET')return out({ok:false,error:'GET only'},405);
  const u=new URL(req.url);
  const symbolsRaw=(u.searchParams.get('symbols')||'').trim();
  if(symbolsRaw){
    const symbols=[...new Set(symbolsRaw.split(',').map((s:any)=>String(s||'').trim().toUpperCase()).filter(Boolean))].slice(0,50);
    if(!symbols.length || symbols.some((s:any)=>!/^[0-9A-Z.-]{2,12}$/.test(s))) return out({ok:false,error:'invalid symbols'},400);
    const inList=symbols.map((s:any)=>encodeURIComponent(s)).join(',');
    const resultR=await db(`spring_swallow_scan_results?select=stock_id,stock_name,industry,market,as_of,stage,score,scores,metrics,reasons,cautions,scanned_at&stock_id=in.(${inList})`);
    if(!resultR.ok)return out({ok:false,error:'database read failed',status:resultR.status,sample:await textSample(resultR)},500);
    const rows=(await resultR.json()).map((x:any)=>applyEntryValidationHold(x));
    const byId=new Map(rows.map((x:any)=>[String(x.stock_id),x]));
    const picks=await attachTDCC(symbols.map((id:any)=>byId.get(id)).filter(Boolean));
    return out({ok:true,rule_version:'2026-10-06-ma10-20-60-v1',rule_locked:true,batch_symbols:true,symbols,picks,missing:symbols.filter((id:any)=>!byId.has(id))});
  }
  const symbol=(u.searchParams.get('symbol')||'').trim().toUpperCase();
  if(symbol){
    if(!/^[0-9A-Z.-]{2,12}$/.test(symbol))return out({ok:false,error:'invalid symbol'},400);
    const q=encodeURIComponent(symbol);
    const [masterR,resultR]=await Promise.all([
      db(`spring_swallow_stock_master?select=stock_id,stock_name,industry,market,active&stock_id=eq.${q}&limit=1`),
      db(`spring_swallow_scan_results?select=stock_id,stock_name,industry,market,as_of,stage,score,scores,metrics,reasons,cautions,scanned_at&stock_id=eq.${q}&order=scanned_at.desc&limit=1`)
    ]);
    if(!masterR.ok||!resultR.ok)return out({ok:false,error:'database read failed',statuses:{master:masterR.status,result:resultR.status},samples:{master:await textSample(masterR),result:await textSample(resultR)}},500);
    const master=(await masterR.json())[0]||null;
    const baseItem=applyEntryValidationHold((await resultR.json())[0]||null);const item=baseItem?(await attachTDCC([baseItem]))[0]:null;
    if(!master)return out({ok:true,rule_version:'2026-10-06-ma10-20-60-v1',rule_locked:true,search:true,symbol,found:false,picks:[],message:'查無此股票代號'});
    return out({ok:true,rule_version:'2026-10-06-ma10-20-60-v1',rule_locked:true,search:true,symbol,found:!!item,master,picks:item?[item]:[],message:item?'':'此股票尚未完成雷達掃描'});
  }
  const mode=(u.searchParams.get('mode')||'').toLowerCase();
  // A response-size safety ceiling, never a target quota of stock cards.
  const limit=Math.max(1,Math.min(mode==='launch'?250:100,Number(u.searchParams.get('limit')||30)));
  const stage=(u.searchParams.get('stage')||'').toUpperCase();
  const hrs=Math.max(12,Math.min(168,Number(u.searchParams.get('fresh_hours')||96)));
  const since=new Date(Date.now()-hrs*3600000).toISOString();
// Generation-aware coverage: never count legacy snapshots as newly rescanned v2 models.
  const [mr,rr,fr,sr]=await Promise.all([
    db('spring_swallow_stock_master?select=stock_id&active=eq.true&limit=1',{headers:{Prefer:'count=exact'}}),
    db('rpc/spring_swallow_picks_candidates',{method:'POST',body:JSON.stringify({p_since:since})}),
    db(`spring_swallow_scan_results?select=stock_id&scanned_at=gte.${encodeURIComponent(since)}&metrics->box_strategy->>model_generation=eq.shanchuan-independent-v2&metrics->box_strategy->discovery->>version=eq.2026-10-16-shanchuan-independent-v2&limit=1`,{headers:{Prefer:'count=exact'}}),
    db('spring_swallow_scan_state?select=cursor_pos,last_cycle_at,last_batch_at,last_batch_count,last_error&id=eq.true')
  ]);
  // Recent-scan count is optional telemetry, not a prerequisite for candidate delivery.
  // On its intermittent PostgREST failure, retain model RPC results, never claim
  // full-market completeness and never change a trading signal.
  if(!mr.ok||!rr.ok)return out({ok:false,error:'database read failed',statuses:{master:mr.status,results:rr.status,fresh:fr.status,state:sr.status},samples:{master:await textSample(mr),results:await textSample(rr)}},500);
  const cr=mr.headers.get('content-range')||'';
  const totalMatch=cr.match(/\/(\d+)$/);
  const total=totalMatch?Number(totalMatch[1]):0;
  const fcr=fr.headers.get('content-range')||'';
  const freshMatch=fcr.match(/\/(\d+)$/);
  // Only the new independent Shan-Chuan analyzer snapshot enters candidate tabs.
  // Exact holdings/symbol read paths above stay intact.
  const isNewGeneration=(x:any)=>x?.metrics?.box_strategy?.model_generation==='shanchuan-independent-v2'
    &&x?.metrics?.box_strategy?.discovery?.version==='2026-10-16-shanchuan-independent-v2';
  const rawRows=(await rr.json()).map((x:any)=>applyEntryValidationHold(x));
  const baseRows=rawRows.filter(x=>isNewGeneration(x)&&signedNew(x));
  // During staged rollout, previous complete-day models may provide RESEARCH OBSERVATION only.
  // Never alter signed model version, scores, V5 decisions, stored records, or scan budget.
  const oldRows=rawRows.filter(x=>isNewGeneration(x)&&String(x.as_of||'')<rawRows.reduce((d,y)=>String(y.as_of||'')>d?String(y.as_of):d,''));
  const latestExistingDate=rawRows.reduce((d,x)=>String(x?.as_of||'')>d?String(x.as_of):d,'');
  const latestMs=Date.parse(latestExistingDate+'T00:00:00Z');
  const chaseObservationLimit=(x:any)=>{
    const sid=String(x.stock_id||'');
    const tw50=TW50.has(sid);
    return tw50?8:x?.metrics?.verified_cap_tier==='small_spike'?15:
      x?.metrics?.verified_cap_tier==='large'?8:12;
  };
  const observationBase=oldRows.filter(x=>{
    const m=x.metrics||{},close=Number(m.close),ma20=Number(m.ma20);
    const ma10=Number(m.ma10),ma60=Number(m.ma60);
    const pos=Number(m.position_1y_pct),volume=Number(m.current_volume_lots);
    const avg=Number(m.avg_volume_20_lots),dated=Date.parse(String(x.as_of||'')+'T00:00:00Z');
    const bias=ma20>0?(close/ma20-1)*100:999;
    return Number.isFinite(latestMs)&&Number.isFinite(dated)&&dated<=latestMs
      &&latestMs-dated<=5*86400000
      &&close>0&&ma20>0&&ma10>0&&ma60>0
      &&volume>=1000&&avg>=500&&Number.isFinite(pos)&&pos>=0&&pos<80
      &&bias>=-2&&bias<=chaseObservationLimit(x)
      &&m.ma_cluster?.all_rising===true
      &&m.entry_candle_guard?.weak_after_breakout!==true
      &&m.holding_management?.strong_breakdown!==true
      &&!['mother_low_broken','child_low_broken'].includes(String(m.shanchuan_v2?.mother_child?.lifecycle?.state||''))
      &&!['support_broken_3d','support_lost_warning','support_below_watch'].includes(String(m.box_strategy?.range_state||''));
  });
  const observationStage=x=>String(x?.metrics?.trade_lifecycle?.entry?.state||'');
  const observationLife=x=>String(x?.metrics?.scan_intelligence?.effective_lifecycle||'');
  const observationEntry=observationBase.filter(x=>Number(x.score)>=60
    &&x.metrics?.ma_cluster?.above_all_mas===true
    &&(observationLife(x)==='ACTIVE'||observationLife(x)==='ENTRY'
      ||['near','starter','formal_candidate'].includes(observationStage(x))))
    .sort((a,b)=>Number(b.score)-Number(a.score)||String(b.as_of).localeCompare(String(a.as_of)))
    .slice(0,10).map(x=>({...x,__observation_only:true,__observation_zone:'entry'}));
  const entryObservedIds=new Set(observationEntry.map(x=>String(x.stock_id)));
  const observationLaunch=observationBase.filter(x=>Number(x.score)>=65
    &&!entryObservedIds.has(String(x.stock_id))
    &&(observationLife(x)==='PRELAUNCH'||observationStage(x)==='observe'
      ||x.metrics?.bottom_start?.current_base===true))
    .sort((a,b)=>Number(b.score)-Number(a.score)||String(b.as_of).localeCompare(String(a.as_of)))
    .slice(0,10).map(x=>({...x,__observation_only:true,__observation_zone:'launch'}));
  // Independent 5-session observation rail for two proven missed-life-cycle patterns:
  // 3062-like MA10 softness close to rising MA20 and 4960-like extended first breakout.
  // No new fetch, no historical write/backfill, no V5/chase/scan eligibility changes.
  const hasRecentModel=(x:any)=>{
    const date=Date.parse(String(x.as_of||'')+'T00:00:00Z');
    return Number.isFinite(latestMs)&&Number.isFinite(date)&&date<=latestMs
      &&latestMs-date<=5*86400000;
  };
  const followupMetrics=(x:any)=>{
    const m=x.metrics||{},mc=m.ma_cluster||{},g=m.entry_candle_guard||{};
    const close=Number(m.close),ma10=Number(m.ma10),ma20=Number(m.ma20),ma60=Number(m.ma60);
    const vol=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots);
    const pos=Number(m.position_1y_pct);
    const bias=ma20>0?(close/ma20-1)*100:NaN;
    const breakState=String(m.shanchuan_v2?.mother_child?.lifecycle?.state||'');
    const seq=m.launch_sequence||mc.launch_sequence||{};
    const first=String(seq.first_signal_date||''),day=Date.parse(String(x.as_of||'')+'T00:00:00Z');
    const firstDay=Date.parse(first+'T00:00:00Z');
    const recentBreak=seq.days_since_first!=null&&Number(seq.days_since_first)>=0
      &&Number(seq.days_since_first)<=5
      &&Number.isFinite(firstDay)&&Number.isFinite(day)
      &&day>=firstDay&&day-firstDay<=9*86400000;
    const supports=close>0&&ma10>0&&ma20>0&&ma60>0&&vol>=1000&&avg>=500
      &&pos>=0&&pos<85&&Number.isFinite(bias)&&close>=ma20*.985
      &&g.weak_after_breakout!==true&&g.macd_weak!==true
      &&m.holding_management?.strong_breakdown!==true
      &&!breakState.includes('low_broken')&&breakState!=='invalid'&&breakState!=='broken';
    const cap=chaseObservationLimit(x);
    const nearTurn=supports&&Number(x.score)>=70
      &&mc.rising?.ma20===true&&mc.rising?.ma60===true
      &&mc.rising?.ma10!==true&&close>=ma10*.99
      &&bias>=-1.5&&bias<=Math.min(cap,6)
      &&(String(m.scan_intelligence?.effective_lifecycle||'')==='PRELAUNCH'
        ||m.bottom_start?.recent_base_date!=null||m.shanchuan_v2?.mother_child?.lifecycle?.active===true);
    const overextended=supports&&Number(x.score)>=40
      &&mc.all_rising===true&&mc.above_all_mas===true
      &&bias>cap&&bias<=cap+20
      &&(recentBreak||mc.breakout_detected_raw===true
        ||m.first_breakout20===true)
      &&(Number(mc.day_volume_ratio)>=1
        ||Number(seq.first_volume_ratio)>=1);
    return {nearTurn,overextended,bias:+bias.toFixed(2),cap,
      reason:nearTurn?'ma10_pending_ma20_supported':overextended?'extended_breakout_wait_pullback':''};
  };
  const followupPool=rawRows.filter(x=>isNewGeneration(x)&&hasRecentModel(x))
    .map(x=>({item:x,watch:followupMetrics(x)}))
    .filter(row=>row.watch.nearTurn||row.watch.overextended);
  const watchRank=(row:any)=>row.watch.nearTurn
    ?Number(row.item.score)*10-Math.abs(row.watch.bias)
    :Number(row.item.score)*10-Math.min(20,row.watch.bias-row.watch.cap);
  const followups=(kind:string)=>followupPool.filter(row=>kind==='near'?row.watch.nearTurn:row.watch.overextended)
    .sort((a,b)=>watchRank(b)-watchRank(a)||String(b.item.as_of).localeCompare(String(a.item.as_of)))
    .slice(0,5).map(row=>({...row.item,__passive_monitor:true,
      __observation_only:!signedNew(row.item),
      __observation_zone:'entry',
      __observation_kind:row.watch.reason,
      __watch_bias20_pct:row.watch.bias,__watch_cap_pct:row.watch.cap}));
  const observationFollowups=[...followups('near'),...followups('extended')];
  const freshCount=fr.ok&&freshMatch?Number(freshMatch[1]):new Set(baseRows.map((x:any)=>String(x.stock_id||''))).size;
  const freshCountEstimated=!(fr.ok&&freshMatch);
  const state=sr.ok?((await sr.json())[0]||{}):{};
  const deriveLaunch=(x:any)=>{const m=x?.metrics||{},a=Number(x?.scores?.A||0),pos=Number(m.position_1y_pct),close=Number(m.close);if(!(a>=80&&Number.isFinite(pos)&&pos<=35&&Number.isFinite(close)&&close>0))return null;const levels=[['MA10',Number(m.ma10)],['MA20',Number(m.ma20)],['MA60',Number(m.ma60)]].filter(([,v])=>Number.isFinite(v)&&v>0).map(([label,v])=>({label,value:v,distance_pct:+((v/close-1)*100).toFixed(2)}));const overhead=levels.filter(z=>z.value>close).sort((a,b)=>a.value-b.value),existing=m.launch_candidate||{},structure=levels.length===3&&overhead.length===0?'all_above':overhead.length===1?'one_overhead':'multi_overhead';const recentDate=existing.recent_bc_date||(x.stage==='B'||x.stage==='C'?x.as_of:m.prior_b_date)||null;const recentStage=existing.recent_bc_stage||(x.stage==='B'||x.stage==='C'?x.stage:(m.prior_b_date?'B':null));return {...existing,eligible:true,a_score:a,position_1y_pct:pos,structure,structure_rank:structure==='all_above'?3:structure==='one_overhead'?2:1,available_ma_count:levels.length,overhead_count:overhead.length,overhead,recent_bc_date:recentDate,recent_bc_stage:recentStage,research_note:'發動候選只代表短期發動機率研究，不是正式進場；正式訊號仍以V5與風控為主'}}; 
  const rows=baseRows.map((x:any)=>{const launch=deriveLaunch(x);if(!launch)return x;const y=JSON.parse(JSON.stringify(x));y.metrics=y.metrics||{};y.metrics.launch_candidate=launch;return y});
  const candidateRows=rows.filter((x:any)=>x?.stage==='B'||x?.stage==='C'||Number(x?.metrics?.current_volume_lots||0)>=1000);
  const relaxedPrelaunch=(x:any)=>{const m=x?.metrics||{},mc=m.ma_cluster||{};const close=Number(m.close),ma20=Number(m.ma20),k=Number(m.daily_k),pos=Number(m.position_1y_pct),cur=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots),vr=Number(mc.day_volume_ratio),dist=Number(mc.distance_to_breakout_pct);const ext=ma20>0?(close/ma20-1)*100:999;return mc.all_rising===true&&mc.above_all_mas===true&&Number.isFinite(dist)&&dist>=-5&&dist<=0&&Number.isFinite(k)&&k>=35&&k<=80&&Number.isFinite(pos)&&pos<=80&&chase(x,close)&&cur>=1000&&avg>=500&&Number.isFinite(vr)&&vr>=.6&&vr<=1.8};
  const thursdayFirst=(x:any)=>{const m=x?.metrics||{},mc=m.ma_cluster||{},close=Number(m.close),open=Number(m.open),prev=Number(m.prev_close),cur=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots),ret=prev>0?(close/prev-1)*100:999,vr=avg>0?cur/avg:0;return m.first_breakout20===true&&mc.all_rising===true&&mc.above_all_mas===true&&close>open&&close>prev&&cur>=1000&&avg>=500&&vr>=1&&ret<=8};
  const thursdayReady=(x:any)=>{const m=x?.metrics||{},mc=m.ma_cluster||{},close=Number(m.close),high=Number(m.high20_prev??m.recent_high20),cur=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots);return mc.all_rising===true&&mc.above_all_mas===true&&Number.isFinite(high)&&high>0&&close>=high*.95&&close<=high&&cur>=1000&&avg>=500};
  // Signed early-breakout OBSERVATION, never a trade permission.
  const preBreakoutWatch=(x:any)=>{
    if(!signedNew(x)||!isNewGeneration(x))return false;
    const m=x.metrics||{},s=m.prebreakout_scout||{},g=m.entry_candle_guard||{};
    const mc=m.ma_cluster||{},close=Number(m.close),prev=Number(m.prev_close);
    const ma10=Number(m.ma10),ma20=Number(m.ma20),ma60=Number(m.ma60);
    const high=Number(m.high20_prev??mc.breakout_price);
    const lots=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots);
    const position=Number(m.position_1y_pct);
    if(!(close>0&&prev>0&&ma10>0&&ma20>0&&ma60>0&&high>0
      &&lots>=1000&&avg>=400&&Number.isFinite(position)
      &&position>=0&&position<=75)||g.weak_after_breakout===true
      ||m.holding_management?.strong_breakdown===true
      ||mc.breakout_detected_raw===true||m.first_breakout20===true)return false;
    const bias=(close/ma20-1)*100,near=(close/high-1)*100;
    const safe=near>=-6&&near<0&&bias>=-2&&bias<=6
      &&close/prev<=1.045&&ma10>=ma20*.985&&ma20>=ma60*.97
      &&chase(x,close);
    if(!safe)return false;
    const signedScout=s.version==='2026-10-21-prebreakout-scout-v1'
      &&String(s.as_of||'')===String(x.as_of||'');
    if(signedScout)return s.eligible===true&&s.actionable===false;
    // Rollout fallback: exact signed V2 daily K; do not claim any
    // historical range or newly recalculated volume profile.
    const ratio=Number(mc.day_volume_ratio);
    return Number(x.score)>=60&&Number.isFinite(ratio)&&ratio>=.75&&ratio<=2.5
      &&mc.rising?.ma10===true&&mc.rising?.ma20===true;
  };
  const discoveryRank=(x:any)=>{const m=x?.metrics||{},mc=m.ma_cluster||{},seq=m.launch_sequence||mc.launch_sequence||{},days=Number(seq.days_since_first),entryState=String(m?.trade_lifecycle?.entry?.state||'');
    if(m?.box_strategy?.discovery?.first_bar_today===true)return 160;
    if(m?.box_strategy?.discovery?.ready_watch===true)return 145;
    if(preBreakoutWatch(x))return 140;
    if(m?.bottom_start?.confirmed===true)return 130;
    if(entryState==='formal_candidate')return 120;
    if(entryState==='starter')return 110;
    if(entryState==='near')return 88;
    if(thursdayFirst(x))return 90;
    if(seq.second_buy_candidate===true)return 85;
    if(thursdayReady(x))return 82;
    if(relaxedPrelaunch(x))return 80;
    if(mc.breakout_detected_raw===true)return 60;
    if(Number.isFinite(days)&&days>=1&&days<=3)return 55;
    if(Number.isFinite(days)&&days>=4&&days<=5)return 45;
    if(m.bottom_start?.confirmed===true)return 40;
    if(m.bottom_start?.current_base===true)return 35;
    if(m.launch_candidate?.eligible===true)return 25;
    return 0
  };
  // Discover low-position bottom-confirmed upturns before all three MA slopes turn up.
  // Passive watchlist only: this never creates trial or formal entry permission.
  const earlyTurnWatch=(x:any)=>{
    const m=x?.metrics||{},b=m.bottom_start||{},mc=m.ma_cluster||{},g=m.entry_candle_guard||{};
    const close=Number(m.close),ma20=Number(m.ma20),vol=Number(m.current_volume_lots);
    const avg=Number(m.avg_volume_20_lots),pos=Number(m.position_1y_pct);
    const k=Number(m.daily_k),d=Number(m.daily_d),score=Number(x?.score);
    const macd=Number(g.macd_hist),prior=Number(g.macd_prev_hist);
    return b.confirmed===true && b.warm_green_pass===true
      && mc.above_all_mas===true && (mc.all_rising!==true||g.main_bull===false)
      && score>=80 && pos>=0 && pos<=35
      && close>ma20 && ma20>0 && chase(x,close)
      && vol>=1000 && avg>=500 && vol/avg>=.8 && vol/avg<=1.8
      && k>=35 && k<=80 && k>=d
      && Number.isFinite(macd)&&Number.isFinite(prior)&&macd>prior
      && g.macd_weak!==true && g.kd_high_weak!==true && g.weak_after_breakout!==true
      && m.holding_management?.strong_breakdown!==true && m.v5?.entry_confirmed!==true;
  };
  // Spring-style low-position base discovery is PASSIVE WATCH only.
  // Uses existing complete-day metrics; cannot change entry eligibility, risk flags or holdings.
  const lowBaseWatch=(x:any)=>{
    const m=x?.metrics||{},b=m.bottom_start||{},mc=m.ma_cluster||{},g=m.entry_candle_guard||{};
    const price=Number(m.close),ma20=Number(m.ma20),vol=Number(m.current_volume_lots);
    const avg=Number(m.avg_volume_20_lots),pos=Number(m.position_1y_pct);
    const k=Number(m.daily_k),d=Number(m.daily_d),score=Number(x?.score);
    const gap=Number(mc.distance_to_breakout_pct),hist=Number(g.macd_hist),prev=Number(g.macd_prev_hist);
    const state=String(m?.trade_lifecycle?.entry?.state||'');
    const seq=m.launch_sequence||mc.launch_sequence||{};
    const days=seq.days_since_first==null?null:Number(seq.days_since_first);
    return b.current_base===true && b.confirmed!==true
      && (state==='observe'||state==='near')
      && mc.all_rising!==true
      && m.first_breakout20!==true && mc.breakout_first_bar!==true
      && m.v5?.entry_confirmed!==true
      && (days===null||!Number.isFinite(days)||days<0)
      && score>=75 && pos>=0 && pos<=35
      && price>0 && ma20>0 && price>=ma20 && chase(x,price)
      && vol>=1000 && avg>=500 && vol/avg>=0.6 && vol/avg<=2.2
      && k>=35 && k<=75 && k>=d
      && Number.isFinite(hist)&&Number.isFinite(prev)&&hist>prev
      && Number.isFinite(gap)&&gap>=-5&&gap<=0
      && g.weak_after_breakout!==true && g.macd_weak!==true && g.kd_high_weak!==true
      && m.holding_management?.strong_breakdown!==true;
  };
  // Keep a previous existing EOD candidate on the observation shelf while today's
  // protected scanner replaces snapshots in batches. One prior model DAY only;
  // never creates a new V5/formal signal, changes risk scores, or runs an analyzer.
  const recentCandidateModelDays=[...new Set(rows.map(x=>String(x?.as_of||'')).filter(Boolean))].sort().reverse();
  const latestCandidateModelDay=recentCandidateModelDays[0]||'';
  const previousCandidateModelDay=recentCandidateModelDays[1]
    && Date.parse(latestCandidateModelDay+'T00:00:00Z')-Date.parse(recentCandidateModelDays[1]+'T00:00:00Z')<=5*86400000
      ? recentCandidateModelDays[1] : '';
  // Display-tier quality screening only: no change to the locked MA10/20/60 analyzer.
  // For launch mode, filter BEFORE slicing: poor candidates must never crowd out a
  // valid prelaunch name simply because its broad discovery rank is lower.
  const shanchuanStructureBroken=(x:any)=>{
    const m=x?.metrics||{},l=m.shanchuan_v2?.mother_child?.lifecycle||{};
    return ['mother_low_broken','child_low_broken'].includes(String(l.state||''))
      || ['support_broken_3d','support_lost_warning','support_below_watch'].includes(String(m.box_strategy?.range_state||''));
  };
  const qualityLaunch=(x:any)=>{
    const m=x?.metrics||{},mc=m.ma_cluster||{},guard=m.entry_candle_guard||{},base=m.bottom_start||{};
    const life=String(m?.trade_lifecycle?.entry?.state||'');
    const score=Number(x?.score),close=Number(m.close),ma20=Number(m.ma20);
    const k=Number(m.daily_k),pos=Number(m.position_1y_pct);
    const vol=Number(m.current_volume_lots),hi=Number(m.recent_high20??m.high20_prev??mc.breakout_price);
    const asOf=String(x?.as_of||'');
    const latestAsOf=latestCandidateModelDay;
    const learned=String(m?.scan_intelligence?.effective_lifecycle||'');
    const seq=m.launch_sequence||mc.launch_sequence||{};
    const days=Number(seq.days_since_first);
    // The front end merges launched-but-not-formal stocks into 發動前.
    // Match its ACTIVE/first-bar/starter lifecycle while retaining every quality/risk gate below.
    const launched=learned==='ACTIVE'||m.first_breakout20===true
      ||mc.breakout_detected_raw===true||mc.breakout_first_bar===true
      ||life==='starter'||(seq.days_since_first!=null&&Number.isFinite(days)&&days>=0&&days<=3);
    const formal=learned==='ENTRY'||life==='formal_candidate'||m.v5?.entry_confirmed===true;
    // Only verified latest-day models can be presented as confirmed high-quality prelaunch.
    // Older rows remain stored as history, but are not interpreted as all-market zero.
    if(!asOf||(asOf!==latestAsOf&&asOf!==previousCandidateModelDay))return false;
    // Only the latest COMPLETED trading-day model can populate 發動前.
    // Previously retained PRELAUNCH/ACTIVE rows were flooding the launch list
    // while tonight's protected scanner had processed only part of the market.
    // Older snapshots remain in the database; never republish them as today's
    // candidates, even with a yellow observation badge.
    if(asOf!==latestAsOf)return false;
    // Prepared independent boxes stay in 發動前; first bars enter ENTRY.
    // MA60 is NOT a discovery prerequisite, only a later original trade gate.
    const independent=m.box_strategy?.discovery||{};
    if(shanchuanStructureBroken(x))return false;
    if(independent.first_bar_today===true)return false;
    if(!launched&&!formal&&preBreakoutWatch(x))return true;
    if(independent.ready_watch===true
      &&chase(x,close)&&m.v5?.entry_confirmed!==true
      &&learned!=='ENTRY'&&learned!=='ACTIVE'&&life!=='formal_candidate'&&life!=='starter'
      &&Number(m.avg_volume_20_lots)>=500
      &&vol>=1000&&Number.isFinite(pos)&&pos>=0&&pos<=60
      &&guard.weak_after_breakout!==true&&m.holding_management?.strong_breakdown!==true)
      return true;
    if((discoveryRank(x)<=0&&!launched)||!['A','B','C','WATCH'].includes(String(x?.stage)))return false;
    if(!Number.isFinite(score)||score<(x.stage==='A'?80:x.stage==='WATCH'?75:70))return false;
    if(!Number.isFinite(vol)||vol<1000||!Number.isFinite(close)||close<=0||!Number.isFinite(ma20)||ma20<=0)return false;
    if(!Number.isFinite(pos)||pos>=85||!Number.isFinite(k)||k>80||k<20)return false;
    // Early watch is visible without relaxing ordinary MA10/20/60 buy gates.
    if(earlyTurnWatch(x)||lowBaseWatch(x))return true;
    if(!chase(x,close)||guard.main_bull===false||guard.weak_after_breakout===true)return false;
    if(mc.all_rising!==true||mc.above_all_mas!==true)return false;
    // Previously all ACTIVE/starter/first-bar stocks were removed before the front end
    // could show their 🔥 發動中 label. Bridge those only when not formally entered.
    if(launched&&!formal)return true;
    if(base.confirmed===true||mc.breakout_detected_raw===true||mc.breakout_first_bar===true
      ||m.first_breakout20===true||m.v5?.entry_confirmed===true||m.v5?.pending_ready===true
      ||['formal_candidate','starter'].includes(life)
      ||['ACTIVE','ENTRY'].includes(learned)
      ||((x.stage==='B'||x.stage==='C')&&life==='near')
      ||seq.second_buy_candidate===true
      ||(seq.days_since_first!=null&&Number.isFinite(days)&&days>=0&&days<=3))return false; // belongs in entry/active monitoring, not prelaunch
    const near=Number.isFinite(hi)&&hi>0&&close>=hi*.95&&close<hi;
    return base.current_base===true||mc.watch_ready===true||near;
  };
  const launchRows=rows.filter(qualityLaunch);
  const priority:any={C:3,B:2,A:1,WATCH:0};
  // No new candidate zone, buy authorization, or V5 weighting.
  // Weak/missing fundamentals never veto a technical first-bar candidate.
  const fundamentalRankBonus=(x:any)=>{
    if(!signedNew(x)||!isNewGeneration(x))return 0;
    const f=x.metrics?.fundamental_blend||{};
    if(f.version!=='2026-10-21-fundamental-chip-confluence-v1'
      ||String(f.as_of)!==String(x.as_of))return 0;
    return (f.revenue3m_yoy_gt20===true?3:0)
      +(f.gross_margin_2q_up===true?3:0)
      +(f.operating_cashflow_positive===true?3:0)
      +(f.foreign_net_buy_10d===true?3:0)
      +(f.volume_break_ma20===true?3:0)
      +(f.all_five_confirmed===true?2:0);
  };
  const qualityRank=(x:any)=>{
    const m=x?.metrics||{},pos=Number(m.position_1y_pct),ma20=Number(m.ma20),close=Number(m.close);
    const distance=ma20>0?Math.max(0,(close/ma20-1)*100):99;
    const near=(Number(m.recent_high20)>0&&close<Number(m.recent_high20)&&close>=Number(m.recent_high20)*.95)?14:0;
    // Learning rank adjustments are paused; preserve original model priority.
    // Historical evidence remains stored for later independent evaluation.
    const learningBias=0;
    const firstOrigin=Boolean(x?.as_of) && (String(m.ma_cluster?.launch_origin_date||'')===String(x.as_of) || m.ma_cluster?.display_first_bar===true);
    const firstBarPriority=firstOrigin && distance<=5 && m.entry_candle_guard?.weak_after_breakout!==true ? 18 : 0;
    return Number(x?.score||0)*3+firstBarPriority+(pos<=35?16:0)+near+(distance<=3?8:0)
       +(x?.stage==='B'||x?.stage==='C'?8:0)+(m?.trade_lifecycle?.entry?.state==='near'?8:0)
       +learningBias+fundamentalRankBonus(x);
  };
  // 2026-10-20 priority-only: research-backed strong pullback/rebreak.
  // This never changes the S core, score, stage, buyability, quotas or holdings.
  const strongRebreakStudyRank=(x:any)=>{
    if(!x||!signedNew(x)||String(x.as_of||'')!==latestCandidateModelDay
      ||x.__observation_only===true||x.__passive_monitor===true)return 0;
    const m=x.metrics||{},mc=m.ma_cluster||{},g=m.entry_candle_guard||{};
    const close=Number(m.close),ma10=Number(m.ma10),ma20=Number(m.ma20),ma60=Number(m.ma60);
    const pos=Number(m.position_1y_pct),vol=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots);
    const ratio=Number(mc.day_volume_ratio),k=Number(m.daily_k);
    const bias=ma20>0?(close/ma20-1)*100:NaN;
    const actualRebreak=m.pullback_rebreak===true||m.v5?.structure_pass===true||m.v5?.entry_confirmed===true;
    return actualRebreak&&ma10>0&&ma20>0&&ma60>0&&close>=Math.max(ma10,ma20,ma60)
      &&pos>75&&pos<85&&bias>=0&&bias<=5
      &&vol>=1000&&avg>=500&&ratio>=1&&ratio<=2.5&&Number.isFinite(k)&&k<=80
      &&mc.rising?.ma20===true&&mc.rising?.ma60===true
      &&g.weak_after_breakout!==true&&m.holding_management?.strong_breakdown!==true ?1:0;
  };
  // FIRST BAR: observation transport, NOT an independent buy/trial signal.
  // Keep valid first-bar S snapshots in monitor even if stage remains WATCH.
  // Never override V5/formal gate, risk, model date or daily scanning limits.
  const firstBarObservation=(x:any)=>{
    const m=x?.metrics||{},mc=m.ma_cluster||{},box=m.box_strategy?.discovery||{};
    const d=String(x?.as_of||''),last=String(latestCandidateModelDay||'');
    const dateGap=(Date.parse(last+'T00:00:00Z')-Date.parse(d+'T00:00:00Z'))/86400000;
    if(!d||!last||!Number.isFinite(dateGap)||dateGap<0||dateGap>5)return false;
    const distinct=(mc.breakout_first_bar===true&&mc.display_first_bar===true)
      ||(String(mc.launch_origin_date||'')===d&&mc.all_rising===true)
      ||(box.first_bar_today===true&&String(box.first_bar_date||'')===d);
    if(!distinct)return false;
    const c=Number(m.close),ma20=Number(m.ma20),pos=Number(m.position_1y_pct);
    const vol=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots);
    return c>0&&ma20>0&&pos>=0&&pos<85&&vol>=1000&&avg>=500
      &&chase(x,c)&&m.entry_candle_guard?.main_bull!==false
      &&m.entry_candle_guard?.weak_after_breakout!==true
      &&m.holding_management?.strong_breakdown!==true;
  };
  // PASSIVE Shan-Chuan first-bar scout rail. Derived only from the SAME existing
  // S picks-candidates RPC rows. No scan, analyzer, C quote, write, trade approval,
  // or change to the main picks/filter/stage/priority pipeline.
  const scoutObservation=(x:any)=>{
    if(!isNewGeneration(x)||!signedNew(x))return null;
    const d=String(x.as_of||''),last=String(latestCandidateModelDay||'');
    const age=(Date.parse(last+'T00:00:00Z')-Date.parse(d+'T00:00:00Z'))/86400000;
    if(!d||!last||!Number.isFinite(age)||age<0||age>5)return null;
    const m=x.metrics||{},mc=m.ma_cluster||{},g=m.entry_candle_guard||{};
    const box=m.box_strategy?.discovery||{},mother=String(m.shanchuan_v2?.mother_child?.lifecycle?.state||'');
    const seq=m.launch_sequence||mc.launch_sequence||{};
    const first=String(seq.first_signal_date||'');
    const firstAge=(Date.parse(d+'T00:00:00Z')-Date.parse(first+'T00:00:00Z'))/86400000;
    const recentFirst=Boolean(first)&&Number.isFinite(firstAge)&&firstAge>=0&&firstAge<=10;
    const c=Number(m.close),ma20=Number(m.ma20),v=Number(m.current_volume_lots),avg=Number(m.avg_volume_20_lots),pos=Number(m.position_1y_pct);
    if(!(c>0&&ma20>0&&v>=1000&&avg>=500&&pos>=0&&pos<85))return null;
    const bias=(c/ma20-1)*100;
    const hi=Number(m.high20_prev||m.recent_high20||mc.breakout_price);
    const near=hi>0&&c<hi&&c>=hi*.95;
    const structure=box.ready_watch===true||box.state==='box_consolidation'
      ||['formed','waiting_breakout','breakout_held'].includes(mother)
      ||mc.watch_ready===true||m.bottom_start?.current_base===true||near;
    if(!structure&&!recentFirst)return null;
    const broken=mother.includes('low_broken')||mother==='invalid'||mother==='broken'
      ||g.weak_after_breakout===true||m.holding_management?.strong_breakdown===true
      ||c<ma20*.985;
    // 5% is the existing conservative trial constraint, NOT a change to
    // weighted-cap chase logic or the locked official buy-signal model.
    const overheated=bias>5;
    const fresh=d===last;
    // A signed S ACTIVE/ENTRY/starter model outranks the passive first-bar
    // prelaunch scout. Keep the original observation for cross-day history,
    // but never display it as a competing current prelaunch status.
    const phase=String(m.scan_intelligence?.effective_lifecycle||'');
    const entryState=String(m.trade_lifecycle?.entry?.state||'');
    const promoted=fresh&&(['ACTIVE','ENTRY'].includes(phase)
      ||['starter','formal_candidate'].includes(entryState)
      ||m.v5?.entry_confirmed===true);
    const firstToday=fresh&&(mc.breakout_first_bar===true||box.first_bar_today===true);
    const kind=broken?'invalid':overheated?'overheated':firstToday?'first_bar':recentFirst?'followup':'prelaunch';
    const label=kind==='invalid'?'🔴 結構轉弱｜已退出有效追蹤'
      :kind==='overheated'?'🔵 距MA20過高｜禁止追價'
      :promoted?'🎯 已轉進場雷達｜前哨留歷史'
      :kind==='first_bar'?'📍 第一根突破｜仍須驗證'
      :kind==='followup'?'📌 突破後跨日追蹤'
      :'🌱 山川第一根前哨｜尚非買點';
    const reason=kind==='invalid'
      ?(mother.includes('low_broken')?'山川母子K支撐失效':g.weak_after_breakout===true?'完整日K量價轉弱':c<ma20*.985?'MA20支撐已失守':'原結構風控轉弱')
      :kind==='overheated'?'距MA20 +'+bias.toFixed(2)+'%，超過前哨觀察的5%低乖離範圍'
      :promoted?'S模型 '+(phase||'未標明')+'／'+(entryState||'未標明')+'；以進場雷達最新風控為準，不是第二個買點'
      :kind==='first_bar'?'本日模型首破確認；盤中買入仍須原C行情與風控'
      :kind==='followup'?'歷史第一根 '+first+'；持續檢查回踩、過熱與結構'
      :'箱型、母子K或均線接近突破位置；等待第一根量價確認';
    return {stock_id:String(x.stock_id||''),stock_name:String(x.stock_name||''),market:String(x.market||''),as_of:d,scanned_at:x.scanned_at,stage:x.stage,score:x.score,close:c,ma20,volume_lots:v,__scout_version:'2026-10-20-shanchuan-v1',__scout_only:true,__scout_state:kind,
      __scout_label:label,__scout_reason:reason,
      __scout_first_date:first||null,__scout_bias20:+bias.toFixed(2),
      __scout_score:kind==='first_bar'?160:kind==='prelaunch'?(near?130:115):kind==='followup'?105:kind==='overheated'?30:10};
  };
  const scoutObservationPool=rows.map(scoutObservation).filter(Boolean);
  const scoutActive=scoutObservationPool.filter((x:any)=>!['invalid','overheated'].includes(x.__scout_state))
    .sort((a:any,b:any)=>Number(b.__scout_score)-Number(a.__scout_score)
      ||String(b.as_of).localeCompare(String(a.as_of))||Number(b.score)-Number(a.score))
    .slice(0,18);
  const scoutRisk=scoutObservationPool.filter((x:any)=>['invalid','overheated'].includes(x.__scout_state))
    .sort((a:any,b:any)=>String(b.as_of).localeCompare(String(a.as_of))
      ||Number(b.score)-Number(a.score)).slice(0,8);
  const scoutObservations=[...scoutActive,...scoutRisk];
  // Visibility-only: the analyzer may classify a valid S entry lifecycle as
  // WATCH even when it reports 'starter' or 'formal_candidate'. The old monitor
  // filter discarded these candidates, so C could never observe them in ENTRY.
  // Keep the signed/current S classification and all trial/formal safety gates.
  const signedEntryLife=(x:any)=>{
    if(!x||String(x.as_of||'')!==latestCandidateModelDay
      ||!signedNew(x)||!isNewGeneration(x))return '';
    const life=String(x.metrics?.trade_lifecycle?.entry?.state||'');
    return life==='formal_candidate'||life==='starter'?life:'';
  };
  const entryLifeWatchRank=(x:any)=>signedEntryLife(x)==='formal_candidate'?3
    :signedEntryLife(x)==='starter'?2:0;
  const ranked=(mode==='launch'?launchRows:candidateRows.filter((x:any)=>stage?x.stage===stage:(x.stage!=='WATCH'||(mode==='monitor'&&(firstBarObservation(x)||!!signedEntryLife(x)))))).sort((a:any,b:any)=>mode==='launch'
    ?((Number(String(b.as_of||'')===latestCandidateModelDay)-Number(String(a.as_of||'')===latestCandidateModelDay))||(Number(preBreakoutWatch(b))-Number(preBreakoutWatch(a)))||(Number(lowBaseWatch(a))-Number(lowBaseWatch(b)))||(qualityRank(b)-qualityRank(a))||(discoveryRank(b)-discoveryRank(a))||String(b.scanned_at).localeCompare(String(a.scanned_at)))
    :((mode==='monitor'?((Number(firstBarObservation(b))-Number(firstBarObservation(a)))||(entryLifeWatchRank(b)-entryLifeWatchRank(a))):0)||(priority[b.stage]-priority[a.stage])||(strongRebreakStudyRank(b)-strongRebreakStudyRank(a))||((Number(b.score)-Number(a.score))*3+fundamentalRankBonus(b)-fundamentalRankBonus(a))
      ||String(b.scanned_at).localeCompare(String(a.scanned_at)))).slice(0,limit);
  const stageCounts=candidateRows.reduce((m:any,x:any)=>(m[x.stage]=(m[x.stage]||0)+1,m),{});
  const launchCounts=launchRows.reduce((m:any,x:any)=>{if(lowBaseWatch(x))m.low_base_watch++;if(preBreakoutWatch(x))m.prebreakout_watch++;const lc=x?.metrics?.launch_candidate||{},mc=x?.metrics?.ma_cluster||{},seq=x?.metrics?.launch_sequence||mc.launch_sequence||{},s=String(lc.structure||'multi_overhead');m.total++;if(lc.eligible===true)m[s]=(m[s]||0)+1;if(x?.metrics?.bottom_start?.confirmed===true)m.bottom_confirmed++;if(x?.metrics?.bottom_start?.current_base===true)m.bottom_base++;if(mc.watch_ready===true||relaxedPrelaunch(x))m.prelaunch++;if(mc.breakout_detected_raw===true)m.first_raw++;if(mc.breakout_first_bar===true)m.first_actionable++;if(mc.breakout_detected_raw===true&&mc.breakout_first_bar!==true)m.first_hot++;const days=Number(seq.days_since_first);if(Number.isFinite(days)&&days>=1&&days<=3)m.follow_1_3++;if(seq.second_buy_candidate===true)m.second_buy++;return m},{total:0,prebreakout_watch:0,low_base_watch:0,all_above:0,one_overhead:0,multi_overhead:0,bottom_confirmed:0,bottom_base:0,prelaunch:0,first_raw:0,first_actionable:0,first_hot:0,follow_1_3:0,second_buy:0});
  const industryLeaders:any[]=[];
  const latestAsOf=rows.reduce((m:any,x:any)=>String(x?.as_of||'')>m?String(x.as_of):m,'');
  // Count latest-day models across all scanned stocks, not just quality-screened candidates.
  // Scanned in the past 144 hours is not proof of using the latest valid trading-day K.
  const lr=latestAsOf?await db('spring_swallow_scan_results?select=stock_id&as_of=eq.'+latestAsOf+'&metrics->box_strategy->>model_generation=eq.shanchuan-independent-v2&metrics->box_strategy->discovery->>version=eq.2026-10-16-shanchuan-independent-v2&limit=1',{headers:{Prefer:'count=exact'}}):null;
  const range=lr?.ok?(lr.headers.get('content-range')||''):'';
  const exactCount=range.includes('/')?Number(range.split('/').pop()):NaN;
  const latestIds=new Set(rows.filter((x:any)=>String(x?.as_of||'')===latestAsOf).map((x:any)=>String(x.stock_id||'')));
  const latestCount=Number.isFinite(exactCount)?exactCount:latestIds.size;
  const latestPercent=total?+((latestCount/total)*100).toFixed(1):0;
  const liveRanked=await attachTDCC(ranked);
  return out({ok:true,tdcc_gate_version:TDCC_GATE_VERSION,chase_rule_version:CHASE_RULE_VERSION,rule_version:'2026-10-06-ma10-20-60-v1',rule_locked:true,mode,generated_at:new Date().toISOString(),fresh_hours:hrs,quality_screen:'2026-10-16-unified-shanchuan-generation-v3',candidate_generation:'shanchuan-independent-v2',quality_total:mode==='launch'?launchRows.length:null,prior_model_date:previousCandidateModelDay||null,prior_observe_count:mode==='launch'?launchRows.filter((x:any)=>String(x.as_of||'')===previousCandidateModelDay).length:0,has_more:mode==='launch'&&launchRows.length>ranked.length,observation_only:true,observation_launch:observationLaunch,observation_entry:observationEntry,observation_followups:observationFollowups,scout_observations:(mode==='launch'||mode==='monitor'?scoutObservations:[]),scout_policy:'shan-chuan-passive-first-bar-no-buy-no-extra-scan',observation_rule:'historical_snapshot_passive_watch_only_no_buy',launch_counts:launchCounts,progress:{total_stocks:total,scanned_recent:freshCount,scanned_recent_estimated:freshCountEstimated,scanned_fresh:latestCount,percent:latestPercent,latest_as_of:latestAsOf,latest_count:latestCount,latest_percent:latestPercent,latest_complete:total>0&&latestCount>=total*.98,cursor:state.cursor_pos??0,last_batch_at:state.last_batch_at,last_cycle_at:state.last_cycle_at,last_error:state.last_error,complete_cycle:!!state.last_cycle_at},stage_counts:stageCounts,industry_leaders:industryLeaders,picks:liveRanked,filters:{min_daily_volume_lots_for_A:1000,bc_stage_exempt_from_daily_volume_display_filter:true,bc_low_volume_shown_as_warning:true,launch_candidate_exempt_from_daily_volume_display_filter:true,launch_candidate_rule:'2026-10-06：MA10/20/60齊揚且股價站上三線；發動前哨距20日前高約5%內；首根首次突破20日前高＋紅K＋量達20日均量1倍＋漲幅<=8%即抓；三線糾結<=8%只加分不淘汰；V5作後續二次確認。',v5_formal_liquidity_unchanged:true,exact_symbol_search_exempt:true,holdings_exempt_via_exact_search:true},entry_validation:{status:'hold',run_id:'2ead7e08-ce77-4c7b-acf3-58437e66b209',reason:'2025+樣本外回測未通過正期望門檻',formal_entry_enabled:false},notes:{A:'低階候選',B:'結構轉強標籤',C:'回踩再攻標籤',WATCH:'發動雷達可先於B/C出現'},disclaimer:'研究型選股模型，僅供研究參考，不構成投資建議。'});
});
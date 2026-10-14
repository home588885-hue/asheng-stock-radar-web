/**
 * RESEARCH ONLY: candidate MA10 pullback / next-session reclaim.
 * DO NOT import from production S model, admin page or C bridge.
 * Snapshot data is EOD-only, no next-day fields may enter classification.
 * Quote is a separate observation, never substituted for EOD bars.
 */
export function classifyPullbackEod(row) {
  const m=row?.metrics||{},g=m.entry_candle_guard||{},mc=m.ma_cluster||{};
  const b=m.bottom_start||{},hm=m.holding_management||{};
  const n=(v)=>v===null||v===undefined?NaN:Number(v);
  const score=n(row?.score),chip=n(m.chip?.score),pos=n(m.position_1y_pct);
  const close=n(m.close),prev=n(m.prev_close),ma10=n(m.ma10),ma20=n(m.ma20),ma60=n(m.ma60);
  const lots=n(m.current_volume_lots),avg=n(m.avg20_volume_lots),k=n(m.daily_k),d=n(m.daily_d);
  const hist=n(g.macd_hist),prevHist=n(g.macd_prev_hist);
  const data=[score,chip,pos,close,prev,ma10,ma20,ma60,lots,avg,k,d,hist,prevHist];
  if(!data.every(Number.isFinite)||[close,prev,ma10,ma20,ma60,avg].some(x=>x<=0))return {status:"missing_data",candidate:false};
  const volumeRatio=lots/avg;
  const reasons=[];
  if(!/^20\d{2}-\d{2}-\d{2}$/.test(String(row?.as_of||"")))reasons.push("stale_or_undated");
  if(b.current_base!==true||b.confirmed===true)reasons.push("not_original_bottom_base");
  if(!["observe","near"].includes(String(m.trade_lifecycle?.entry?.state||"")))reasons.push("different_lifecycle");
  if(score<75||chip<60||pos<0||pos>35)reasons.push("rank_or_chips");
  if(!(close<prev&&close>=ma10&&close<=ma10*1.015
    &&close>=ma20&&close<=ma20*1.05&&close>=ma60
    &&mc.above_all_mas===true))reasons.push("not_ma10_support_pullback");
  if(!(lots>=1000&&avg>=500&&volumeRatio>=.6&&volumeRatio<=1))reasons.push("liquidity_or_contract");
  if(!(k>=35&&k<=75&&k>=d&&hist>prevHist))reasons.push("momentum");
  if(g.weak_after_breakout===true||g.macd_weak===true||g.kd_high_weak===true
    ||hm.strong_breakdown===true||hm.exit_ready===true
    ||n(hm.below_ma20_days)>=3)reasons.push("hard_risk");
  return {status:reasons.length?"blocked":"watch_only",candidate:reasons.length===0,
    reasons,volumeRatio,ma20DistancePct:100*(close/ma20-1)};
}

export function classifyNextDayReclaim(row,quote,clockMinutes,verifiedCTrade) {
  const eod=classifyPullbackEod(row);
  if(!eod.candidate)return {status:"no_prior_watch",trial:false};
  // For research, the caller must independently verify BOTH
  // the live quote's date and executed-trade status.
  if(!verifiedCTrade||!quote||quote.has_today_trade!==true)return {status:"no_verified_trade",trial:false};
  const y=String(row.as_of).replace(/-/g,"");
  const d=String(quote.quote_date||"").replace(/-/g,"");
  const prevDate=Date.parse(row.as_of+"T00:00:00Z");
  const today=Date.parse(d.slice(0,4)+"-"+d.slice(4,6)+"-"+d.slice(6,8)+"T00:00:00Z");
  if(!/^\d{8}$/.test(d)||!Number.isFinite(today)||today<=prevDate
     ||today-prevDate>5*86400000)return {status:"invalid_session",trial:false};
  const t=String(quote.quote_time||"").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  const quoteMinute=t?Number(t[1])*60+Number(t[2]):NaN;
  if(!Number.isFinite(clockMinutes)||clockMinutes<540||clockMinutes>=800
    ||!Number.isFinite(quoteMinute)||quoteMinute<540||quoteMinute>clockMinutes
    ||clockMinutes-quoteMinute>5)return {status:"outside_fresh_window",trial:false};
  const m=row.metrics;
  const price=Number(quote.price),open=Number(quote.open),lots=Number(quote.volume_lots);
  const high=Number(quote.high),avg=Number(m.avg20_volume_lots);
  const ma20=Number(m.ma20),ma10=Number(m.ma10),ma60=Number(m.ma60);
  const lastOpen=Number(m.open),lastClose=Number(m.close);
  // Pace is an estimate for trial research; it never updates EOD averages.
  const elapsed=Math.max(.08,Math.min(1,(quoteMinute-540)/270));
  const pace=lots/(avg*elapsed);
  if(![price,open,lots,avg,ma20,ma10,ma60,lastOpen,lastClose].every(Number.isFinite)
    ||Math.min(price,open,avg,ma20,ma10,ma60,lastOpen,lastClose)<=0)return {status:"missing_trade_fields",trial:false};
  const good=price>lastOpen&&price>lastClose&&price>open
    &&price>=Math.max(ma10,ma20,ma60)
    &&price/ma20<=1.05
    &&(!Number.isFinite(high)||high<=0||price>=high*.985)
    &&lots>=1000&&pace>=.9;
  return {status:good?"orange_research_only":"reclaim_incomplete",trial:good,pace,
    note:"Even when true, NOT a production formal buy, automatic order or historical backtest win"};
}

#!/usr/bin/env node
'use strict';
// Research-only fail-closed gate. No API calls, live orders, UI, holdings or deployment.
const fs=require('fs');
const CUT='2026-10-23',MODEL='M20_M60_UP20';
function audit(history,forward) {
  const why=[], rows=Array.isArray(history?.grid)?history.grid:[];
  const match=rows.filter(r=>r.regime===MODEL&&r.delay_days===0&&Math.abs(r.slippage_one_side_pct-0.3)<1e-7);
  if(match.length!==1)why.push('No unique frozen conservative-slippage backtest');
  const h=match[0]?.groups||{};
  for(const name of ['train_2022_24','retrospective_2025','retrospective_2026','full_2022_26']){
    const r=h[name];
    if(!r||!Number.isInteger(r.trades)||r.trades<1||!Number.isFinite(r.pnl_twd))
      why.push('Missing validated period '+name);
    else if(r.pnl_twd<=0)why.push('Non-positive net P&L '+name);
  }
  const trades=Array.isArray(forward?.trades)?forward.trades:[];
  if(forward?.model!=='v5_precision_0050_gate_delay0'||forward?.freeze_date!==CUT)
    why.push('No exact frozen prospective model');
  if(forward?.validated_source!=='independent_broker_or_exchange_replay')
    why.push('Unverified prospective fills');
  if(!(forward?.fee_floor_each_side_twd>=20&&forward?.slippage_one_side_pct>=0.3))
    why.push('Fee/slippage stress not verified');
  if(trades.length<20)why.push('Need >=20 post-freeze fills');
  let net=0,first='',last='',bad=[];
  const slots=[];
  for(const t of trades){
    const code=String(t.symbol||''),sig=String(t.signal_date||''),
      en=String(t.entry_date||''),ex=String(t.exit_date||'');
    if(!/^\d{4,6}$/.test(code)||!(sig>CUT&&en>=sig&&ex>=en))
      bad.push('Unverifiable dates or symbol');
    if(!Number.isFinite(t.net_profit_twd)||!Number.isFinite(t.buy_cost_twd)||
       t.buy_cost_twd<=0||t.buy_cost_twd>5000)
      bad.push('Invalid costed fill');
    else net+=t.net_profit_twd;
    if(!first||sig<first)first=sig;
    if(!last||ex>last)last=ex;
    slots.push({code,en,ex,cost:t.buy_cost_twd});
  }
  if(trades.length){
    const days=(Date.parse(last+'T00:00:00Z')-Date.parse(first+'T00:00:00Z'))/86400000;
    if(!Number.isFinite(days)||days<90)bad.push('Prospective duration below 90 days');
    for(let i=0;i<slots.length;i++){
      let concurrentCost=0,concurrentCount=0;
      for(let j=0;j<slots.length;j++){
        if(slots[j].en<=slots[i].en&&slots[j].ex>=slots[i].en){
          concurrentCost+=Number(slots[j].cost)||0;concurrentCount++;
          if(i!==j&&slots[i].code===slots[j].code)bad.push('Duplicate live ticker');
        }
      }
      if(concurrentCount>12||concurrentCost>60000+1e-8)bad.push('Capital/position limits exceeded');
    }
  }
  if(net<=0)bad.push('Prospective P&L not positive');
  if(bad.length)why.push(...new Set(bad));
  return {
    status:why.length?'NO_GO':'MANUAL_REVIEW_REQUIRED',
    production_change_authorized:false,
    frozen_date:CUT,selected_model:'v5_precision_0050_gate_delay0',
    historical_5yr_conservative_net_twd:h.full_2022_26?.pnl_twd??null,
    prospective_trade_count:trades.length,prospective_net_twd:Number(net.toFixed(2)),
    reasons:why
  };
}
if(require.main===module){
  const [a,b]=process.argv.slice(2);
  if(!a){console.error('usage: node diagnostics/vnext-proof-gate-20261023.js historical_grid.json [independent_forward_ledger.json]');process.exit(2)}
  try{
    const res=audit(JSON.parse(fs.readFileSync(a)),b?JSON.parse(fs.readFileSync(b)):null);
    console.log(JSON.stringify(res,null,2));
    if(res.status==='NO_GO')process.exitCode=1;
  }catch(e){console.error('ERROR: '+e.message);process.exitCode=2}
}
module.exports={audit};
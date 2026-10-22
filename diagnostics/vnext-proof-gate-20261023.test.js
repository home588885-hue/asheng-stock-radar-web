'use strict';
const assert=require('node:assert/strict');
const {audit}=require('./vnext-proof-gate-20261023.js');
function historic(value=100){
  return {grid:[{regime:'M20_M60_UP20',delay_days:0,slippage_one_side_pct:0.3,
    groups:Object.fromEntries(['train_2022_24','retrospective_2025','retrospective_2026','full_2022_26'].map(k=>[k,{trades:60,pnl_twd:value}]))}]};
}
function future(){
  let trades=[];
  for(let i=0;i<20;i++){
    const dt=new Date(Date.UTC(2026,10,2+i*5));
    const dt1=new Date(dt.getTime()+86400000);
    const as=v=>v.toISOString().slice(0,10);
    trades.push({symbol:String(1100+i),signal_date:as(dt),
      entry_date:as(dt),exit_date:as(dt1),net_profit_twd:100,buy_cost_twd:4950});
  }
  return {model:'v5_precision_0050_gate_delay0',freeze_date:'2026-10-23',
    validated_source:'independent_broker_or_exchange_replay',
    slippage_one_side_pct:0.3,fee_floor_each_side_twd:20,trades};
}
const clean=future();
let x=audit(historic(-100),null);
assert.equal(x.status,'NO_GO');
assert.equal(x.production_change_authorized,false);
assert.match(x.reasons.join(' '),/2022_24/);
assert.match(x.reasons.join(' '),/independent|Unverified/i);
x=audit(historic(-100),clean);
assert.equal(x.status,'NO_GO'); // An apparent forward win cannot erase failed historical robustness.
x=audit(historic(100),null);
assert.equal(x.status,'NO_GO'); // A historical positive is never enough.
x=audit(historic(100),clean);
assert.equal(x.status,'MANUAL_REVIEW_REQUIRED');
assert.equal(x.production_change_authorized,false); // NEVER auto deploy.
const over=future();over.trades[0].buy_cost_twd=6000;
assert.equal(audit(historic(100),over).status,'NO_GO');
const stale=future();stale.trades[0].signal_date='2026-06-01';
assert.equal(audit(historic(100),stale).status,'NO_GO');
const dup=future();dup.trades[1].symbol=dup.trades[0].symbol;
dup.trades[1].entry_date=dup.trades[0].entry_date;
assert.equal(audit(historic(100),dup).status,'NO_GO');
console.log('PASS 7 fail-closed research proof gate regression cases; production authorization always false');
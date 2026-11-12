'use strict';
const assert=require('node:assert/strict'),{check}=require('./vnext-growth-disjoint-guard-20261023.js');
function sample() {
  const row=(slippage)=>({universe_id:'disjoint-97-tickers-2026',year:2026,trades:94,
    net_twd:1200,stock_universe_overlap_with_development:0,
    slippage_one_side_pct:slippage,eod_mark_to_market_drawdown_pct:-4.2});
  return {model:'growth_pullback_0050_rise_delay2',
    simulator:'conservative_daily_ohlc_cash_limited',purchase_limit_twd:5000,
    cash_cap_twd:60000,exit_hard_stop_pct:-5,exit_take_profit_pct:10,
    min_commission_each_side_twd:20,data_verified_price_count:98,data_dividend_errors:0,
    independent_cohort:{cost_stress_0_30:row(.30),cost_stress_0_50:row(.50)},
    future_forward:{first_trade_signal_date:'2026-11-02',verified_fills:25,span_calendar_days:100,net_twd:100}};
}
function expectBlocked(x,match){
 const v=check(x);assert.equal(v.status,'BLOCKED');
 assert.equal(v.production_change_authorized,false);
 assert.equal(v.interface_change_authorized,false);
 assert.equal(v.core_replacement_authorized,false);
 assert.match(v.reasons.join(' '),match);
}
expectBlocked({},/invalid_frozen_model_id/);
let x=sample();x.independent_cohort.cost_stress_0_30.net_twd=-8111.78;
expectBlocked(x,/negative_after_cost/);
x=sample();x.independent_cohort.cost_stress_0_50.net_twd=-10676.80;
expectBlocked(x,/negative_after_cost/);
x=sample();x.independent_cohort.cost_stress_0_50.eod_mark_to_market_drawdown_pct=-18.5;
expectBlocked(x,/excess_equity_drawdown/);
x=sample();x.independent_cohort.cost_stress_0_50.slippage_one_side_pct=0.05;
expectBlocked(x,/insufficient_slippage/);
x=sample();x.independent_cohort.cost_stress_0_50.stock_universe_overlap_with_development=3;
expectBlocked(x,/cohort_overlap/);
x=sample();delete x.future_forward.verified_fills;expectBlocked(x,/insufficient_forward_proof/);
x=sample();x.future_forward.first_trade_signal_date='2026-10-23';expectBlocked(x,/insufficient_forward_proof/);
x=sample();x.data_dividend_errors=1;expectBlocked(x,/corporate_action_incomplete/);
x=sample();x.independent_cohort.cost_stress_0_30.net_twd=0;expectBlocked(x,/negative_after_cost/);
x=sample();const ok=check(x);
assert.equal(ok.status,'MANUAL_REVIEW_REQUIRED');
assert.equal(ok.production_change_authorized,false);
const observed=require('./vnext-growth-disjoint-2026-evidence.json');
const evidence=check(observed);
assert.equal(evidence.status,'BLOCKED');
assert.match(evidence.reasons.join(' '),/negative_after_cost/);
assert.equal(evidence.production_change_authorized,false);
console.log('PASS 12 independent stock risk/cost/forward veto tests incl. verified 2026 disjoint NO-GO; production/UI authorization always false');
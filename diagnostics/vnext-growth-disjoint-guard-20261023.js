#!/usr/bin/env node
'use strict';
// Research-only disjoint-ticker gate: NEVER writes production or authorizes deployment.
const fs = require('node:fs');
const REQUIRED = ['cost_stress_0_30', 'cost_stress_0_50'];
function check(report) {
  const fail=[];
  if(report?.model !== 'growth_pullback_0050_rise_delay2')fail.push('invalid_frozen_model_id');
  if(report?.simulator !== 'conservative_daily_ohlc_cash_limited')fail.push('simulator_not_verified');
  if(report?.purchase_limit_twd !== 5000 || report?.cash_cap_twd !== 60000 ||
    report?.exit_hard_stop_pct !== -5 || report?.exit_take_profit_pct !== 10 ||
    report?.min_commission_each_side_twd < 20)fail.push('original_cash_or_risk_rules_changed');
  if(!Number.isInteger(report?.data_verified_price_count) || report.data_verified_price_count < 95)fail.push('insufficient_disjoint_price_coverage');
  if(report?.data_dividend_errors !== 0)fail.push('corporate_action_incomplete');
  const ids=new Set();
  for(const name of REQUIRED){
    const r=report?.independent_cohort?.[name];
    if(!r||r.year!==2026||!Number.isInteger(r.trades)||r.trades<30||
      !Number.isFinite(r.net_twd)||!Number.isFinite(r.eod_mark_to_market_drawdown_pct)) {
      fail.push(name+':invalid_or_missing');continue;
    }
    if(r.stock_universe_overlap_with_development !== 0)fail.push(name+':cohort_overlap');
    if(r.net_twd<=0)fail.push(name+':negative_after_cost');
    if(r.eod_mark_to_market_drawdown_pct < -10)fail.push(name+':excess_equity_drawdown');
    if(name==='cost_stress_0_30' && !(Number.isFinite(r.slippage_one_side_pct) && r.slippage_one_side_pct>=0.30))fail.push(name+':insufficient_slippage');
    if(name==='cost_stress_0_50' && !(Number.isFinite(r.slippage_one_side_pct) && r.slippage_one_side_pct>=0.50))fail.push(name+':insufficient_slippage');
    ids.add(r.universe_id);
  }
  if(ids.size!==1||ids.has(undefined))fail.push('inconsistent_universe_id');
  const f=report?.future_forward;
  if(!f||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(String(f.first_trade_signal_date||''))||
     f.first_trade_signal_date<='2026-10-23'||!Number.isInteger(f.verified_fills)||f.verified_fills<20||
     !Number.isFinite(f.span_calendar_days)||f.span_calendar_days<90||!Number.isFinite(f.net_twd)||f.net_twd<=0)
     fail.push('insufficient_forward_proof');
  return {status:fail.length?'BLOCKED':'MANUAL_REVIEW_REQUIRED',production_change_authorized:false,
    interface_change_authorized:false,core_replacement_authorized:false,
    reasons:fail};
}
if(require.main===module){
  const path=process.argv[2];
  if(!path){console.error('usage: node diagnostics/vnext-growth-disjoint-guard-20261023.js report.json');process.exit(2)}
  try {
    const report=JSON.parse(fs.readFileSync(path,'utf8'));
    const verdict=check(report);console.log(JSON.stringify(verdict,null,2));
    if(verdict.status==='BLOCKED')process.exitCode=1;
  }catch(e){console.error(e.message);process.exitCode=2}
}
module.exports={check};
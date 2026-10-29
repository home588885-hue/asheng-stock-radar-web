import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedTwsePeak} from '../supabase/functions/asheng-holding-peak/peak-evidence.mjs';
const now=new Date('2026-10-29T12:00:00+08:00');
const quote={quote_date:'20261029',quote_time:'11:01:00',price:110,high:124,
  has_today_trade:true,price_source:'mis_last_trade',volume_lots:10800};
const holding={active:true,avg_cost:100,bought_at:'2026-10-28T10:00:00+08:00'};
const check=(q={},p={})=>verifiedTwsePeak({...quote,...q},{...holding,...p},now);
test('later-day verified MIS session high is a valid new observation',()=>{
  const r=check();assert.equal(r.ok,true);assert.equal(r.high,124);
  assert.equal(r.source,'twse_mis_daily_high_postbuy');assert.equal(r.completeHistory,false);
});
test('same purchase day can use only last trade after buy, never earlier day high',()=>{
 const r=check({}, {bought_at:'2026-10-29T10:00:00+08:00'});
 assert.equal(r.ok,true);assert.equal(r.high,110);assert.equal(r.source,'twse_mis_last_trade');
});
test('quote before purchase cannot set a high',()=>{
 assert.equal(check({},{bought_at:'2026-10-29T11:45:00+08:00'}).ok,false);
});
test('stale, missing or market-closed snapshots are never treated as today',()=>{
 assert.equal(check({quote_date:'20261028'}).ok,false);
 assert.equal(check({has_today_trade:false}).ok,false);
 assert.equal(check({volume_lots:null}).ok,false);
 assert.equal(check({price:0}).ok,false);
 assert.equal(check({price_source:'unavailable'}).ok,false);
});
test('missing daily high falls back to verified latest trade',()=>{
 assert.equal(check({high:null}).high,110);
 assert.equal(check({high:90}).high,110);
});
test('future timestamp, negative price, inactive holding rejected',()=>{
 assert.equal(check({quote_time:'15:45:00'}).ok,false);
 assert.equal(check({price:-20}).ok,false);
 assert.equal(check({},{active:false}).ok,false);
});
test('valid quote does not claim complete purchase-to-present price history',()=>{
 assert.equal(check().completeHistory,false);
});

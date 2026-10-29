import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const analyzer=source('supabase/functions/spring-swallow-analyze/index.ts');
const picks=source('supabase/functions/spring-swallow-picks/index.ts');
const version='2026-10-29-hard10-arm20-peaktrail5-v1';

test('analyze and picks use one explicit risk version',()=>{
 assert.match(analyzer,new RegExp(version));
 assert.match(picks,new RegExp(version));
 assert.doesNotMatch(analyzer,/hard5-break5-full10/);
 assert.doesNotMatch(picks,/hard5-break5-full10/);
});
test('no fixed take profit or breakeven legacy rule is returned',()=>{
 assert.doesNotMatch(analyzer,/stop_pct:-5|take_profit_full_pct:10|breakeven_arm_pct:5/);
 assert.doesNotMatch(picks,/(?:hm|h)\.stop_pct=-5|(?:hm|h)\.take_profit_full_pct=10|(?:hm|h)\.breakeven_arm_pct=5/);
 assert.match(analyzer,/take_profit_full_pct:null/);
 assert.match(picks,/take_profit_full_pct=null/);
});
test('analyzer outputs cost-independent public risk metadata and no auto trade',()=>{
 assert.match(analyzer,/stop_pct:-10/);
 assert.match(analyzer,/trailing_arm_profit_pct:20/);
 assert.match(analyzer,/trailing_retrace_from_peak_pct:5/);
 assert.match(analyzer,/trailing_peak_source:'verified_post_buy_required'/);
 assert.match(analyzer,/alert_only:true/);
 assert.match(analyzer,/add_requires_cost_validation:true/);
});
test('legacy read sanitization is not passing historical trade permissions through',()=>{
 assert.match(picks,/source_policy_version/);
 assert.match(picks,/legacy-snapshot-readonly-sanitized-for-/);
 assert.match(picks,/hm\.add_ready=false/);
 assert.match(picks,/h\.add_setup_ready=false/);
 assert.match(picks,/h\.stop_pct=-10/);
 assert.match(picks,/h\.trailing_retrace_from_peak_pct=5/);
 assert.match(picks,/h\.trailing_peak_source='verified_post_buy_required'/);
});
test('public market analyzer cannot calculate personal trailing exits',()=>{
 assert.match(analyzer,/S公用快照不含個人成本/);
 assert.match(picks,/公用S快照不具個人成本與高點/);
 assert.match(picks,/不能計算實際出場價/);
});

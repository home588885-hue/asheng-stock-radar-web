import test from 'node:test';
import assert from 'node:assert/strict';
import { ASHENG_RISK_A, evaluateHoldingRiskA, nextVerifiedPeak, acceptObservedHigh } from '../supabase/functions/_shared/asheng-holding-risk-a.mjs';

const base = {
  cost: 100, price: 110, peak: 115, peakType: 'verified_high',
  peakBasisCost: 100, boughtAt: '2026-10-01T10:00:00+08:00',
  peakBasisBoughtAt: '2026-10-01T10:00:00+08:00', peakObservedAt: '2026-10-28T13:30:00+08:00',
  quoteDate: '2026-10-29', today: '2026-10-29',
  active: true, belowMa20Closes: 0
};
const check = (overrides = {}) => evaluateHoldingRiskA({ ...base, ...overrides });
test('policy constants and no trading', () => {
  assert.equal(ASHENG_RISK_A.stopLossPct, -10);
  assert.equal(ASHENG_RISK_A.trailArmProfitPct, 20);
  assert.equal(ASHENG_RISK_A.trailFromPeakPct, 5);
  assert.equal(ASHENG_RISK_A.execution, 'alert_only_no_auto_trade');
  assert.equal(check().alertOnly, true);
});
test('hard stop: below or exactly 90% of cost', () => {
  assert.equal(check({ price: 90, peak: 110 }).action, 'stop_loss_alert');
  assert.equal(check({ price: 89, peak: 110 }).action, 'stop_loss_alert');
  assert.equal(check({ price: 90.01, peak: 110 }).action, 'hold');
});
test('do not arm before 20% gain', () => {
  const z = check({ peak: 119.99, price: 113.9 });
  assert.equal(z.action, 'hold');
  assert.equal(z.trailingArmed, false);
});
test('arm at exactly +20% and set peak minus 5%', () => {
  const z = check({ peak: 120, price: 120 });
  assert.equal(z.action, 'hold');
  assert.equal(z.trailingArmed, true);
  assert.ok(Math.abs(z.trailingLine - 114) < 1e-10);
});
test('exit alert at 5% pullback; hold above threshold', () => {
  assert.equal(check({ peak: 130, price: 123.5 }).action, 'trailing_exit_alert');
  assert.equal(check({ peak: 130, price: 123.51 }).action, 'hold');
  assert.equal(check({ peak: 150, price: 140 }).trailingLine, 142.5);
  assert.equal(check({ peak: 150, price: 140 }).action, 'trailing_exit_alert');
});
test('monotonic highest price cannot decrease', () => {
  assert.equal(nextVerifiedPeak(135, 130), 135);
  assert.equal(nextVerifiedPeak(135, 140), 140);
  assert.equal(nextVerifiedPeak(null, 110), 110);
  assert.equal(nextVerifiedPeak(150, 0), 150);
});
test('do not mix two purchases, costs or position highs', () => {
  assert.equal(check({ peakBasisBoughtAt: '2025-01-01' }).action, 'needs_peak_validation');
  assert.equal(check({ peakBasisCost: 98 }).action, 'needs_peak_validation');
  assert.equal(check({ peak: 109, price: 110 }).action, 'needs_peak_validation');
});
test('historical peak_close is not validated intraday highest', () => {
  const z = check({ peak: 130, price: 123.5, peakType: 'closing_high' });
  assert.equal(z.action, 'needs_peak_validation');
  assert.equal(z.trailingArmed, false);
});
test('do not emit alerts with stale quotes or missing price', () => {
  assert.equal(check({ quoteDate: '2026-10-28', price: 89 }).action, 'unavailable');
  assert.equal(check({ price: null }).action, 'unavailable');
  assert.equal(check({ active: false, price: 89 }).action, 'inactive');
});
test('ma20 three closes is review, stop and trailing take precedence', () => {
  assert.equal(check({ belowMa20Closes: 3 }).action, 'ma20_review');
  assert.equal(check({ belowMa20Closes: 3, price: 90 }).action, 'stop_loss_alert');
  assert.equal(check({ belowMa20Closes: 3, peak: 120, price: 114 }).action, 'trailing_exit_alert');
});
test('losing holdings never get a default add permission', () => {
  assert.equal(check({ price: 94, peak: 110 }).mayAddOnLoss, false);
  assert.equal(check({ price: 89 }).mayAddOnLoss, false);
});

test('peak below cost is a valid post-entry high in a gap-down', () => {
  const z = check({ cost:100,price:91,peak:94,peakBasisCost:100 });
  assert.equal(z.action,'hold');
  assert.equal(z.trailingArmed,false);
});
test('verified peak must be observed after purchase', () => {
  assert.equal(check({ peakObservedAt:'2026-10-01T09:00:00+08:00' }).reason,
    'peak_before_purchase_or_missing_timestamp');
  assert.equal(check({ peakObservedAt:null }).action,'needs_peak_validation');
});
test('no cross-account or post-sale historical peak mixing', () => {
  const pos={ account:'a',stockId:'2330',cost:100,
    boughtAt:'2026-10-01T10:00:00+08:00',active:true };
  const obs={ high:130,source:'verified_trade',observedAt:'2026-10-28T13:30:00+08:00' };
  const first=acceptObservedHigh(null,obs,pos);
  assert.equal(first.accepted,true);
  assert.equal(first.state.high,130);
  assert.equal(acceptObservedHigh(first.state,{...obs,high:125},pos).state.high,130);
  assert.equal(acceptObservedHigh(first.state,{...obs,high:140,observedAt:'2026-10-29T09:30:00+08:00'},pos).state.high,140);
  assert.equal(acceptObservedHigh(first.state,obs,{...pos,account:'b'}).accepted,false);
  assert.equal(acceptObservedHigh(first.state,obs,{...pos,cost:101}).accepted,false);
  assert.equal(acceptObservedHigh(first.state,{...obs,observedAt:'2026-09-30T09:30:00+08:00'},pos).accepted,false);
  assert.equal(acceptObservedHigh(first.state,{...obs,observedAt:'2026-10-01T09:00:00+08:00'},pos).accepted,false);
  assert.equal(acceptObservedHigh(first.state,{...obs,source:'unverified_cache'},pos).accepted,false);
  assert.equal(acceptObservedHigh(first.state,obs,{...pos,active:false}).accepted,false);
});

test('daily high is never presumed post-purchase on the buying date', () => {
  const position={account:'a',stockId:'2330',cost:100,active:true,
    boughtAt:'2026-10-29T11:00:00+08:00'};
  const dayHigh={high:125,marketDate:'2026-10-29',
    source:'verified_exchange_daily_high_after_buy',
    observedAt:'2026-10-29T14:00:00+08:00'};
  assert.equal(acceptObservedHigh(null,dayHigh,position).reason,
    'daily_high_not_proven_post_purchase');
  const later={...dayHigh,marketDate:'2026-10-30',
    observedAt:'2026-10-30T14:00:00+08:00'};
  assert.equal(acceptObservedHigh(null,later,position).accepted,true);
  const inconsistent={...later,marketDate:'2026-10-31'};
  assert.equal(acceptObservedHigh(null,inconsistent,position).accepted,false);
});

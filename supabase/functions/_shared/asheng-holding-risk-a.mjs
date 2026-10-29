/**
 * 阿勝正式風控 A 方案：獨立、無副作用的提醒判斷器。
 * 只做研究與驗收，不下單、不寫入資料庫、不代替正式持股決策。
 * +20%：從成本計的最高有效價啟動；啟動後從最高價回落 5% 提醒出場。
 * 初始硬停損：-10%；所有警示需要當日有效價格。
 *
 * IMPORTANT: Existing spring_swallow_holdings.peak_close is a *closing price*
 * high-watermark, NOT proven intraday high. Do not supply it as an
 * 'intraday_high' without verifying the underlying quote/transaction history.
 */
export const ASHENG_RISK_A = Object.freeze({
  version: 'risk-a-20261029-stop10-arm20-peak-trail5',
  stopLossPct: -10,
  trailArmProfitPct: 20,
  trailFromPeakPct: 5,
  execution: 'alert_only_no_auto_trade',
});

const positive = (n) => Number.isFinite(Number(n)) && Number(n) > 0;
const day = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

/**
 * @param {object} a
 * @param {number} a.cost Effective cost of THIS current holding position.
 * @param {number} a.price Latest valid trade/confirmed close, as applicable.
 * @param {number} a.peak Price high after buying, including today's verified high.
 * @param {string} a.peakType 'verified_high' or 'closing_high'.
 * @param {number} a.peakBasisCost Bound to peak's original position cost.
 * @param {string} a.boughtAt Identifies a continuous holding episode.
 * @param {string} a.peakBasisBoughtAt Must match boughtAt.
 * @param {string} a.quoteDate Exchange local YYYY-MM-DD date of observed price.
 * @param {string} a.today Exchange local YYYY-MM-DD date of decision.
 * @param {boolean} a.active Whether this episode is active.
 * @param {number} a.belowMa20Closes Confirmed consecutive closes below MA20.
 * @returns {object} No trading instruction, just an alert state and audit metadata.
 */
export function evaluateHoldingRiskA(a = {}) {
  const base = {
    policyVersion: ASHENG_RISK_A.version,
    action: 'none',  // advisory only, never an order
    alertOnly: true,
    trailingArmed: false,
    stopLine: null,
    trailingLine: null,
    peakHigh: null,
    profitPct: null,
    mayAddOnLoss: false,
    reason: null,
  };
  const result = (action, reason, ext = {}) => ({ ...base, action, reason, ...ext });
  if (a.active !== true) return result('inactive', 'inactive_or_closed_position');
  if (!positive(a.cost) || !positive(a.price)) return result('unavailable', 'invalid_cost_or_price');
  if (!day(a.today) || !day(a.quoteDate) || a.today !== a.quoteDate)
    return result('unavailable', 'missing_or_stale_quote');
  const cost = Number(a.cost), price = Number(a.price);
  const profitPct = (price / cost - 1) * 100;
  const hardStop = cost * 0.9;
  const basic = { stopLine: hardStop, profitPct };
  if (price <= hardStop + 1e-10)
    return result('stop_loss_alert', 'confirmed_price_at_or_below_minus_10pct', basic);
  if (!positive(a.peak) || !positive(a.peakBasisCost) ||
      !a.boughtAt || a.peakBasisBoughtAt !== a.boughtAt ||
      Math.abs(Number(a.peakBasisCost) - cost) > Math.max(cost * 1e-8, 0.000001))
    return result('needs_peak_validation', 'peak_missing_or_not_bound_to_current_position', basic);
  const peak = Number(a.peak);
  if (peak < price - 1e-10 || peak < cost - 1e-10)
    return result('needs_peak_validation', 'inconsistent_peak_and_current_price', basic);
  // Historical closing highs alone cannot prove intraday +20% / peak-5% transitions.
  if (a.peakType !== 'verified_high')
    return result('needs_peak_validation', 'historical_peak_is_not_verified_intraday_high', { ...basic, peakHigh: peak });
  if (peak < cost * 1.20 - 1e-10) {
    return result(Number(a.belowMa20Closes) >= 3 ? 'ma20_review' : 'hold',
      Number(a.belowMa20Closes) >= 3 ? 'three_closes_below_ma20_review' : 'trailing_not_armed',
      { ...basic, peakHigh: peak });
  }
  const line = Math.max(hardStop, peak * 0.95);
  const status = { ...basic, peakHigh: peak, trailingArmed: true, trailingLine: line };
  if (price <= line + 1e-10)
    return result('trailing_exit_alert', 'price_down_5pct_from_verified_peak', status);
  if (Number(a.belowMa20Closes) >= 3)
    return result('ma20_review', 'three_closes_below_ma20_review', status);
  return result('hold', 'protected_peak_not_breached', status);
}

/** Preserve an upward-only verified high-watermark for the same position. */
export function nextVerifiedPeak(previousPeak, currentVerifiedHigh) {
  if (!positive(currentVerifiedHigh)) return positive(previousPeak) ? Number(previousPeak) : null;
  if (!positive(previousPeak)) return Number(currentVerifiedHigh);
  return Math.max(Number(previousPeak), Number(currentVerifiedHigh));
}

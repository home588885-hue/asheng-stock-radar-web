# V5 full-universe research audit (2026-10-29)

**Status: research-only / not approved for live entry.** This branch contains a tested, read-only SQL audit. It **does not** modify main, Edge Functions, holdings, scans, schedules, fees or LINE.

## Why
Earlier exit research stored 29,040 rows, but only 165 unique (stock_id, signal_date) events over 145 symbols because many entries were different exit parameters on the same small set. In the 2025–2026 overlap, 30 selected events had 10d returns substantially above the other 11,457 signals; this is a sample-selection warning, not evidence that the stored results are fabricated.

## Source, freeze and checks
- Supabase project: `qexbtubfoyfsllaiecvv`
- Full market V5 research run: `86c2305a-3b60-493c-9ec8-2addbf754e78`, completed 2026-09-21.
- Attempted 2,142 active symbols, 1,969 processed, 173 missing/error; **historical delistings/survivorship coverage are not proven complete**.
- Source table: `public.spring_swallow_v5_research_events`; family `PULLBACK_REBREAK`.
- Research strategy: week K >=80, month K >=80, chip >=60, pullback days 3–8, depth -4 to +3%, prior 20-day volume >=500 lots, daily >=1,000 lots. This reconstructs *some* original requirements from stored features, **not a verified exact production replay**.
- Each month, take the **first date that meets all conditions** per ticker, avoiding direct repeated counting of the same stock. This is **not a complete non-overlapping portfolio simulator**.
- Discard outcomes with `r10/r20` outside [-60%,+60%] and known suspect price-event tickers: 2867,3036,3432,5314,4763,6919,2327,8422. These removals may bias results and require corporate-action-adjusted raw daily K before a deployment decision. Report sensitivity with all tickers later.
- Research periods: development 2022–2023, selection 2024, 2025/2026 retrospective checks. **2025+ have been repeatedly mined, so they are no longer an untouched holdout.**
- Source r10 is a 10-day historical return field; whether it exactly nets realistic spread/slippage, intraday order priority and the user's current exit rules is **not verified**. `mae10` is max adverse excursion, not an executed stop-loss.
- No causal proof: sector benchmark, full daily time-series adjusted for corporate actions, point-in-time weekly/financial data availability, and delisted price histories must be independently verified before live usage.

## Verified SQL result (first qualified ticker-month)
Execute `diagnostics/v5-full-universe-audit-20261029.sql` unchanged for detailed figures.

| Cohort | 2025 signals | 2025 mean r10 | 2025 win | 2026 signals | 2026 mean r10 | 2026 win | 2026 drawdown <= -8% |
|---|---:|---:|---:|---:|---:|---:|---:|
| All pullback events | 2,018 | -0.41% | 40.9% | 1,612 | +0.26% | 44.9% | 45.1% |
| Strict V5 | 68 | +2.24% | 60.3% | 81 | +2.21% | 55.6% | 46.9% |
| Strict V5 + MA20 distance <=20% | 53 | +2.35% | 58.5% | 41 | +1.89% | 56.1% | 31.7% |

Strict V5 2026 mean returns fall to +0.86% after excluding outcomes outside ±30%; 2025 reduces to +1.80%. Equal-month-weighted 2026 average is +0.90% with only 5/8 positive-mean months. The strategy is *promising* but **has not passed proof of robust net trading performance**.

## Separate production blocking finding (not changed)
As of 2026-10-28, all 424 latest `spring_swallow_scan_results` records show `metrics.trade_lifecycle.holding.stop_pct=-5` and `take_profit_full_pct=10`. The currently deployed `spring-swallow-analyze` (v55) and `spring-swallow-picks` (v73) sources also still contain `2026-10-20-hard5-break5-full10-ma5ma10-v3`. This conflicts with the requested -10% stop and +20% trailing policy. **Do not claim the new risk policy is active; do not deploy a simplistic threshold substitution for trailing logic.** Reconcile the intended trailing activation/drawdown definition and QA the entire signal/display path before deployment. Production code was not modified by this audit.

## Acceptance gates before any production change
1. Reconstruct point-in-time security universe and corporate-action-adjusted EOD data; verify feature timestamps, particularly weekly K/chip/financial data.
2. Confirm that the original V5 source features do not use future closes; enforce decision at end-of-day and execution next session, including limits, price gaps, fees, spread and slippage.
3. Freeze strategy rule and risk limits **before** collecting a new forward paper-trading cohort. Record *every* eligible signal, including rejected, missing-data, failures, and delisted outcomes.
4. Confirm risk policy at source, Supabase result, published cards and buy/add/exit prompts from one policy version. No autonomous trades or holding changes.
5. Use forward 5/10/20/30-day realized **net** returns, drawdown, win/loss, median, turnover, and cross-month robustness; compare against same-day full-market and liquidity-matched controls.
6. Require positive risk-adjusted net expectancy and adequate prospective sample coverage before authorizing a non-draft PR/merge.

**No formal buy point, holding, quota, scheduling or deployment changed.**

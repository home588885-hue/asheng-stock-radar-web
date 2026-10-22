-- 阿勝雷達 vNext 研究驗收：只讀，不會更動選股、持股、排程或正式買點
-- Version: 2026-10-22; development: 2022-2024; retrospective: 2025-2026
-- IMPORTANT: r20 = historical 20-session holding return; NOT realized trading P&L.
-- DO NOT use positive r20 alone to authorize a production trading signal.

-- (A) 目前財報覆蓋率：缺值應標為「待補資料」，絕不能自動視為不合格。
SELECT
  MAX(as_of) AS latest_model_date,
  COUNT(*) AS scanned_rows,
  COUNT(*) FILTER(WHERE metrics ? 'fundamental_blend') AS rows_with_fundamental_blend,
  COUNT(*) FILTER(WHERE metrics->'fundamental_blend'->>'revenue3m_yoy_gt20'='true') AS three_month_revenue_growth,
  COUNT(*) FILTER(WHERE metrics->'fundamental_blend'->>'gross_margin_2q_up'='true') AS gross_margin_up,
  COUNT(*) FILTER(WHERE metrics->'fundamental_blend'->>'operating_cashflow_positive'='true') AS operating_cashflow_positive,
  COUNT(*) FILTER(WHERE metrics->'fundamental_blend'->>'foreign_net_buy_10d'='true') AS foreign_10d_buy,
  COUNT(*) FILTER(WHERE metrics->'fundamental_blend'->>'all_five_confirmed'='true') AS all_five_confirmed
FROM public.spring_swallow_scan_results
WHERE as_of >= DATE '2026-10-20';

-- (B) 固定事前條件，逐年比較。2025、2026 已在研究過程接觸過，
-- 不能稱為真正未觸碰之獨立樣本外測試。
-- 異常資料只在此研究查詢暫時排除，不能更改原始資料。
WITH history AS (
  SELECT
    EXTRACT(YEAR FROM signal_date)::int AS signal_year,
    stock_id, signal_date, r10, r20, mfe10, mae10,
    revenue_yoy3m, ma60_slope5_pct, position1y, range10_pct,
    volume_lots
  FROM public.spring_swallow_v5_research_events
  WHERE family='FIRST_BREAKOUT'
    AND signal_date BETWEEN DATE '2022-01-01' AND DATE '2026-08-01'
    AND volume_lots>=1000
    AND r20 BETWEEN -40 AND 100
    AND r10 BETWEEN -30 AND 100
    AND mae10>-30 AND mfe10<100
), cases AS (
  SELECT h.*, rule.name
  FROM history AS h
  CROSS JOIN LATERAL (VALUES
    ('baseline_first_breakout', true),
    ('growth_only', revenue_yoy3m>=20),
    ('growth_60d_rising', revenue_yoy3m>=20 AND ma60_slope5_pct>0),
    ('growth_60d_rising_strong', revenue_yoy3m>=20 AND ma60_slope5_pct>0 AND position1y>=60),
    ('growth_60d_rising_strong_lower_vol',
      revenue_yoy3m>=20 AND ma60_slope5_pct>0 AND position1y>=60 AND range10_pct<=12)
  ) AS rule(name,eligible)
  WHERE rule.eligible
)
SELECT
  signal_year,
  CASE WHEN signal_year<=2024 THEN 'development_2022_2024'
       ELSE 'retrospective_known_period' END AS evidence_period,
  name AS research_variant,
  COUNT(*) AS overlapping_signals,
  COUNT(DISTINCT stock_id) AS unique_stocks,
  ROUND(AVG(r20),3) AS average_fixed_20d_return_pct,
  ROUND(AVG((r20>0)::int)*100,1) AS positive_fixed_20d_pct,
  ROUND(AVG((mae10<=-5)::int)*100,1) AS touched_minus5_in_10d_pct,
  ROUND(AVG((mfe10>=10)::int)*100,1) AS touched_plus10_in_10d_pct
FROM cases
GROUP BY signal_year,name
ORDER BY signal_year,name;

-- (C) 真正的上線門檻必須以逐日 OHLC「每一筆成交」驗證。
-- 此資料庫現有 V5 研究事件不足以重建每筆停損 / +5%保本 / +10%停利的
-- 先後順序；不能把 (B) 的價格關聯結果當成實際淨獲利。
-- 必須另外驗證 point-in-time 財報、下一交易日可成交價格、最低手續費、
-- 證交稅、滑價、每筆5000元、總資金60000元、12檔同時持有、
-- 禁止攤平、移動停利、最長30個交易日、連續三天跌破MA20規則，
-- 並提交逐筆交易明細與獨立 forward paper-trading 評估。

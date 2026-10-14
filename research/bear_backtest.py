#!/usr/bin/env python3
"""Research only: historical OHLCV-based approximation, NOT the production V5/chip model.
Fetches FinMind daily prices without user tokens. No Supabase, no production writes.
Every decision uses signal-close knowledge only; execution is the following open.
"""
import csv
import datetime as dt
import json
import math
import os
import statistics
import time
import urllib.parse
import urllib.request
from collections import defaultdict

OUT = "research"
os.makedirs(OUT, exist_ok=True)
SYMBOLS = ("1101 1102 1216 1301 1303 1402 2002 2105 2207 2301 2303 2308 "
           "2317 2327 2330 2345 2357 2379 2382 2395 2408 2454 2474 2603 "
           "2609 2615 2801 2881 2882 2883 2884 2885 2886 2891 2892 2912 "
           "3008 3034 3045 3231 3481 4904 4938 5871 5880 6505 9904").split()
# Extra balanced sample from existing stock master; chosen by industry and code,
# not by observed return. Historical delisted issuers remain under-represented.
EXTRA_SYMBOLS = ("2349 2384 1416 2390 2411 1721 1701 1704 2351 2369 "
 "2062 3557 1316 1436 3130 6165 2101 2102 1319 1338 2616 1802 "
 "1806 1707 1716 1409 2072 3708 2208 2601 2701 2702 2901 2903 "
 "2447 4994 2391 2494 1902 1903 1432 1598 2807 2006 1601 1603 "
 "2302 2347 2414 1471 1582 1503 1504 2305 1201 1203 3066 1584 "
 "1785 1742 1595 4303 2230 2596 2640 2926 5102 1565 4401 3073 "
 "2641 1259 3147 1240 3081 1593 5820 2035 2061 3224 1336 1570 "
 "1569 1264").split()
SYMBOLS = list(dict.fromkeys(SYMBOLS + EXTRA_SYMBOLS))
STRATEGIES = ("baseline","bear_confirm","bear_skip","severe_guard","reversal_entry",
              "confirm_hold_1d","confirm_break_1d","bear_confirm_hold_1d","fast_failure_exit")
PERIODS = {
    "2008_crisis": ("2008-01-01", "2008-12-31"),
    "2009_recovery": ("2009-01-01", "2009-12-31"),
    "2018_trade_war": ("2018-01-01", "2018-12-31"),
    "2019_recovery": ("2019-01-01", "2019-12-31"),
    "2020_pandemic_crash": ("2020-02-01", "2020-04-30"),
    "2020_full": ("2020-01-01", "2020-12-31"),
    "2021_bull": ("2021-01-01", "2021-12-31"),
    "2022_bear": ("2022-01-01", "2022-12-31"),
    "2023_recovery": ("2023-01-01", "2023-12-31"),
    "2024_august": ("2024-08-01", "2024-08-31"),
    "2025_mar_apr": ("2025-03-01", "2025-04-30"),
    "2025_full": ("2025-01-01", "2025-12-31"),
    "2026_to_sep": ("2026-01-01", "2026-09-01")
}
BUY_COST = .001425
SELL_COST = .004425
SOURCE = "FinMind TaiwanStockPrice"
URL = "https://api.finmindtrade.com/api/v4/data"
ERRORS = []

def fetch(sym):
    qs = urllib.parse.urlencode({
        "dataset": "TaiwanStockPrice", "data_id": sym,
        "start_date": "2007-01-01", "end_date": "2026-10-10"})
    for attempt in range(2):
        try:
            req = urllib.request.Request(URL + "?" + qs,
                headers={"Accept": "application/json", "User-Agent": "AshengHistoricalResearch/1.0"})
            with urllib.request.urlopen(req, timeout=38) as f:
                body = json.loads(f.read())
            if int(body.get("status", 0)) != 200:
                raise RuntimeError("FinMind response status " + str(body.get("status")) + " " + str(body.get("msg", ""))[:100])
            data = body.get("data", [])
            result = []
            for x in data:
                try:
                    row = {"d": str(x["date"]), "o": float(x["open"]), "h": float(x["max"]),
                           "l": float(x["min"]), "c": float(x["close"]),
                           "v": float(x.get("Trading_Volume", 0))}
                    if row["o"] > 0 and row["c"] > 0 and row["h"] >= row["l"]:
                        result.append(row)
                except (ValueError, TypeError, KeyError):
                    continue
            out = sorted({x["d"]: x for x in result}.values(), key=lambda x: x["d"])
            # Price-only normalization for verified 4-for-1 events:
            # 0050 effective 2025-06-18, 2327 effective 2025-08-25.
            # Pre-split OHLC divided by 4; share turnover stays historically raw.
            split = {"0050": ("2025-06-18", 4), "2327": ("2025-08-25", 4)}
            if sym in split:
                effective, ratio = split[sym]
                for row in out:
                    if row["d"] < effective:
                        for k in ("o", "h", "l", "c"):
                            row[k] /= ratio
            return out
        except Exception as e:
            if attempt:
                ERRORS.append({"symbol": sym, "error": str(e)[:220]})
            else:
                time.sleep(2)
    return []

def sma(c, k, i):
    if i < k-1: return None
    return sum(c[i-k+1:i+1])/k

def decorate(rows):
    c = [r["c"] for r in rows]
    for i, r in enumerate(rows):
        r["m10"] = sma(c, 10, i)
        r["m20"] = sma(c, 20, i)
        r["m60"] = sma(c, 60, i)
        r["m10p"] = sma(c, 10, i-5)
        r["m20p"] = sma(c, 20, i-5)
        r["m60p"] = sma(c, 60, i-5)
        r["c10p"] = c[i-10] if i >= 10 else None
        r["vol20"] = sum(x["v"] for x in rows[i-19:i+1])/20 if i >= 19 else None
    return rows

def candidate(rows, i):
    x, p = rows[i], rows[i-1]
    if i < 260 or i+31 >= len(rows): return False
    if not all(x.get(t) for t in ("m10", "m20", "m60", "m20p", "m60p", "vol20")):
        return False
    # Price/MA/volume proxy derived from production's core technical constraints,
    # NOT a reproduction of A/B/C/V5 or chip/financial eligibility.
    ma10p = x["m10p"]
    if ma10p is None: return False
    if not (x["m10"]>ma10p and x["m20"]>x["m20p"] and x["m60"]>x["m60p"]):
        return False
    if not x["c"]>max(x["m10"],x["m20"],x["m60"]): return False
    if x["c"]>x["m20"]*1.05: return False
    if x["v"] < 1_000_000 or x["vol20"] < 500_000: return False
    if x["v"] < x["vol20"]: return False
    if not (x["c"]>x["o"] and x["c"]>p["c"] and x["c"]/p["c"]<=1.08):
        return False
    high20 = max(r["h"] for r in rows[i-20:i])
    high20prev = max(r["h"] for r in rows[i-21:i-1])
    is_breakout = x["c"]>high20 and p["c"]<=high20prev
    is_rebound = (x["l"]<=x["m20"]*1.012
                  and x["c"]>p["h"]
                  and p["l"]<=p["m20"]*1.025 if p["m20"] else False)
    return is_breakout or is_rebound

def market_state(index, stock, i):
    b=index.get(stock[i]["d"])
    if not b or not b["m20"] or not b["m60"] or not b["m60p"] or not b["c10p"]:
        return None
    j=b["seq"]
    idxrows=index["_rows"]
    prev = idxrows[j-1] if j else None
    bear = (b["c"]<b["m60"] and b["m60"]<b["m60p"]) or (
        j>=20 and b["c"]<idxrows[j-20]["c"]*.93)
    soft_pass = False
    if j>=1 and stock[i-10]["c"]>0 and b["c10p"]>0 and prev and prev["m20"]:
        rs10=(stock[i]["c"]/stock[i-10]["c"]-1)-(b["c"]/b["c10p"]-1)
        soft_pass=(b["c"]>b["m20"] and prev["c"]>prev["m20"]
                   and rs10>=.03 and stock[i]["m20"]>stock[i]["m20p"])
    # A "severe" regime requires sustained downside or a >9% 20-session decline.
    recent5=idxrows[max(0,j-4):j+1]
    below_ma20=sum(z["m20"] is not None and z["c"]<z["m20"] for z in recent5)
    severe=bool(bear and j>=20 and (
        (below_ma20>=3 and b["c"]<b["m20"] and b["m60"]<b["m60p"])
        or b["c"] < idxrows[j-20]["c"]*.91))
    # Alternative (investigative, not a production entry): early relative-strength recovery.
    reversal=bool(bear and j>=10 and b["m10"] and b["m10p"] and
        b["c"]>=b["m10"] and b["m10"]>=b["m10p"] and
        stock[i]["m20"]>stock[i]["m20p"] and
        stock[i]["c"]>max(z["h"] for z in stock[i-5:i]) and
        (stock[i]["c"]/stock[i-10]["c"]-1)-(b["c"]/b["c10p"]-1)>=.04)
    return bool(bear), bool(soft_pass),severe,reversal

def confirm_after_one(rows, i, mode):
    # Wait for the CLOSE of the session after the original setup. Next open is earliest entry.
    # This is a different trading strategy, not look-ahead at the original signal date.
    if i + 32 >= len(rows): return False
    base, follow = rows[i], rows[i+1]
    if not follow["m20"] or not follow["m10"]: return False
    if follow["c"] > follow["m20"] * 1.05: return False
    if follow["c"] < follow["m10"] or follow["l"] < base["l"] * .97: return False
    if follow["c"] <= base["c"]: return False
    if follow["c"] < follow["o"]: return False
    if mode == "break":
        return (follow["c"] > base["h"]
                and follow["v"] >= .8 * (follow["vol20"] or 0))
    return True

def simulate(rows, i, early_failure=False):
    entry = rows[i+1]["o"]
    if entry<=0: return None
    invested = entry*(1+BUY_COST)
    realized = 0
    shares = 1.0
    partial = False
    min_equity = invested
    c_below=0
    exit_i = min(i+30,len(rows)-1)
    reason="timeout_30"
    for j in range(i+1, min(i+31,len(rows))):
        r=rows[j]
        equity=realized+shares*r["c"]
        min_equity=min(min_equity, equity)
        if j==i+30:
            realized+=shares*r["c"]*(1-SELL_COST)
            shares=0
            exit_i=j
            break
        if r["m20"] and r["c"]<r["m20"]:
            c_below+=1
        else:
            c_below=0
        act=None
        if early_failure and j <= i+3 and j+1 < len(rows) and (
            r["c"] < rows[i]["l"] and r["c"] < rows[i]["c"]*.975 and
            r["m10"] and r["c"] < r["m10"]):
            act="early_failed_breakout"
        if act is None and c_below>=3:
            act="exit_3d_below_ma20"
        elif (not partial) and r["c"]>=entry*1.20:
            act="take_20pct_one_third"
        if act and j+1 < len(rows):
            if act in ("exit_3d_below_ma20","early_failed_breakout"):
                realized+=shares*rows[j+1]["o"]*(1-SELL_COST)
                shares=0
                exit_i=j+1
                reason=act
                break
            portion=1/3
            realized+=portion*rows[j+1]["o"]*(1-SELL_COST)
            shares-=portion
            partial=True
    if shares>0:
        realized+=shares*rows[exit_i]["c"]*(1-SELL_COST)
    return {"net":round(100*(realized/invested-1),3),
            "adverse":round(100*(min_equity/invested-1),3),
            "exit_date":rows[exit_i]["d"],
            "exit_i":exit_i,"partial":partial,"exit_reason":reason}

def summarize(trades):
    if not trades: return {"n":0,"win_pct":None,"avg_net_pct":None,"med_net_pct":None,
                           "avg_adverse_pct":None,"worst_net_pct":None,"sum_unweighted_net_pct":None}
    a=[x["net"] for x in trades]
    return {"n":len(a), "win_pct":round(100*sum(y>0 for y in a)/len(a),1),
            "avg_net_pct":round(statistics.mean(a),2),
            "med_net_pct":round(statistics.median(a),2),
            "avg_adverse_pct":round(statistics.mean(x["adverse"] for x in trades),2),
            "worst_net_pct":round(min(a),2),
            "sum_unweighted_net_pct":round(sum(a),2),
            "avg_winner_pct":round(statistics.mean([v for v in a if v>0]),2) if any(v>0 for v in a) else None,
            "avg_loser_pct":round(statistics.mean([v for v in a if v<=0]),2) if any(v<=0 for v in a) else None}

def main():
    bench = decorate(fetch("0050"))
    print("Benchmark 0050 rows",len(bench), "range",
          (bench[0]["d"],bench[-1]["d"]) if bench else None,flush=True)
    if len(bench)<600:
        raise RuntimeError("No usable 0050 history; cannot make valid research comparisons.")
    index={r["d"]:{**r,"seq":i} for i,r in enumerate(bench)}
    index["_rows"]=bench
    all_trades = []
    n_data=0
    ranges={}
    eligible_bear=0
    candidates=0
    for n,sym in enumerate(SYMBOLS):
        rows=decorate(fetch(sym))
        if len(rows)<330:
            print("Skipping",sym,"rows",len(rows),flush=True)
            continue
        n_data+=1
        ranges[sym]=[rows[0]["d"],rows[-1]["d"]]
        states={st:-1 for st in STRATEGIES}
        for i in range(260,len(rows)-31):
            if not candidate(rows,i):continue
            state=market_state(index,rows,i)
            if state is None:continue
            bear,soft,severe,reversal=state
            candidates+=1
            if bear:eligible_bear+=1
            for strategy in states:
                allow=(strategy in ("baseline","confirm_hold_1d","confirm_break_1d","fast_failure_exit") or
                       (strategy=="bear_confirm" and (not bear or soft)) or
                       (strategy=="severe_guard" and (not severe or soft)) or
                       (strategy=="reversal_entry" and (not bear or soft or reversal)) or
                       (strategy=="bear_skip" and not bear) or
                       (strategy=="bear_confirm_hold_1d" and (not bear or soft or confirm_after_one(rows,i,"hold"))))
                if not allow:continue
                needs_hold=(strategy in ("confirm_hold_1d","confirm_break_1d") or
                            (strategy=="bear_confirm_hold_1d" and bear and not soft))
                if needs_hold:
                    mode="break" if strategy=="confirm_break_1d" else "hold"
                    if not confirm_after_one(rows,i,mode):continue
                actual_i=i+1 if needs_hold else i
                if actual_i<=states[strategy]+5:continue
                sim=simulate(rows,actual_i,early_failure=(strategy=="fast_failure_exit"))
                if not sim:continue
                states[strategy]=sim["exit_i"]
                all_trades.append({"symbol":sym,"signal_date":rows[i]["d"],
                   "entry_date":rows[actual_i+1]["d"],"strategy":strategy,
                   "bear_market":bear,"bear_exception":soft,
                   "severe_market":severe,"reversal_exception":reversal,**sim})
        print("Finished",n+1,"/",len(SYMBOLS),sym,"rows",len(rows),flush=True)
        time.sleep(.5)
    report={"source":SOURCE,"benchmark":"0050 ETF (TAIEX proxy, not entire TAIEX); known 2025 split price normalized",
            "split_adjustment":{"0050":{"date":"2025-06-18","ratio":4},"2327":{"date":"2025-08-25","ratio":4}},
            "sample_size_requested":len(SYMBOLS),"sample_size_available":n_data,
            "requested_from":"2007-01-01","requested_through":"2026-10-10",
            "sample_ranges":ranges,"errors":ERRORS,
            "candidate_occurrences":candidates,"bear_candidate_occurrences":eligible_bear,
            "rules":"Price/volume proxy only. MA10/20/60 rising over 5d; close above MAs and <=5% over MA20; volume>=1000 lots; avg20>=500; breakout or rebound. Includes next-open buys, next-open exits for 3 consecutive sub-MA20 closes, +20% trim one third, 30d max, 0.1425% buy and 0.4425% sell costs, no slippage. No chip/revenue/full V5. Stock sample uses surviving symbols; not all historical listings.",
            "filter_variants":{"baseline":"unmodified price-only proxy",
              "bear_confirm":"During 0050 bear regime, require 0050 above MA20 for 2 sessions, stock 10d relative strength > benchmark by 3 percentage points and stock MA20 rising; otherwise skip.",
              "bear_skip":"During 0050 bear regime, skip all entries.",
              "severe_guard":"Only add veto when sustained 0050 below MA20 plus falling MA60, or 20-session -9%; can retain original strong exception.",
              "reversal_entry":"During bear regime, allow verified relative-strength recovery above 0050 MA10, own rising MA20, 5-session high break, 10-session outperformance >4 percentage points.",
              "confirm_hold_1d":"Only enter on second following open if immediate next daily close is higher than signal close, green, holds MA10 and signal low; no >5% MA20.",
              "confirm_break_1d":"Next trading day CLOSE must exceed original signal candle high on minimum 0.8x average volume; then enter following open.",
              "bear_confirm_hold_1d":"Only in bear regime, permit original soft exception, else buy only following session after positive confirmed hold.",
              "fast_failure_exit":"Original next-open entry; if closes below original signal low by first 3 holding days and under MA10, exit next open rather than awaiting MA20 3 consecutive days."},
            "method_caveat":"Surviving and current-active code sample with listing-date bias; known splits adjusted only for 0050/2327, other corporate actions unverified. Trade-level weighted by opportunity, not portfolio-level annualized return. Split and slippage concerns remain.",
            "periods":{},"regimes":{},"cohorts":{}}
    for label,(start,end) in PERIODS.items():
        report["periods"][label]={}
        for st in STRATEGIES:
            sub=[t for t in all_trades if t["strategy"]==st and start<=t["signal_date"]<=end]
            report["periods"][label][st]=summarize(sub)
    for label,cond in (("bear",True),("other",False)):
        report["regimes"][label]={}
        for st in STRATEGIES:
            report["regimes"][label][st]=summarize(
                [t for t in all_trades if t["strategy"]==st and t["bear_market"]==cond])
    for label,start,end in (("development_2007_2022","2007-01-01","2022-12-31"),
                            ("retrospective_2023_2026","2023-01-01","2026-10-10")):
        report["cohorts"][label]={st:summarize([t for t in all_trades if t["strategy"]==st and start<=t["signal_date"]<=end]) for st in STRATEGIES}
    with open(OUT+"/bear_backtest_results.json","w") as f:
        json.dump(report,f,ensure_ascii=False,indent=2)
    with open(OUT+"/bear_backtest_trades.csv","w",newline="") as f:
        fields=("symbol","signal_date","entry_date","strategy","bear_market",
                "bear_exception","severe_market","reversal_exception",
                "net","adverse","exit_date","partial","exit_reason")
        w=csv.DictWriter(f,fieldnames=fields,extrasaction="ignore")
        w.writeheader(); w.writerows(all_trades)
    print("RESULTS",json.dumps({"availability":n_data,"bear_candidates":eligible_bear,
        "2018":report["periods"]["2018_trade_war"],
        "2020":report["periods"]["2020_pandemic_crash"],
        "2022":report["periods"]["2022_bear"],
        "2025":report["periods"]["2025_mar_apr"]},ensure_ascii=False),flush=True)

if __name__=="__main__":
    main()

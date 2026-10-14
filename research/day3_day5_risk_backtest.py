#!/usr/bin/env python3
"""Day 3/5 risk and add-on study. Price-only model; no production writes.
Identical candidate dates, fills at the NEXT trading day's open, no look-ahead.
Capital-normalized cash+shares accounting. No extra capital or leverage.
"""
import csv
import json
import statistics
import time
from collections import defaultdict
from bear_backtest import SYMBOLS, PERIODS, BUY_COST, SELL_COST, fetch, decorate, candidate, market_state

STRATEGIES = {
 "baseline_full": (1.0,"none"),
 "baseline_75cash25": (.75,"none"),
 "day3_failure_full_exit": (1.0,"d3_exit"),
 "day5_weak_half_exit": (1.0,"d5_half"),
 "day5_weak_full_exit": (1.0,"d5_exit"),
 "day3_or5_weak_risk": (1.0,"d3_d5_risk"),
 "day3_confirmed_add": (.75,"d3_add"),
 "day5_confirmed_add": (.75,"d5_add"),
 "day3_or5_confirmed_add": (.75,"d3_d5_add"),
 "day3_or5_add_plus_weak_risk": (.75,"combo"),
}
DEVELOPMENT_END="2022-12-31"
END_DATE="2026-09-01"
PERIODS2={**PERIODS,"development_2007_2022":("2007-01-01",DEVELOPMENT_END),
"retrospective_2023_2026":("2023-01-01",END_DATE)}
def strong_confirm(rows, i, day):
    j=i+day
    r=rows[j]
    # Only at the closing auction of confirmation day; shares bought next open.
    if not (r["m10"] and r["m20"] and r["m20p"] and r["vol20"]): return False
    if not (r["c"]>r["o"] and r["c"]>r["m10"] and r["c"]>r["m20"]
            and r["m20"]>r["m20p"] and r["c"]<=r["m20"]*1.05):return False
    if r["c"]<rows[i]["c"] or r["v"]<r["vol20"]*.8:return False
    if day==3:
        return r["c"]>max(t["h"] for t in rows[i:j])
    # Wait for five-day trend follow, not a new entry-classification.
    return r["c"]>max(t["h"] for t in rows[j-4:j])
def failing_at3(rows, i, initial_open):
    j=i+3;r=rows[j]
    return bool(r["m10"] and r["c"]<r["m10"] and
      (r["c"]<rows[i]["l"] or r["c"]<=initial_open*.965))
def weak_at5(rows,i,initial_open):
    j=i+5;r=rows[j];p=rows[j-1]
    return bool(r["m10"] and p["m10"] and
     r["c"]<initial_open and r["c"]<r["m10"] and p["c"]<p["m10"])
def replay(rows,i,strategy):
    initial_frac,mode=STRATEGIES[strategy]
    start=i+1;last=i+30
    if last>=len(rows):return None
    # Budget=1. Idle capital is retained as actual cash in 75/25 strategies.
    cash=1.0;shares=0.0;basis=0.0
    pending=None;partial=False;added=False;reduced=False
    below20=0;adverse=0.0;actions=[];closing_reason="day30_time_exit"
    entry=rows[start]["o"]
    if entry<=0:return None
    buy_shares=initial_frac/(entry*(1+BUY_COST))
    shares+=buy_shares
    basis+=initial_frac
    cash-=initial_frac
    actions.append("initial_buy")
    for j in range(start,last+1):
        r=rows[j]
        if j>start and pending:
            action=pending
            pending=None
            px=r["o"]
            if px<=0: return None
            if action=="add_reserved" and not added and cash>.01 and shares>0:
                amount=cash
                new_shares=amount/(px*(1+BUY_COST))
                shares+=new_shares;basis+=amount;cash-=amount
                added=True;actions.append("add_reserved")
            elif action in ("exit_full","sell_half","take_one_third") and shares>0:
                old_shares=shares
                frac=1.0 if action=="exit_full" else (.5 if action=="sell_half" else 1/3)
                sold=old_shares*frac
                shares-=sold
                cash+=sold*px*(1-SELL_COST)
                basis*=(1-frac)
                actions.append(action)
                if action=="sell_half":reduced=True
                if action=="take_one_third":partial=True
                if action=="exit_full":
                    closing_reason="risk_or_ma20_full_exit"
                    break
        # Mark-to-market against total starting capital, including reserved cash.
        adverse=min(adverse, cash+shares*r["l"]*(1-SELL_COST)-1.0)
        if j==last:
            if shares>0:
                cash+=shares*r["c"]*(1-SELL_COST)
                shares=0;basis=0
                actions.append("scheduled_day30_close")
            break
        if not shares:break
        if r["m20"] and r["c"]<r["m20"]:below20+=1
        else:below20=0
        # All assessments occur AFTER today's CLOSE and schedule next open action.
        if below20>=3:
            pending="exit_full";closing_reason="3_closes_below_ma20"
            continue
        if mode in ("d3_exit","d3_d5_risk","combo") and j==i+3:
            if failing_at3(rows,i,entry):
                pending="exit_full";closing_reason="day3_failure"
                continue
        if mode in ("d5_half","d5_exit","d3_d5_risk","combo") and j==i+5 and not reduced:
            if weak_at5(rows,i,entry):
                pending="exit_full" if mode=="d5_exit" else "sell_half"
                closing_reason="day5_weak"
                continue
        if mode in ("d3_add","d3_d5_add","combo") and j==i+3 and not added:
            if strong_confirm(rows,i,3):
                pending="add_reserved";continue
        if mode in ("d5_add","d3_d5_add","combo") and j==i+5 and not added:
            if strong_confirm(rows,i,5):
                pending="add_reserved";continue
        # Profit based on live weighted cost of the remaining shares; 20% sell third.
        avg_paid=basis/shares if shares>0 else None
        if not partial and avg_paid and r["c"]>=avg_paid*1.20:
            pending="take_one_third"
    if shares>0:
        # Fallback for anomalous early stop, sell at last close; should not occur.
        cash+=shares*rows[last]["c"]*(1-SELL_COST)
        actions.append("fallback_close")
    return {
      "net_pct":round(100*(cash-1),4),
      "worst_intrade_drawdown_pct":round(100*adverse,3),
      "add":int(added),"reduced":int(reduced),
      "entry_date":rows[start]["d"],
      "signal_date":rows[i]["d"],
      "actions":";".join(actions),
      "exit_mode":closing_reason,
    }
def stats(rows):
    vals=[x["net_pct"] for x in rows]
    if not vals:return {"n":0,"win_pct":None,"avg_net_pct":None}
    n=len(vals);wins=[x for x in vals if x>0];losers=[x for x in vals if x<=0]
    return {"n":n,
      "win_pct":round(100*len(wins)/n,1),
      "avg_net_pct":round(statistics.mean(vals),3),
      "median_net_pct":round(statistics.median(vals),3),
      "worst_trade_pct":round(min(vals),3),
      "avg_win_pct":round(statistics.mean(wins),3) if wins else None,
      "avg_loss_pct":round(statistics.mean(losers),3) if losers else None,
      "avg_worst_intrade_drawdown_pct":round(statistics.mean(x["worst_intrade_drawdown_pct"] for x in rows),3),
      "add_count":sum(x["add"] for x in rows),
      "reduced_count":sum(x["reduced"] for x in rows),
    }
def main():
    index_rows=decorate(fetch("0050"))
    if len(index_rows)<600:raise RuntimeError("No 0050 historical market data")
    index={r["d"]:{**r,"seq":i} for i,r in enumerate(index_rows)}
    index["_rows"]=index_rows
    alltrades=[];data_stocks=0;candidates=0
    for number,sym in enumerate(SYMBOLS):
        rows=decorate(fetch(sym))
        if len(rows)<360:
            print("skip",sym,len(rows),flush=True)
            continue
        data_stocks+=1;prev=-1000
        for i in range(260,len(rows)-31):
            if i-prev<31 or not candidate(rows,i):continue
            state=market_state(index,rows,i)
            if state is None:continue
            prev=i
            bear,severe=state[0],state[2]
            outcomes={k:replay(rows,i,k) for k in STRATEGIES}
            if any(v is None for v in outcomes.values()):continue
            candidates+=1
            for label,data in outcomes.items():
                alltrades.append({
                    "stock_id":sym,"strategy":label,
                    "bear":bear,"severe_bear":severe,
                    **data})
        print("processed",number+1,"/",len(SYMBOLS),sym,flush=True)
        time.sleep(.3)
    report={"requested_stock_count":len(SYMBOLS),"usable_stock_count":data_stocks,
      "same_signal_events":candidates,
      "price_source":"FinMind TaiwanStockPrice; 0050 bear proxy",
      "limits":"Technical-only proxy, not exact A/B/C/V5 and chip/revenue. Stocks sampled from current survivors; 0050/2327 known 2025 splits normalized; other corporate actions unresolved. No slippage/limit-up inability/real portfolio capital overlap, no dividends. Exact day-close observation then next-open action, capital budget=1 including idle cash. Winning trades counted if net capital return >0; partial exits 1/3 on +20% remaining position weighted book cost; 30-trading-day max.",
      "parameters":{"buy_cost":BUY_COST,"sell_cost":SELL_COST,"MA20_exit":"3 consecutive closes below MA20, next open",
        "day3_failure":"on day3, close below MA10 and either below signal low or >=3.5% under initial buy open",
        "day5_weak":"on day5, close below entry open and 2 consecutive closes below MA10; reduce half next open or exit depending on scenario",
        "day3_add":"day3 strong green, closes above MA10/MA20, MA20 slope up, less than 5% MA20 extension, >=0.8 average volume, closes above prior setup+2-day highs; next open add remaining 25% cash",
        "day5_add":"day5 green, closes above MA10/MA20, MA20 rising, <5% extension, >=0.8 avg vol, closes above four preceding days highs; next open add remaining 25% cash",
        "initial_cash_split":"baseline_full starts 100% bought; add scenario starts 75%, keeps 25% cash reserved. Compare baseline_75cash25 to added strategies for equal starting deployment."},
      "periods":{},"winners_lost":{"development_2007_2022":{},"retrospective_2023_2026":{}}}
    for label,(start,end) in PERIODS2.items():
        report["periods"][label]={}
        for strat in STRATEGIES:
            subset=[t for t in alltrades if t["strategy"]==strat and start<=t["signal_date"]<=end]
            report["periods"][label][strat]=stats(subset)
        if label in report["winners_lost"]:
            baseline={(r["stock_id"],r["signal_date"]):r for r in alltrades
                if r["strategy"]=="baseline_full" and start<=r["signal_date"]<=end}
            for strat in STRATEGIES:
                if strat=="baseline_full":continue
                rr={(r["stock_id"],r["signal_date"]):r for r in alltrades
                    if r["strategy"]==strat and start<=r["signal_date"]<=end}
                if set(rr)!=set(baseline):raise RuntimeError("different signal dates: invalid comparison")
                report["winners_lost"][label][strat]={
                    "baseline_winners_to_losers":sum(baseline[k]["net_pct"]>0 and rr[k]["net_pct"]<=0 for k in baseline),
                    "baseline_losers_to_winners":sum(baseline[k]["net_pct"]<=0 and rr[k]["net_pct"]>0 for k in baseline),
                }
    with open("research/day3_day5_risk_results.json","w") as f:
        json.dump(report,f,indent=2,ensure_ascii=False)
    fields=("stock_id","strategy","bear","severe_bear","signal_date","entry_date",
       "net_pct","worst_intrade_drawdown_pct","add","reduced","actions","exit_mode")
    with open("research/day3_day5_risk_trades.csv","w",newline="") as f:
        w=csv.DictWriter(f,fieldnames=fields)
        w.writeheader();w.writerows(alltrades)
    print("RESULTS",json.dumps({"symbols":data_stocks,"signals":candidates,
     "development":report["periods"]["development_2007_2022"],
     "retrospective":report["periods"]["retrospective_2023_2026"]},ensure_ascii=False),flush=True)
if __name__=="__main__":
    main()

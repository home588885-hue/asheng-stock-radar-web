#!/usr/bin/env python3
"""Standalone identical-entry target-winrate test (research, not production).
Dates have forward-only close observations and next-open executions.
Uses the same entry events for EVERY exit method to avoid selective denominator changes.
"""
import json
import os
import statistics
import time
from collections import defaultdict
from bear_backtest import SYMBOLS, PERIODS, BUY_COST, SELL_COST, fetch, decorate, candidate, market_state, simulate

SCENARIOS={
 "original_ma20_exit": (None,None),
 "tp3_sl8": (.03,.08),
 "tp5_sl8": (.05,.08),
 "tp8_sl10": (.08,.10),
 "tp10_sl10": (.10,.10),
 "tp3_sl12": (.03,.12),
}
def trade(rows,idx,take,stop):
 if take is None: return simulate(rows,idx)
 if idx+31 >= len(rows): return None
 buy=rows[idx+1]["o"]*(1+BUY_COST)
 baseline=rows[idx+1]["o"]
 if baseline<=0:return None
 below=0;close_i=idx+30;reason="max30"; worst=0.0
 for t in range(idx+1,idx+30):
  r=rows[t]
  worst=min(worst,r["l"]/baseline-1)
  below = below+1 if r["m20"] and r["c"]<r["m20"] else 0
  action=None
  if r["c"]/baseline-1>=take:action="profit_target"
  elif r["c"]/baseline-1<=-stop:action="fixed_stop"
  elif below>=3:action="ma20_exit"
  if action:
   close_i=t+1;reason=action;break
 exitval=rows[close_i]["o"] if close_i<idx+30 else rows[close_i]["c"]
 ret=100*((exitval*(1-SELL_COST))/buy-1)
 return {"net":round(ret,3),"exit_date":rows[close_i]["d"],"exit_reason":reason,"adverse":round(100*worst,2)}
def stats(arr):
 vals=[float(x) for x in arr]
 n=len(vals)
 if not n:return {"n":0,"win_pct":None,"mean_net_pct":None}
 w=[x for x in vals if x>0];l=[x for x in vals if x<=0]
 return {"n":n,"win_pct":round(len(w)/n*100,1),"mean_net_pct":round(statistics.mean(vals),2),
         "median_net_pct":round(statistics.median(vals),2),"worst_pct":round(min(vals),2),
         "avg_win_pct":round(statistics.mean(w),2) if w else None,
         "avg_loss_pct":round(statistics.mean(l),2) if l else None}
def main():
 bench=decorate(fetch("0050"))
 if len(bench)<300:raise RuntimeError("No 0050 OHLCV")
 index={r["d"]:{**r,"seq":i} for i,r in enumerate(bench)}
 index["_rows"]=bench
 periods={**PERIODS,"development_2007_2022":("2007-01-01","2022-12-31"),
          "retrospective_2023_2026":("2023-01-01","2026-09-01")}
 bucket=defaultdict(list)
 samples=defaultdict(int)
 stocks=0
 for ni,sym in enumerate(SYMBOLS):
  rows=decorate(fetch(sym))
  if len(rows)<350:
   print("skipped",sym,len(rows),flush=True)
   continue
  stocks+=1
  last_signal=-1000
  for i in range(260,len(rows)-31):
   if i-last_signal<31:continue
   if not candidate(rows,i):continue
   state=market_state(index,rows,i)
   if state is None:continue
   last_signal=i
   bear,severe=state[0],state[2]
   outcomes={k:trade(rows,i,*params) for k,params in SCENARIOS.items()}
   if any(v is None for v in outcomes.values()):continue
   for period,(start,end) in periods.items():
    if start<=rows[i]["d"]<=end:
     samples[period]+=1
     for key,result in outcomes.items():
      bucket[(period,key)].append(result["net"])
     if severe:
      samples[period+"_severe"]+=1
      for key,result in outcomes.items():bucket[(period+"_severe",key)].append(result["net"])
     if bear:
      samples[period+"_bear"]+=1
      for key,result in outcomes.items():bucket[(period+"_bear",key)].append(result["net"])
  print("progress",ni+1,len(SYMBOLS),sym,flush=True)
  time.sleep(.3)
 output={"source":"FinMind TaiwanStockPrice","available_stocks":stocks,
  "requested_stocks":len(SYMBOLS),
  "same_entry_events":True,
  "disclaimer":"Price-only MA10/20/60 proxy, NOT full A/B/C/V5. Selected from surviving stocks and may omit delisted. Known 2025 splits for 0050/2327 only. Cost buy .1425% sell .4425%, no slippage, no dividends, no execution limit. Entry at next open, all threshold checks only at close, execution at next open. Each stock >=31 trade day cooldown independent of exit; not a fully funded multi-position portfolio.",
  "scenarios":{k:{"take":v[0],"stop":v[1]} for k,v in SCENARIOS.items()},
  "sample_counts":dict(samples),
  "periods":{p:{k:stats(bucket[(p,k)]) for k in SCENARIOS} for p in periods},
  "criteria":{"target_win_pct":70,"prefer_positive_avg_net_pct":True,
     "min_trades_per_separate_bear_period":30,"max_tradeoff_warning":"A high win rate bought by short +3% take-profit with large stop loss is not proof of superior profitability"}}
 out="research/win70_exit_results.json"
 with open(out,"w") as f:json.dump(output,f,ensure_ascii=False,indent=2)
 print("RESULTS",json.dumps({"sample":stocks,"development":output["periods"]["development_2007_2022"],
          "retrospective":output["periods"]["retrospective_2023_2026"]},ensure_ascii=False),flush=True)
if __name__=="__main__": main()

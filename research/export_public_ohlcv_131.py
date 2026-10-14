#!/usr/bin/env python3
"""Fetch only public OHLCV for existing balanced 131-symbol historical research list.
NO Supabase, NO proprietary historical signals, NO keys, NO writes to production.
Store daily bars only in an ephemeral GitHub Actions artifact, not in Git history.
"""
import csv
import json
import os
import time
from pathlib import Path
from bear_backtest import SYMBOLS, fetch, ERRORS

DEST=Path('research/public_ohlcv_131')
DEST.mkdir(parents=True,exist_ok=True)
results=[]
for n,sym in enumerate(SYMBOLS):
    prices=fetch(sym)
    prices=[x for x in prices if "2021-01-01"<=x['d']<="2026-10-10"]
    if len(prices)>=110:
        with (DEST/(sym+".csv")).open('w',newline='') as fp:
            w=csv.writer(fp);w.writerow(["date","open","high","low","close"])
            w.writerows((r['d'],r['o'],r['h'],r['l'],r['c']) for r in prices)
    results.append({"stock_id":sym,"n":len(prices)})
    print("processed",n+1,"of",len(SYMBOLS),"bars",len(prices),flush=True)
    time.sleep(.2)
with open('research/public_ohlcv_131_meta.json','w') as fp:
    json.dump({"requested":len(SYMBOLS),"available":sum(x["n"]>=110 for x in results),
      "missing":sum(x["n"]<110 for x in results),
      "public_only":True,
      "split_note":"2357 etc raw; 0050 2327 adjusted by existing fetch function",
      "source":"FinMind TaiwanStockPrice","min_date":"2021-01-01",
      "max_date":"2026-10-10","errors":ERRORS[:20]},fp,indent=2)

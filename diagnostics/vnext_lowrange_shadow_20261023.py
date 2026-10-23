"""Offline-only risk gate for a candidate V5 strategy; NEVER returns a buy order."""
from __future__ import annotations
import math

MODEL_ID = "research_v5_growth_pullback_prior10_range_lt16_v20261023"
MAX_RANGE_PCT = 16.0

def preceding_ten_session_range_pct(bars: list[dict], signal_day: str) -> float | None:
    """Prior 10 completed sessions only. No signal-day / future price leakage."""
    if not bars: return None
    idx=next((i for i,b in enumerate(bars) if b.get("d")==signal_day),-1)
    if idx<10:return None
    sample=bars[idx-10:idx]
    if len({b.get("d") for b in sample})!=10:return None
    if any(not isinstance(b.get("h"),(int,float)) or not isinstance(b.get("l"),(int,float))
           or not math.isfinite(b["h"]) or not math.isfinite(b["l"])
           or b["l"]<=0 or b["h"]<b["l"] for b in sample):return None
    return (max(b["h"] for b in sample)/min(b["l"] for b in sample)-1)*100

def shadow_screen(*,historical_family:str,signal_day:str,bars:list[dict],
                  revenue_yoy3m:float|None,ma60_slope5_pct:float|None,
                  chip_score:float|None,volume_lots:float|None,
                  avg20_volume_lots:float|None,pullback_days:float|None,
                  pullback_depth_pct:float|None,close_location:float|None,
                  market_pass:bool)->dict:
    range10=preceding_ten_session_range_pct(bars,signal_day)
    def valid(v):return isinstance(v,(int,float)) and math.isfinite(v)
    eligible=all((
        historical_family=="PULLBACK_REBREAK",
        range10 is not None and round(range10,6)<MAX_RANGE_PCT,
        valid(revenue_yoy3m) and revenue_yoy3m>=20,
        valid(ma60_slope5_pct) and ma60_slope5_pct>0,
        valid(chip_score) and chip_score>=65,
        valid(volume_lots) and volume_lots>=1000,
        valid(avg20_volume_lots) and avg20_volume_lots>=500,
        valid(pullback_days) and 3<=pullback_days<=8,
        valid(pullback_depth_pct) and -4<=pullback_depth_pct<=3,
        valid(close_location) and close_location>=60,
        market_pass is True
    ))
    return {"model":MODEL_ID,"status":"RESEARCH_ONLY",
            "is_watch_candidate":eligible,"buy_authorized":False,
            "interface_change_authorized":False,"prior_range10_pct":range10}

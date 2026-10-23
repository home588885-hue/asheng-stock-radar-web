#!/usr/bin/env python3
"""Offline read-only prospective EOD research registry. NO TRADE, NO UI, NO PROD WRITE."""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,pathlib,sys
FREEZE='2026-10-23'
RULE_VERSION='vnext-shadow-frozen-20261023-v1'
FAMILIES=('production_baseline','v5_precision_0050','v5_growth_lowrange16')
MIN_STOCKS=100

def digest(obj):
    return hashlib.sha256(json.dumps(obj,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
def fail(message):raise ValueError(message)

def verify_snapshot(snap,as_of):
    if not isinstance(snap,dict):fail('snapshot must be object')
    if snap.get('version')!=RULE_VERSION:fail('unknown frozen policy')
    date=snap.get('as_of_date')
    if not isinstance(date,str) or len(date)!=10:fail('bad snapshot date')
    try:dateobj=dt.date.fromisoformat(date)
    except ValueError:fail('invalid snapshot date')
    if not FREEZE<date<=as_of:fail('historical, future or non-prospective date')
    if snap.get('is_complete_eod') is not True:fail('partial intraday cannot become daily signal')
    if snap.get('source')!='supabase_spring_swallow_scan_results':fail('unverified source')
    if snap.get('captured_at_utc') is None:fail('no retrieval timestamp')
    try:t=dt.datetime.fromisoformat(snap['captured_at_utc'].replace('Z','+00:00'))
    except (ValueError,AttributeError):fail('invalid retrieval timestamp')
    if t.tzinfo is None:fail('UTC timezone required')
    taipei=t.astimezone(dt.timezone(dt.timedelta(hours=8)))
    if taipei.date()!=dateobj or taipei.time()<dt.time(13,30):fail('capture before close / wrong day')
    rows=snap.get('scanned_stock_rows')
    if (not isinstance(rows,list) or len(rows)<MIN_STOCKS
        or type(snap.get('source_total_rows')) is not int or len(rows)!=snap['source_total_rows']):
        fail('incomplete universe; do not cherry-pick winners')
    seen=set()
    for r in rows:
        if not isinstance(r,dict):fail('malformed stock row')
        sym=r.get('stock_id')
        if not isinstance(sym,str) or not sym.isdecimal() or len(sym)!=4:fail('bad stock code')
        if sym in seen:fail('duplicate stock symbol')
        seen.add(sym)
        if r.get('as_of_date')!=date:fail('stock date conflicts with snapshot date')
        if r.get('scanner_version') in (None,''):fail('missing scanner version')
        s=r.get('frozen_shadow_signals')
        if not isinstance(s,dict) or tuple(sorted(s))!=tuple(sorted(FAMILIES)):
            fail('all three frozen strategies must be scored for every stock')
        if any(type(s[k]) is not bool for k in FAMILIES):fail('signals must be explicit booleans')
        if r.get('production_baseline_status') not in ('NOT_BUY','WATCH','TRIAL','FORMAL','HELD'):
            fail('missing baseline production state')
        if s['production_baseline'] and r['production_baseline_status'] not in ('TRIAL','FORMAL'):
            fail('baseline boolean contradicts production state')
    return {'date':date,'rows':len(rows),
            'signal_counts':{k:sum(r['frozen_shadow_signals'][k] for r in rows) for k in FAMILIES},
            'snapshot_sha256':digest(snap)}

def record(snapshot_path,registry_path,out_path,asof=None):
    asof=asof or dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date().isoformat()
    with open(snapshot_path,encoding='utf-8') as f:snap=json.load(f)
    meta=verify_snapshot(snap,asof)
    file=pathlib.Path(registry_path)
    lines=file.read_text(encoding='utf-8').splitlines() if file.exists() else []
    previous='GENESIS';records=[]
    for line in lines:
        row=json.loads(line)
        if not isinstance(row,dict):fail('malformed registry record')
        hashval=row.pop('chain_hash',None)
        if row.get('prev_hash')!=previous or digest(row)!=hashval:fail('registry altered or out of order')
        row['chain_hash']=hashval;previous=hashval;records.append(row)
    if records and meta['date']<=records[-1]['date']:fail('duplicate/backdated snapshot')
    entry={**meta,'prev_hash':previous,'policy':RULE_VERSION,'status':'RESEARCH_ONLY',
           'buy_authorized':False,'interface_change_authorized':False,
           'production_write_authorized':False}
    entry['chain_hash']=digest(entry)
    result={'status':'VALIDATED_NOT_COMMITTED','entry':entry,
            'registry_previous_records':len(records),
            'line_to_append':json.dumps(entry,ensure_ascii=False,sort_keys=True)}
    # Only writes the proposed validation artifact, NEVER appends a registry or changes production.
    pathlib.Path(out_path).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    return result
if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--snapshot',required=True);p.add_argument('--registry',required=True)
    p.add_argument('--output',required=True);p.add_argument('--asof',default=None);a=p.parse_args()
    try:
        r=record(a.snapshot,a.registry,a.output,a.asof)
        print(r['status'],'count',r['entry']['rows'],'PRODUCTION_UNCHANGED')
    except Exception as exc:print('BLOCKED',str(exc),file=sys.stderr);sys.exit(1)

"""Offline research only. No production API, holdings writes, or model changes.
Saved ENTRY_RADAR_PROXY signals are explicitly proxies, not original production logs.
"""
import json, pathlib, urllib.request, concurrent.futures, hashlib, time
import pandas as pd
ROOT=pathlib.Path(__file__).resolve().parent
CACHE=ROOT/'cache'; CACHE.mkdir(exist_ok=True)
OUT=ROOT/'output'; OUT.mkdir(exist_ok=True)
FEE=.001425; TAX=.003; SLIP=.001
END='2026-10-13'
def fetch(s):
 p=CACHE/(s+'.json')
 if p.exists(): return s,None
 url='https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id='+s+'&start_date=2020-01-01&end_date='+END
 try:
  with urllib.request.urlopen(url,timeout=45) as r: raw=r.read()
  j=json.loads(raw)
  if j.get('status')!=200 or not j.get('data'): raise ValueError(str(j)[:200])
  p.write_bytes(raw)
  return s,None
 except Exception as e:return s,str(e)
def prices(s):
 raw=json.loads((CACHE/(s+'.json')).read_text())['data']
 d=pd.DataFrame(raw).rename(columns={'max':'high','min':'low','Trading_Volume':'volume'}).sort_values('date').reset_index(drop=True)
 if d.date.duplicated().any():raise ValueError('duplicate daily bars')
 for x in ['open','high','low','close','volume']:d[x]=pd.to_numeric(d[x])
 valid=~((d[['open','high','low','close']]<=0).any(axis=1)) & (d.volume>0) & (d.high>=d[['open','close','low']].max(axis=1)) & (d.low<=d[['open','close','high']].min(axis=1))
 d['valid_bar']=valid
 d['valid_lookback60']=valid.rolling(60).sum()==60
 d.loc[~valid,['open','high','low','close']]=float('nan')
 for n in [10,20,60]:d['ma'+str(n)]=d.close.rolling(n).mean()
 d['vr']=d.volume/d.volume.rolling(20).mean()
 rsv=(d.close-d.low.rolling(9,min_periods=1).min())/(d.high.rolling(9,min_periods=1).max()-d.low.rolling(9,min_periods=1).min()).replace(0,float('nan'))*100
 k=z=50.;ks=[];ds=[]
 for r in rsv.fillna(50):k=(2*k+r)/3;z=(2*z+k)/3;ks.append(k);ds.append(z)
 d['k']=ks;d['d']=ds
 dif=d.close.ewm(span=12,adjust=False).mean()-d.close.ewm(span=26,adjust=False).mean()
 d['hist']=dif-dif.ewm(span=9,adjust=False).mean()
 return d
def replay(d,idx,horizon):
 entry=idx+1
 if entry>=len(d):return None,'no_next_open'
 if entry+horizon>=len(d):return None,'right_censored'
 first=d.iloc[entry]
 if 'valid_bar' in d and not first.valid_bar:return None,'invalid_entry_bar'
 units=1.;invested=first.open*(1+SLIP)*(1+FEE);cost=first.open*(1+SLIP)
 cash=-invested;adds=0;profit=False;reduced=False;under=0;pending=None;fills=[{'date':first.date,'side':'buy','units':1.,'price':first.open*(1+SLIP),'reason':'next_open_entry'}]
 # Constant reserve covers maximum two additions; equity has no external cash flows.
 reserve=first.open*(1+SLIP)*1.5*(1+FEE);peak=reserve;dd=0.;exit_reason='';sold_profit=0.;bought=1.
 for i in range(entry,entry+horizon+1):
  r=d.iloc[i];p=d.iloc[i-1]
  if 'valid_bar' in d and not r.valid_bar:return None,'invalid_bar_during_trade'
  if pending:
   side,amount,reason=pending;pending=None
   if side=='sell':
    q=units if amount==1 else units*amount;px=r.open*(1-SLIP);cash+=q*px*(1-FEE-TAX);units-=q
    fills.append({'date':r.date,'side':'sell','units':q,'price':px,'reason':reason})
    if reason=='profit20':sold_profit+=q
    if units<1e-10:exit_reason=reason
   else:
    q=.25;px=r.open*(1+SLIP);cash-=q*px*(1+FEE);invested+=q*px*(1+FEE);cost=(cost*units+q*px)/(units+q);units+=q;bought+=q;adds+=1
    fills.append({'date':r.date,'side':'buy','units':q,'price':px,'reason':reason})
  equity=reserve+cash+units*r.close*(1-SLIP)*(1-FEE-TAX)
  peak=max(peak,equity);dd=min(dd,equity/peak-1)
  if exit_reason:break
  under=under+1 if r.close<r.ma20 else 0
  ret=r.close/cost-1
  if i==entry+horizon-1:pending=('sell',1,'max_hold');continue
  if under>=3:pending=('sell',1,'ma20_three_closes');continue
  if ret<=-.08:pending=('sell',1,'hard_stop8');continue
  if ret<=-.06 and not reduced:pending=('sell',1/3,'reduce6');reduced=True;continue
  if ret>=.20 and not profit:pending=('sell',1/3,'profit20');profit=True;continue
  if profit or reduced or adds>=2:continue
  healthy=(r.close>=r.ma20 and r.close>p.close and r.close>r.open and r.k>=r.d and r['hist']>=p['hist'] and r.close/r.ma20-1<=.05 and (r.high-r.close)/(r.high-r.low or 1)<=.4)
  ma10=p.low<=p.ma10 and p.close>=p.ma10 and r.close>=r.ma10
  ma20=p.low<=p.ma20 and p.close>=p.ma20
  reclaim=p.close<p.ma20 and r.close>=r.ma20
  if healthy and (ma10 or ma20 or reclaim):pending=('buy',.25,'ma20_reclaim' if reclaim else 'ma20_hold' if ma20 else 'ma10_hold')
 if not exit_reason:raise AssertionError('position not closed')
 return {'entry_date':first.date,'exit_date':r.date,'net_return_pct':cash/invested*100,'pnl_per_initial_share':cash,'invested_per_initial_share':invested,'max_drawdown_pct':dd*100,'add_count':adds,'profit_taken':profit,'profit_sold_fraction':sold_profit/bought,'exit_reason':exit_reason,'holding_bars':i-entry,'fills':fills},None
def main():
 events=json.loads((ROOT/'input/signals.json').read_text());symbols=sorted({e['stock_id'] for e in events})
 features={(e['stock_id'],e['signal_date']):e for e in json.loads((ROOT/'input/chips.json').read_text())}
 failures=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:
  for n,(s,error) in enumerate(ex.map(fetch,symbols),1):
   if error:failures.append({'stock_id':s,'error':error})
   if n%10==0:print('price downloads',n,'/',len(symbols),'failures',len(failures),flush=True)
 (OUT/'download_failures.json').write_text(json.dumps(failures,ensure_ascii=False,indent=2))
 trades=[];excluded=[];checks=[]
 for s in symbols:
  if not (CACHE/(s+'.json')).exists():continue
  try:d=prices(s)
  except Exception as e:excluded.append({'stock_id':s,'reason':str(e)});continue
  index={x:i for i,x in enumerate(d.date)}
  checks.append({'stock_id':s,'bars':len(d),'invalid_bars':int((~d.valid_bar).sum()),'first':d.iloc[0].date,'last':d.iloc[-1].date,'sha256':hashlib.sha256((CACHE/(s+'.json')).read_bytes()).hexdigest()})
  # Only proxy entry signals: do not call other stages production buy signals.
  ev=sorted([e for e in events if e['stock_id']==s and e['signal_type']=='ENTRY_RADAR_PROXY'],key=lambda e:e['signal_date'])
  for h in [20,30]:
   for model in ['baseline_proxy','volume_lt2.5_ma60_up_proxy','volume_lt2.5_only','ma60_up_only','chip_known_baseline','chip_ge70','inst_known_baseline','inst_net5_positive','margin_known_baseline','margin_change5_nonpositive','upper_wick_le30pct','launch_origin_overlap']:
    last_exit=''
    for e in ev:
     date=e['signal_date'];ix=index.get(date)
     if ix is None:excluded.append({'stock_id':s,'signal_date':date,'horizon':h,'model':model,'reason':'missing_signal_bar'});continue
     if date<=last_exit:continue
     r=d.iloc[ix]
     if not r.valid_lookback60:excluded.append({'stock_id':s,'signal_date':date,'horizon':h,'model':model,'reason':'invalid_bar_in_signal_lookback60'});continue
     ma_up=r.ma60>d.iloc[max(0,ix-5)].ma60
     if model=='volume_lt2.5_ma60_up_proxy' and not (r.vr<2.5 and ma_up):continue
     if model=='volume_lt2.5_only' and not r.vr<2.5:continue
     if model=='ma60_up_only' and not ma_up:continue
     ft=features.get((s,date),{})
     if model in ['chip_known_baseline','chip_ge70'] and ft.get('chip_score') is None:continue
     if model=='chip_ge70' and ft['chip_score']<70:continue
     if model in ['inst_known_baseline','inst_net5_positive'] and ft.get('inst_net5') is None:continue
     if model=='inst_net5_positive' and ft['inst_net5']<=0:continue
     if model in ['margin_known_baseline','margin_change5_nonpositive'] and ft.get('margin_change5') is None:continue
     if model=='margin_change5_nonpositive' and ft['margin_change5']>0:continue
     if model=='upper_wick_le30pct' and (r.high-max(r.close,r.open))/(r.high-r.low or 1)>.30:continue
     if model=='launch_origin_overlap' and not any(x['stock_id']==s and x['signal_date']==date and x['signal_type']=='LAUNCH_ORIGIN' for x in events):continue
     if ix+1>=len(d) or d.iloc[ix+1].date!=e['entry_date'] or abs(d.iloc[ix+1].open-float(e['entry_price']))>.011:
      excluded.append({'stock_id':s,'signal_date':date,'horizon':h,'model':model,'reason':'saved_entry_reconciliation_failed'});continue
     t,err=replay(d,ix,h)
     if err:excluded.append({'stock_id':s,'signal_date':date,'horizon':h,'model':model,'reason':err});continue
     t.update(stock_id=s,signal_date=date,year=int(date[:4]),model=model,horizon=h,signal_volume_ratio=float(r.vr),signal_ma60_slope5_pct=float(r.ma60/d.iloc[ix-5].ma60-1)*100)
     trades.append(t);last_exit=t['exit_date']
 flat=pd.DataFrame([{k:v for k,v in t.items() if k!='fills'} for t in trades])
 flat.to_csv(OUT/'trades.csv',index=False)
 (OUT/'trades_with_fills.json').write_text(json.dumps(trades,ensure_ascii=False,indent=2))
 fills=[dict(stock_id=t['stock_id'],signal_date=t['signal_date'],model=t['model'],horizon=t['horizon'],**f) for t in trades for f in t['fills']]
 pd.DataFrame(fills).to_csv(OUT/'fills.csv',index=False)
 summary=[]
 if len(flat):
  for keys,g in flat.groupby(['model','horizon','year']):
   summary.append(dict(zip(['model','horizon','year'],keys),n=len(g),mean_net_pct=g.net_return_pct.mean(),win_pct=(g.net_return_pct>0).mean()*100,worst_trade_drawdown_pct=g.max_drawdown_pct.min(),add_count=int(g.add_count.sum()),profit_trade_pct=g.profit_taken.mean()*100,mean_profit_sold_pct=g.profit_sold_fraction.mean()*100))
 pd.DataFrame(summary).to_csv(OUT/'yearly_summary.csv',index=False)
 (OUT/'excluded.json').write_text(json.dumps(excluded,ensure_ascii=False,indent=2))
 (OUT/'price_manifest.json').write_text(json.dumps(checks,indent=2))
 print(pd.DataFrame(summary).to_string(index=False),flush=True)
 print('trades',len(trades),'excluded',len(excluded),'download_failures',len(failures),flush=True)
if __name__=='__main__':main()

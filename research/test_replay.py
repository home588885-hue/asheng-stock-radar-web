import unittest
import pandas as pd
from replay import replay,FEE,TAX,SLIP
def bars():
 d=pd.DataFrame({'date':pd.bdate_range('2024-01-01',periods=80).strftime('%Y-%m-%d'),'open':100.,'close':100.,'high':101.,'low':99.,'volume':1000000.,'ma10':100.,'ma20':100.,'ma60':99.,'k':50.,'d':50.,'hist':0.})
 return d
class ReplayTests(unittest.TestCase):
 def test_costs_and_max_hold(self):
  d=bars();t,e=replay(d,10,20)
  expected=(100*(1-SLIP)*(1-FEE-TAX)-100*(1+SLIP)*(1+FEE))/(100*(1+SLIP)*(1+FEE))*100
  self.assertAlmostEqual(t['net_return_pct'],expected);self.assertEqual(t['holding_bars'],20);self.assertEqual(t['exit_date'],d.iloc[31].date)
 def test_ma20_three_closes_and_next_open_gap(self):
  d=bars();d.loc[11:13,'ma20']=105.;d.loc[14,'open']=90.
  t,e=replay(d,10,30);self.assertEqual(t['exit_reason'],'ma20_three_closes');self.assertEqual(t['exit_date'],d.iloc[14].date);self.assertEqual(t['fills'][-1]['price'],90*(1-SLIP))
 def test_one_third_profit_next_open(self):
  d=bars();d.loc[12:,'close']=125.;d.loc[12:,'open']=125.;d.loc[12:,'high']=126.;d.loc[12:,'low']=124.
  t,e=replay(d,10,20);f=[x for x in t['fills'] if x['reason']=='profit20'];self.assertEqual(len(f),1);self.assertAlmostEqual(f[0]['units'],1/3);self.assertEqual(f[0]['date'],d.iloc[13].date)
 def test_add_then_stop(self):
  d=bars();d.loc[12,['open','close','high','low']]=[100.,102.,103.,100.];d.loc[13,'open']=103.;d.loc[14,'close']=90.
  t,e=replay(d,10,20);self.assertGreaterEqual(t['add_count'],1);self.assertLessEqual(t['add_count'],2);self.assertEqual(t['exit_reason'],'hard_stop8')
 def test_future_changes_do_not_change_earlier_fills(self):
  d=bars();d.loc[12,['open','close','high','low']]=[100.,102.,103.,100.];a,_=replay(d,10,20);d.loc[20:,'close']=150.;b,_=replay(d,10,20)
  self.assertEqual([f for f in a['fills'] if f['date']<d.iloc[20].date],[f for f in b['fills'] if f['date']<d.iloc[20].date])
 def test_incomplete_positions_excluded(self):
  t,e=replay(bars().iloc[:25],10,30);self.assertIsNone(t);self.assertEqual(e,'right_censored')
if __name__=='__main__':unittest.main()

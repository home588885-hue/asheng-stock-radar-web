import unittest
from vnext_lowrange_shadow_20261023 import preceding_ten_session_range_pct,shadow_screen

class ShadowGuardTests(unittest.TestCase):
    def setUp(self):
        self.bars=[{"d":f"202610{i:02d}","h":101,"l":100} for i in range(1,11)]
        self.bars.extend([{"d":"20261011","h":220,"l":80},
                          {"d":"20261012","h":900,"l":50}])
        self.kw=dict(historical_family="PULLBACK_REBREAK",signal_day="20261011",
             bars=self.bars,revenue_yoy3m=25,ma60_slope5_pct=2,
             chip_score=77,volume_lots=1500,avg20_volume_lots=700,
             pullback_days=4,pullback_depth_pct=-1.2,close_location=80,
             market_pass=True)
    def test_01_only_prior_sessions(self):
        a=preceding_ten_session_range_pct(self.bars,"20261011")
        self.assertAlmostEqual(a,1.0)
        self.assertAlmostEqual(a,preceding_ten_session_range_pct(self.bars[:11],"20261011"))
    def test_02_missing_prices_never_pass(self):
        self.assertIsNone(preceding_ten_session_range_pct(self.bars[:9],"20261011"))
        self.assertIsNone(preceding_ten_session_range_pct(self.bars,"20260930"))
    def test_03_bad_prices_never_pass(self):
        b=[dict(x) for x in self.bars];b[2]["l"]=0
        self.assertIsNone(preceding_ten_session_range_pct(b,"20261011"))
    def test_04_cannot_authorize_buy(self):
        r=shadow_screen(**self.kw)
        self.assertTrue(r["is_watch_candidate"])
        self.assertFalse(r["buy_authorized"])
        self.assertFalse(r["interface_change_authorized"])
    def test_05_missing_revenue(self):
        self.assertFalse(shadow_screen(**dict(self.kw,revenue_yoy3m=None))["is_watch_candidate"])
    def test_06_unknown_market(self):
        self.assertFalse(shadow_screen(**dict(self.kw,market_pass=None))["is_watch_candidate"])
    def test_07_at_exact_boundary_rejected(self):
        b=[dict(x) for x in self.bars];b[1]["h"]=116
        self.assertFalse(shadow_screen(**dict(self.kw,bars=b))["is_watch_candidate"])

if __name__=="__main__":unittest.main()

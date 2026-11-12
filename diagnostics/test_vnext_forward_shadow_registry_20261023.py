import json,pathlib,tempfile,unittest
from vnext_forward_shadow_registry_20261023 import FREEZE,RULE_VERSION,FAMILIES,verify_snapshot,record
def sample(date='2026-11-02'):
    return {'version':RULE_VERSION,'as_of_date':date,'is_complete_eod':True,
            'source':'supabase_spring_swallow_scan_results','source_total_rows':300,
            'captured_at_utc':date+'T06:00:00Z',
            'scanned_stock_rows':[dict(stock_id=f'{1100+i}',as_of_date=date,scanner_version='v5',
                production_baseline_status='WATCH',
                frozen_shadow_signals={k:False for k in FAMILIES}) for i in range(300)]}
class TestCase(unittest.TestCase):
    def blocked(self,s,asof='2026-11-02'):
        with self.assertRaises(ValueError):verify_snapshot(s,asof)
    def test_01_forward_complete(self):
        self.assertEqual(verify_snapshot(sample(),'2026-11-02')['rows'],300)
    def test_02_past(self):self.blocked(sample(FREEZE))
    def test_03_future(self):self.blocked(sample('2026-11-04'))
    def test_04_partial(self):
        s=sample();s['is_complete_eod']=False;self.blocked(s)
    def test_05_cherrypick(self):
        s=sample();s['scanned_stock_rows']=s['scanned_stock_rows'][:4];self.blocked(s)
    def test_06_wrong_count(self):
        s=sample();s['source_total_rows']=150;self.blocked(s)
    def test_07_duplicate_stock(self):
        s=sample();s['scanned_stock_rows'][2]['stock_id']=s['scanned_stock_rows'][1]['stock_id'];self.blocked(s)
    def test_08_changed_rule(self):
        s=sample();s['version']='modified_after_winners';self.blocked(s)
    def test_09_too_early(self):
        s=sample();s['captured_at_utc']='2026-11-02T04:30:00Z';self.blocked(s)
    def test_10_missing_strategy(self):
        s=sample();del s['scanned_stock_rows'][0]['frozen_shadow_signals']['v5_growth_lowrange16'];self.blocked(s)
    def test_11_baseline_conflict(self):
        s=sample();s['scanned_stock_rows'][0]['frozen_shadow_signals']['production_baseline']=True;self.blocked(s)
    def test_12_hash_chain_and_no_write(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d);p=root/'snap.json';log=root/'ledger.ndjson';out=root/'out.json'
            p.write_text(json.dumps(sample()),encoding='utf-8')
            first=record(p,log,out,'2026-11-02')
            self.assertFalse(log.exists())
            self.assertFalse(first['entry']['buy_authorized'])
            self.assertFalse(first['entry']['production_write_authorized'])
            log.write_text(first['line_to_append']+'\n',encoding='utf-8')
            p.write_text(json.dumps(sample('2026-11-03')),encoding='utf-8')
            second=record(p,log,out,'2026-11-03')
            self.assertEqual(second['registry_previous_records'],1)
            log.write_text(log.read_text()+second['line_to_append']+'\n',encoding='utf-8')
            with self.assertRaises(ValueError):record(p,log,out,'2026-11-03')
            log.write_text(log.read_text().replace('RESEARCH_ONLY','FORGED'),encoding='utf-8')
            with self.assertRaises(ValueError):record(p,log,out,'2026-11-03')
if __name__=='__main__':unittest.main()

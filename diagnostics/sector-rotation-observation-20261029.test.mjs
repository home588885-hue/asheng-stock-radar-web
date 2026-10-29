import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {buildSectorRotation,taipeiDate} from '../supabase/functions/asheng-sector-rotation/rotation-score.mjs';

const date='2026-10-28',now=new Date('2026-10-29T10:30:00+08:00');
const sample=(stock_id,industry,close,prev_close,ratio=1.4)=>({
 stock_id,industry,as_of:date,close,prev_close,
 current_volume_lots:1400,avg_volume_20_lots:1400/ratio
});
const universe=[
 ...Array.from({length:10},(_,i)=>sample('S'+i,'強勢測試',110,100,1.6)),
 ...Array.from({length:10},(_,i)=>sample('W'+i,'弱勢測試',95,100,1.2)),
 ...Array.from({length:4},(_,i)=>sample('L'+i,'少數樣本',110,100,1.6))
];
test('Taiwan day is exchange local, not UTC',()=>{
 assert.equal(taipeiDate(new Date('2026-10-28T23:45:00Z')),'2026-10-29');
});
test('strong/weak labels are sector sample comparisons, not cash flow',()=>{
 const result=buildSectorRotation(universe,date,now);
 const by=new Map(result.sectors.map(x=>[x.industry,x]));
 assert.equal(result.live,false);
 assert.equal(result.is_net_inflow,false);
 assert.equal(result.scope,'subset_of_EOD_scans_not_full_market');
 assert.equal(result.as_of,date);
 assert.equal(result.total_valid_samples,24);
 assert.equal(result.stale,false);
 assert.equal(by.get('強勢測試').kind,'strong');
 assert.equal(by.get('弱勢測試').kind,'weak');
 assert.equal(by.get('少數樣本').kind,'insufficient');
 assert.ok(by.get('強勢測試').relative_to_scan_pct>0);
 assert.equal(by.get('強勢測試').sample_count,10);
 assert.equal(by.get('強勢測試').up_pct,100);
});
test('older than three days cannot emit a strong sector',()=>{
 const r=buildSectorRotation(universe,date,new Date('2026-11-04T10:00:00+08:00'));
 assert.equal(r.stale,true);
 assert.ok(r.sectors.every(x=>x.kind==='insufficient'));
});
test('truncation, future dates and missing quotes suppress ranking',()=>{
 const truncated=buildSectorRotation(universe,date,now,true);
 assert.equal(truncated.source_truncated,true);
 assert.ok(truncated.sectors.every(x=>x.kind==='insufficient'));
 const future=buildSectorRotation(universe,'2026-10-30',now);
 assert.equal(future.stale,true);
 const corrupted=buildSectorRotation([...universe,
   sample('BAD','強勢測試',100,0),
   sample('BAD2','強勢測試',100000,100),
   {...universe[0],stock_id:'S0',close:9999}
 ],date,now);
 assert.equal(corrupted.total_valid_samples,24);
});
test('sector endpoint is server-only aggregated EOD and read-only',()=>{
 const src=readFileSync(new URL('../supabase/functions/asheng-sector-rotation/index.ts',import.meta.url),'utf8');
 assert.match(src,/req\.method!=='GET'/);
 assert.match(src,/auth\.auth\.getUser\(\)/);
 assert.match(src,/error:'unauthorized'/);
 assert.match(src,/SUPABASE_ANON_KEY/);
 assert.match(src,/\.eq\('as_of',asOf\)/);
 assert.match(src,/order\('as_of',\{ascending:false\}\)/);
 assert.match(src,/source:'|caveat:/);
 assert.match(src,/latest\[0\]\.as_of/);
 assert.doesNotMatch(src,/\.insert\(|\.update\(|\.delete\(|rpc\(|scan-bridge|FinMind/);
});
test('UI only observes sector source, without touching action criteria or paid scans',()=>{
 const html=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
 assert.match(html,/const SECTOR_ROTATION_API = SHARED_DATA_HUB \+ '\/asheng-sector-rotation'/);
 assert.match(html,/data-sector-industry/);
 assert.match(html,/subset_of_EOD_scans_not_full_market/);
 assert.match(html,/data\.is_net_inflow===false/);
 assert.match(html,/mode=intraday/);
 assert.match(html,/subset_of_verified_current_trade_not_full_market/);
 assert.match(html,/shown\.stale===true/);
 assert.match(html,/fallback\?\.scope!=='subset_of_EOD_scans_not_full_market'/);
 assert.match(html,/sectorRotationLastCheckAt<300000/);
 assert.match(html,/void refreshSectorRotationObservation\(\)/);
 assert.match(html,/Authorization:'Bearer '\+memberSession\.access_token/);
 assert.match(html,/authClient\.auth\.getSession\(\)/);
 const opening=html.lastIndexOf('<script',html.indexOf('(async()=>{',html.indexOf('const SUPABASE_URL')));
 const begin=html.indexOf('>',opening)+1;
 const end=html.indexOf('</script>',begin);
 assert.ok(begin>0&&end>begin);
 assert.doesNotThrow(()=>new vm.Script(html.slice(begin,end),{filename:'admin-sector.js'}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,firstSafeTuesday,tdccSnapshots,alignEvents,summarize} from './tdcc-holder-flow.mjs';

const dates=['2026-07-03','2026-07-10','2026-07-17','2026-07-24','2026-07-31'];
const csv=(date,bump,code='2330')=>
  '資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%\n'
  +[[12,50+bump*5],[13,20],[14,10],[15,120+bump*8],[17,1000]]
  .map(([grade,shares])=>date.replaceAll('-','')+','+code+'  ,'+grade+',1,'+shares+','+(shares/10)).join('\n')+'\n';
const files=dates.map((d,i)=>({name:d+'.csv',csv:csv(d,i)}));

test('CSV BOM and quoted fields are parsed; malformed quote rejected',()=>{
  assert.deepEqual(parseCSV('\uFEFFa,b\n"hello,hi",x\n'),[{a:'hello,hi',b:'x'}]);
  assert.throws(()=>parseCSV('a,b\n"unfinished,x\n'),/quoting/);
});
test('grade ranges are >400 lots and >1000 lots, excluding special grades 16/17',()=>{
  const x=tdccSnapshots([files[0]])[0];
  assert.equal(x.large400_pct,20);
  assert.equal(x.large1000_pct,12);
  assert.equal(x.as_of,'2026-07-03');
});
test('TDCC first safe session is following Tuesday, never Friday same day',()=>{
  assert.equal(firstSafeTuesday('2026-07-03'),'2026-07-07');
  assert.equal(firstSafeTuesday('2026-10-22'),'2026-10-27');
  assert.equal(firstSafeTuesday('2026-07-07'),'2026-07-14');
});
test('sequential increases require two real consecutive weeks',()=>{
  const s=tdccSnapshots(files);
  assert.equal(s[0].two_week400_up,false);
  assert.equal(s[1].two_week400_up,false);
  assert.equal(s[2].two_week400_up,true);
  assert.equal(s[2].two_week1000_up,true);
  assert.equal(s[4].four_week400_change_pp,5.2);
});
test('timepoint as-of join avoids same-week future leakage',()=>{
  const s=tdccSnapshots(files);
  const e=[
    {stock_id:'2330',signal_date:'2026-07-20',family:'FIRST_BREAKOUT',r10:'2.0',mae10:'-2'},
    {stock_id:'2330',signal_date:'2026-07-21',family:'FIRST_BREAKOUT',r10:'1.0',mae10:'-3'},
    {stock_id:'2330',signal_date:'2026-08-31',family:'FIRST_BREAKOUT',r10:'10.0'},
  ];
  const a=alignEvents(e,s);
  assert.equal(a[0].tdcc.as_of,'2026-07-10');
  assert.equal(a[0].tdcc.two_week400_up,false);
  assert.equal(a[1].tdcc.as_of,'2026-07-17');
  assert.equal(a[1].tdcc.two_week400_up,true);
  assert.equal(a[2].tdcc,null);
  const stat=summarize(a);
  assert.equal(stat.find(x=>x.group==='原策略').n,2);
  assert.equal(stat.find(x=>x.group==='400張以上連增2週').n,1);
});
test('duplicated grade with conflicting historical data is rejected',()=>{
  assert.throws(()=>tdccSnapshots([{name:'a.csv',csv:csv('2026-07-03',0)+
    '20260703,2330,12,1,999,99.9\n'}]),/Conflicting/);
});
test('a multiweek gap never fakes a two-week continuous holding trend',()=>{
  const spaced=[files[0],files[1],files[4]];
  const s=tdccSnapshots(spaced);
  assert.equal(s[2].two_week400_up,false);
});
test('research summary does not reclassify a trading signal',()=>{
  const s=tdccSnapshots(files),a=alignEvents([
    {stock_id:'2330',signal_date:'2026-07-21',family:'PULLBACK_REBREAK',r10:'2',mae10:'-3',
      chip_score:'66',inst_net5:'10',inst_pos_days:'3'},
  ],s),r=summarize(a);
  assert.equal(r.some(x=>x.group==='400張連增＋法人代理'),true);
  assert.equal(r.every(x=>x.research_only===true),true);
  assert.equal(a[0].trialable,undefined);
});

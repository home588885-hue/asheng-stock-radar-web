import test from 'node:test';
import assert from 'node:assert/strict';
import {comparableTurnoverShift,relativeRotation} from './sector-rotation-independent-research.mjs';

const day1='2026-10-27',day2='2026-10-28';
const a=[],b=[];
for(let i=0;i<12;i++){
 a.push({stock_id:'A'+i,industry:'A',date:day1,close:100,volume_lots:100});
 b.push({stock_id:'A'+i,industry:'A',date:day2,close:100,volume_lots:150});
 a.push({stock_id:'B'+i,industry:'B',date:day1,close:100,volume_lots:100});
 b.push({stock_id:'B'+i,industry:'B',date:day2,close:100,volume_lots:50});
}
test('turnover-share gain/loss sum to approximately zero, not net institutional purchases',()=>{
 const q=comparableTurnoverShift(a,b,day1,day2,{minOverall:20,minGroup:8});
 assert.equal(q.ok,true);
 assert.equal(q.flow_type,'relative_turnover_share_shift_pp_not_net_buying');
 assert.equal(q.comparable_count,24);
 const x=q.groups.find(x=>x.industry==='A');
 const y=q.groups.find(x=>x.industry==='B');
 assert.equal(x.turnover_share_shift_pp,25);
 assert.equal(y.turnover_share_shift_pp,-25);
 assert.equal(x.status,'share_gaining');
 assert.equal(y.status,'share_losing');
 assert.equal(+q.groups.reduce((s,x)=>s+x.turnover_share_shift_pp,0).toFixed(3),0);
});
test('different cohort, missing source or duplicate ticker do not create fabricated flow',()=>{
 const poor=comparableTurnoverShift(a,b.slice(0,12),day1,day2,{minOverall:10,minCoverage:.9});
 assert.equal(poor.ok,false);
 assert.equal(poor.reason,'noncomparable_or_low_coverage');
 const dup=comparableTurnoverShift([...a,a[0]],b,day1,day2,{minOverall:20,minCoverage:.99});
 assert.equal(dup.ok,false);
 const invalid=comparableTurnoverShift(a,b,day2,day1);
 assert.equal(invalid.ok,false);
});
test('outlier adjusted-event candidate excluded by matching screen',()=>{
 const x=[...b.slice(0,-1),{...b.at(-1),close:200}];
 const q=comparableTurnoverShift(a,x,day1,day2,{minOverall:20,minCoverage:.90});
 assert.equal(q.ok,true);
 assert.equal(q.comparable_count,23);
});
function series(change){
 const base=Date.parse('2026-01-02T00:00:00Z');
 return Array.from({length:65},(_,i)=>({
   date:new Date(base+i*86400000).toISOString().slice(0,10),
   sector_index:100*Math.pow(change,i),market_index:100
 }));
}
test('50/10 session relative rotation identifies rising and falling research cohorts',()=>{
 const leading=relativeRotation(series(1.01));
 const lagging=relativeRotation(series(.99));
 assert.equal(leading.ok,true);
 assert.equal(leading.quadrant,'leading');
 assert.ok(leading.relative_strength>100);
 assert.ok(leading.relative_momentum>100);
 assert.equal(lagging.ok,true);
 assert.equal(lagging.quadrant,'lagging');
});
test('historical index length, duplicate time stamps and zero prices cannot yield quadrants',()=>{
 assert.equal(relativeRotation(series(1.01).slice(0,50)).ok,false);
 const dup=series(1.01);
 dup[40].date=dup[39].date;
 assert.equal(relativeRotation(dup).reason,'missing_unadjusted_or_duplicate_session');
 const zero=series(1.01);
 zero[20].market_index=0;
 assert.equal(relativeRotation(zero).ok,false);
});

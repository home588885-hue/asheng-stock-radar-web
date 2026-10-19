'use strict';
const fs=require('node:fs');
const assert=require('node:assert/strict');
const html=fs.readFileSync('admin.html','utf8');
const a=html.indexOf('        const researchGroups=[');
const b=html.indexOf('        const actionableCount=',a);
assert.ok(a>0&&b>a,'ENTRY night research display source must be present');
const code=html.slice(a,b);
const escape=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const make=(id,score,gap,opts={})=>({
 item:{stock_id:id,stock_name:opts.name||'範例'+id,as_of:opts.day||'2026-10-19',score,
   metrics:{close:100+gap,ma20:100,ma10:100,ma60:99,current_volume_lots:opts.volume??1500,
     shanchuan_v2:{mother_child:{lifecycle:{state:opts.mother||'tracking'}}},
     entry_candle_guard:{weak_after_breakout:false},holding_management:{strong_breakdown:false}}},
 action:{text:opts.warning||'🔴 暫不進場',detail:'模型風險'}}
);
const research=(options={})=>{
 const variables=['eodTrialRows','boxFirstRows','reclaimRows','focusRows','signalRows',
   'eodTrackRows','queuedDisplayRows','waitRows','avoidRows','pullbackRows','holdings',
   'expected','unifiedRadarGeneration','expectedSignalDataDate','esc','num','rows'];
 const values=[
  options.trials||[],[],[],options.focus||[],[],[],[],[],options.blocked||[],options.high||[],
  new Map(options.held||[]),'2026-10-19',x=>x.item?x.item.new_model!==false:x.new_model!==false,
  ()=>'2026-10-19',escape,(x,n)=>Number(x).toFixed(n),options.rows||[]];
 return new Function(...variables,code+'\nreturn {researchPreview,topResearch,riskStudy};')(...values);
};
const safe=make('1111',83,1.4),old=make('2222',97,0.2,{day:'2026-10-16'});
const inflated=make('3333',91,8.6),veto=make('4444',86,0.1,{mother:'mother_low_broken'});
const thin=make('5555',85,0.1,{volume:400});
const r=research({focus:[old,safe,veto,thin,inflated]});
assert.equal(r.topResearch.length,1);
assert.equal(r.topResearch[0].item.stock_id,'1111');
assert.match(r.researchPreview,/1111/);
assert.doesNotMatch(r.researchPreview,/2222|3333|4444|5555/);
assert.match(r.researchPreview,/非買點/);
assert.match(r.researchPreview,/有效 C 成交/);
const none=research({blocked:[veto],high:[inflated],rows:[veto,inflated]});
assert.equal(none.topResearch.length,0,'No risk example can be promoted to a trial');
assert.match(none.researchPreview,/沒有可準備試單/);
assert.match(none.researchPreview,/今晚可先研究的風控案例/);
assert.match(none.researchPreview,/4444/);
assert.match(none.researchPreview,/3333/);
assert.match(none.researchPreview,/暫不進場/);
assert.match(none.researchPreview,/母子K低點跌破/);
const noModel=research({blocked:[old]});
assert.doesNotMatch(noModel.researchPreview,/2222/);
assert.equal(research({focus:[safe],held:[['1111',{}]]}).topResearch.length,0,'Held stocks are not new buy ideas');
assert.match(html,/const outHtml=banner\+researchPreview\+simplifiedEntryHtml/);
assert.doesNotMatch(code,/fetch\(|savePullbackWatchRows\(|scanBatch|refreshLiveQuotes\(/);
console.log('PASS tonight research shortlist: signed latest V2, no chase/low volume/broken K, no holdings, explicit risk-only fallback');

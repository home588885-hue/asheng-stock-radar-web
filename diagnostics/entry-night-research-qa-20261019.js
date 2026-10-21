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
   'expected','unifiedRadarGeneration','expectedSignalDataDate','esc','num','rows','v5MonitorCard'];
 const values=[
  options.trials||[],[],[],options.focus||[],[],[],[],[],options.blocked||[],options.high||[],
  new Map(options.held||[]),'2026-10-19',x=>x.item?x.item.new_model!==false:x.new_model!==false,
  ()=>'2026-10-19',escape,(x,n)=>Number(x).toFixed(n),options.rows||[],
  (item,quote,action)=>'<div class="card complete-stock-card" data-complete-stock="'+escape(item.stock_id)
    +'" data-trialable="'+String(action.trialable===true)+'" data-buyable="'+String(action.buyable===true)
    +'">新版完整卡片｜山川、MA、量價、風控</div>'];
 const runtime=[
   "const overnightRiskIds=new Set([...avoidRows,...pullbackRows].map(r=>String(r.item?.stock_id||'')));",
   "const strongRebreakStudyRank=()=>0;",
   "const chaseOver=(item,price)=>(price/Number(item.metrics?.ma20)-1)*100>12;",
   "const chaseLimitNote=()=>'+12%';",
   "const overnightLifecycleState=item=>({key:'first',label:'🌱 整理等待突破｜非買點',tomorrow:'等前高與量價確認',firstSignal:'',gap:0});",
   "const bestTodayQuote=()=>null;",
   "const quoteDisplayState=()=>({label:'S 完整日K',today_trade:false,moment:''});",
   "const validTodayQuote=()=>false;",
   "const continuationRiskMiniHtml=()=>'';",
   "const radarShortAdvice=()=> '確認量價與支撐';",
   "const stockMovementHtml=()=>'';",
   "const radarDeepDetailsHtml=x=>x;",
   "const retainedRows=[];",
   "const overnightPassiveResearch=[];",
   "const passiveRadarWatchEligible=()=>false;",
   "const passiveWatchDescription=()=>({label:'觀察',detail:'非買點'});"
 ].join('\n');
 return new Function(...variables,runtime+'\n'+code+'\nreturn {researchPreview,topResearch,riskStudy};')(...values);
};
const safe=make('1111',83,1.4),old=make('2222',97,0.2,{day:'2026-10-16'});
const inflated=make('3333',91,14.6),veto=make('4444',86,0.1,{mother:'mother_low_broken'});
const thin=make('5555',85,0.1,{volume:400});
const r=research({focus:[old,safe,veto,thin,inflated]});
assert.equal(r.topResearch.length,1);
assert.equal(r.topResearch[0].item.stock_id,'1111');
assert.match(r.researchPreview,/1111/);
assert.doesNotMatch(r.researchPreview,/2222|3333|4444|5555/);
assert.match(r.researchPreview,/非買點/);
assert.match(r.researchPreview,/C有效成交/);
assert.match(r.researchPreview,/<details class="entry-research-stock entry-research-details"/);
assert.match(r.researchPreview,/data-research-kind="watch"/);
assert.match(r.researchPreview,/data-complete-stock="1111"/);
assert.match(r.researchPreview,/展開/);
assert.match(r.researchPreview,/data-trialable="false"/);
assert.match(r.researchPreview,/data-buyable="false"/);
const none=research({blocked:[veto],high:[inflated],rows:[veto,inflated]});
assert.equal(none.topResearch.length,0,'No risk example can be promoted to a trial');
assert.match(none.researchPreview,/本輪沒有達到低乖離準備條件/);
assert.match(none.researchPreview,/今晚可先研究的風控案例/);
assert.match(none.researchPreview,/4444/);
assert.match(none.researchPreview,/3333/);
assert.match(none.researchPreview,/暫不進場/);
assert.match(none.researchPreview,/母子K低點跌破/);
assert.match(none.researchPreview,/data-research-kind="blocked"/);
assert.match(none.researchPreview,/data-complete-stock="4444"/);
assert.match(none.researchPreview,/data-complete-stock="3333"/);
assert.ok((none.researchPreview.match(/class="card complete-stock-card"/g)||[]).length===2);
assert.ok(!none.researchPreview.includes('data-trialable="true"'));
assert.ok(!none.researchPreview.includes('data-buyable="true"'));
assert.match(html,/const expanded=v5MonitorCard\(item, q, safeDisplayAction\)/);
assert.match(html,/v5MonitorCard\(item,null,studyAction\)/);
assert.match(html,/\.entry-research-stock>\.entry-research-summary/);
const noModel=research({blocked:[old]});
assert.doesNotMatch(noModel.researchPreview,/2222/);
assert.equal(research({focus:[safe],held:[['1111',{}]]}).topResearch.length,0,'Held stocks are not new buy ideas');
assert.match(html,/const outHtml=banner\+researchPreview\+simplifiedEntryHtml/);
assert.doesNotMatch(code,/fetch\(|savePullbackWatchRows\(|scanBatch|refreshLiveQuotes\(/);
if(process.env.XC_EXPORT_RESEARCH_PREVIEW==='1'){
 const styleStart=html.indexOf('<style>'),styleEnd=html.indexOf('</style>',styleStart+7);
 const css=styleStart>=0&&styleEnd>styleStart?html.slice(styleStart+7,styleEnd):'';
 fs.writeFileSync('diagnostics/night-research-fixture-20261019.html',
   '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
   +'<style>'+css+'</style></head><body><main class="wrap">'
   +r.researchPreview+none.researchPreview+'</main></body></html>');
 console.log('PASS synthetic full-stock research fixture export');
}
console.log('PASS tonight research shortlist: signed latest V2, no chase/low volume/broken K, no holdings, explicit risk-only fallback');

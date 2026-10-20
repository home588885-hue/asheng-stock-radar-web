'use strict';
// Run from a checkout: node diagnostics/radar-regression-gates.js
// Read-only, zero network calls, no C/S scans, no schedules or portfolio mutations.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
const entry=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
let passed=0;
function test(label,fn){fn();passed++;console.log('PASS '+label);}
function section(first,last){
  const i=html.indexOf(first),j=html.indexOf(last,i+first.length);
  assert.ok(i>=0&&j>i,'Missing source boundaries: '+first+' / '+last);
  return html.slice(i,j);
}
const locked='2026-10-06-ma10-20-60-v1';
const generation='shanchuan-independent-v2';
const discovery='2026-10-16-shanchuan-independent-v2';
const mk=(date,gen=generation)=>({
  stock_id:'3062',as_of:date,
  metrics:{chase_rule_version:'2026-10-20-bias-8-12-15-v1',chase_risk:{version:'2026-10-20-bias-8-12-15-v1'},box_strategy:{model_generation:gen,discovery:{version:discovery,as_of:date}},
    shanchuan_v2:{mother_child:{lifecycle:{state:'none'}}}}
});
const exactNew=item=>item?.metrics?.box_strategy?.model_generation===generation
  &&item?.metrics?.box_strategy?.discovery?.version===discovery
  &&String(item?.metrics?.box_strategy?.discovery?.as_of||'')===String(item?.as_of||'')
  &&item?.metrics?.shanchuan_v2?.mother_child?.lifecycle!=null;
const expected=()=> '2026-10-19';
const recent=new Function('unifiedRadarGeneration','chaseModelReady','expectedSignalDataDate',
  section('      const recentModelForDisplay=item=>{','      const displayModelWarning=')+
  '\nreturn recentModelForDisplay;')(exactNew,item=>item?.metrics?.chase_rule_version==='2026-10-20-bias-8-12-15-v1' && item?.metrics?.chase_risk?.version==='2026-10-20-bias-8-12-15-v1',expected);

test('Model-day rollover keeps Friday signed v2 only as observation',()=>{
  assert.equal(recent(mk('2026-10-16')),true);
  assert.equal(recent(mk('2026-10-19')),true);
  assert.equal(recent(mk('2026-10-13')),false);
  assert.equal(recent(mk('2026-10-20')),false);
});
test('Unsigned old chase snapshots are never current buy models',()=>{
  const item=mk('2026-10-19');delete item.metrics.chase_rule_version;
  assert.equal(recent(item),false);
});
test('Legacy Shan-Chuan or incomplete v2 never counts as a new model',()=>{
  assert.equal(recent(mk('2026-10-16','old')),false);
  const mismatch=mk('2026-10-16');mismatch.metrics.box_strategy.discovery.as_of='2026-10-15';
  assert.equal(recent(mismatch),false);
  const incomplete=mk('2026-10-16');delete incomplete.metrics.shanchuan_v2.mother_child.lifecycle;
  assert.equal(recent(incomplete),false);
});
const mem=new Map();
const localStorage={getItem:k=>mem.get(k)||null,setItem:(k,v)=>mem.set(k,v),removeItem:k=>mem.delete(k)};
const lock=d=>d?.rule_version===locked&&d.rule_locked===true;
const key='asheng-launch-data-v3-unified-shanchuan';
const readLaunch=new Function('localStorage','isLockedRulePayload','recentModelForDisplay','LAUNCH_DATA_CACHE_KEY',
  section('      const readLaunchDataCache = () => {','      const writeLaunchDataCache = data => {')+
  '\nreturn readLaunchDataCache;')(localStorage,lock,recent,key);
const writeLaunch=new Function('localStorage','isLockedRulePayload','recentModelForDisplay','LAUNCH_DATA_CACHE_KEY',
  section('      const writeLaunchDataCache = data => {','      const ENTRY_POOL_CACHE_KEY =')+
  '\nreturn writeLaunchDataCache;')(localStorage,lock,recent,key);
const response=picks=>({ok:true,rule_version:locked,rule_locked:true,
  quality_screen:'2026-10-16-unified-shanchuan-generation-v3',
  candidate_generation:generation,picks});
test('Mixed API result caches only complete latest v2, never stale/legacy',()=>{
  writeLaunch(response([mk('2026-10-16'),mk('2026-10-16','old'),mk('2026-10-13')]));
  assert.equal(readLaunch().picks.length,1);
  assert.equal(readLaunch().picks[0].stock_id,'3062');
});
test('Transient empty API cannot erase latest verified cache',()=>{
  const before=mem.get(key);
  writeLaunch(response([]));
  assert.equal(mem.get(key),before);
  const saved=JSON.parse(mem.get(key));saved.saved_at=Date.now()-4*86400000;
  mem.set(key,JSON.stringify(saved));assert.equal(readLaunch().picks.length,1);
  saved.saved_at=Date.now()-6*86400000;
  mem.set(key,JSON.stringify(saved));assert.equal(readLaunch(),null);
});
test('Same guarded cache retention applies to ENTRY without destructive reset',()=>{
  const entry=section('      const readEntryPoolCache = () => {','      const ENTRY_QUOTE_REFRESH_MS =');
  assert.match(entry,/5 \* 86400000/);
  assert.match(entry,/filter\(recentModelForDisplay\)/);
  assert.doesNotMatch(html,/localStorage\.removeItem\(ENTRY_POOL_CACHE_KEY\)/);
  assert.match(html,/nextPool=readEntryPoolCache\(\)\.filter/);
});
test('Each trading page uses one current route, not old parallel entry branches',()=>{
  assert.match(html,/if\(stage==='ENTRY'\|\|stage==='LIVE'\)return loadLiveMonitor\(\)/);
  assert.match(html,/if\(stage==='HOLDING'\)return loadHoldingCards\(\)/);
  assert.match(html,/const launchPicks = \(launchData\.picks \|\| \[\]\)\.filter\(recentModelForDisplay\)|let launchPicks = \(launchData\.picks \|\| \[\]\)\.filter\(recentModelForDisplay\)/);
  assert.match(entry,/url=\.\/admin\.html/);
});
test('Latest trading K still required for orange trial and formal buy',()=>{
  assert.match(html,/const eligible=fresh&&String\(item\?\.as_of\|\|''\)===expectedSignalDataDate\(\)/);
  assert.match(html,/const completedRows=byRank\(/);
  assert.match(html,/formalEntryValidation\.enabled&&quoteFreshForTrial\(row\.quote\)/);
  assert.match(html,/const recentModelForDisplay=item=>/);
  assert.match(html,/const simplifiedEntryHtml = \(labels=\{\}\) =>/);
  assert.match(html,/const groupedEntrySavedWatches = visibleIds =>/);
  assert.match(html,/compactEntryGroupHtml\('today'/);
  assert.match(html,/compactEntryGroupHtml\('tracking'/);
  assert.match(html,/compactEntryGroupHtml\('risk'/);
  assert.match(html,/compactEntryGroupHtml\('history'/);
  assert.doesNotMatch(section('      const renderEntrySections =','      const isEntryRadarItem ='),/entryBucketHtml\('/);
});
test('Cross-day pending follows database, stays expanded, does not fake buy',()=>{
  assert.match(html,/data-entry-fold="watch-pending" open/);
  assert.match(html,/entry-bucket-simple-history/);
  assert.match(html,/📌 跨日追蹤紀錄/);
  assert.match(html,/pending\?'⚪ 追蹤紀錄保留/);
  assert.match(html,/不算風控淘汰/);
});
test('New-generation ENTRY keeps the authenticated cross-day shelf on both source outages and exceptions',()=>{
  const block=section('      async function loadLiveMonitor() {','      async function searchStock() {');
  assert.match(block,/if \(!v5Data && !launchData\)\s*\{[\s\S]*?await loadPullbackWatchItems\(\)/);
  assert.match(block,/simplifiedEntryHtml\(\)/);
  assert.match(block,/groupedEntrySavedWatches\(new Set\(\)\)/);
  assert.match(block,/if \(stage === 'ENTRY'\) \{[\s\S]*?await loadPullbackWatchItems\(\)/);
  assert.match(html,/const portfolioId = memberSession\.user\.id|let portfolioId = memberSession\.user\.id/);
  assert.match(html,/const unifiedRadarGeneration=item=>/);
  assert.match(html,/return b\.model_generation==='shanchuan-independent-v2'/);
  assert.match(html,/data-entry-fold="watch-pending" open/);
  assert.match(html,/const readEntryPoolCache = \(\) =>/);
  assert.doesNotMatch(block,/spring-swallow-scan-batch/);
});
test('All three zones use Cloudflare C, 3-minute ticker, no old HTML cache',()=>{
  assert.match(html,/const fetchLiveQuoteChunk = async symbols/);
  assert.match(html,/const quoteRecentForDisplay = quote =>/);
  assert.match(html,/const greenDipObservation=\(item,quote=null\)/);
  assert.match(html,/holdingQuoteRefreshMs:\s*180000/);
  assert.match(html,/if \(stage !== 'LAUNCH'/);
  assert.match(html,/async function refreshLiveQuotes\(\)/);
  assert.match(sw,/cache:'no-store'/);
  assert.doesNotMatch(sw,/caches\.open\(/);
});
test('New +8/+12/+15 chase tiers pass precise BIAS boundaries, never fake a missing quote',()=>{
  const source=section('      const CHASE_RULE_VERSION=', '      const isLockedRulePayload =');
  const {chaseTier,chaseRisk,chasePass,chaseOver}=new Function(source+
    '\nreturn {chaseTier,chaseRisk,chasePass,chaseOver};')();
  const sample=(id,bias,tier)=>({stock_id:id,metrics:{
    close:100+bias,ma20:100,...(tier?{verified_cap_tier:tier}:{})}});
  for(const [id,tier,limit] of [['2330',null,8],['1605',null,12],
      ['6229','small_spike',15]]){
    assert.equal(chaseTier(sample(id,0,tier)).limit,limit);
    assert.equal(chasePass(sample(id,limit,tier)),true);
    assert.equal(chasePass(sample(id,limit+0.01,tier)),false);
    assert.equal(chaseOver(sample(id,limit+0.01,tier)),true);
  }
  assert.equal(chasePass({stock_id:'1605',metrics:{close:112,ma20:0}}),false);
  assert.equal(chasePass({stock_id:'1605',metrics:{close:0,ma20:100}}),false);
  assert.match(html,/const eligible=fresh&&String\(item\?\.as_of\|\|''\)===expectedSignalDataDate\(\)/);
  assert.match(html,/&&masOkay&&chasePass\(item,price\)/);
  assert.match(html,/const high=\(Number\.isFinite\(pos\)/);
  assert.match(html,/chaseOver\(item,price\)/);
  assert.match(html,/chasePass\(item,close\)/);
  assert.match(html,/chasePass\(item,p\)/);
  assert.doesNotMatch(html,/新進場5%上限|隔天以原本5%乖離|距 MA20 超過 5%/);
  assert.match(html,/selectionMas: Object.freeze\(\['MA10','MA20','MA60'\]\)/);
});
for(const g of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=/.test(g[1]))continue;
  new Function(g[2]);
}
console.log('PASS inline JavaScript syntax');
console.log('Radar regression gates: '+passed+' groups passed; 0 network calls.');

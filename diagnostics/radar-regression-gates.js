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
  assert.match(html,/const quoteFreshForTrial = quote =>/);
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
  assert.match(html,/const ma10StarterLiveTrial = \(item,quote,eligible\) =>/);
  assert.doesNotMatch(html,/新進場5%上限|隔天以原本5%乖離|距 MA20 超過 5%/);
  assert.match(html,/selectionMas: Object.freeze\(\['MA10','MA20','MA60'\]\)/);
});
test('Three zones and saved cross-day stocks have individual expandable movement cards',()=>{
  const launch=section('      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml =');
  const entryStock=section('      const entryCompactStock = (row, bucketLabel) => {','      const entryBucketHtml=');
  const holding=section('      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =');
  const saved=section('      const groupedEntrySavedWatches = visibleIds => {','      const simplifiedEntryHtml =');
  assert.match(launch,/details class="entry-mini" data-stock-key/);
  assert.match(launch,/stockMovementHtml\(item,q,'launch'/);
  assert.match(entryStock,/details class="entry-mini" data-stock-key/);
  assert.match(entryStock,/stockMovementHtml\(item,q,'entry'/);
  assert.match(holding,/details class="holding-mini" data-stock-key/);
  assert.match(holding,/holdingMa20DaysHtml\(item,live\)/);
  assert.match(holding,/card\(item,\{quote:safeQuote,hideHoldingControls:true,technicalOnly:true\}\)/);
  assert.match(saved,/details class="entry-mini entry-saved-mini" data-stock-key/);
  assert.match(saved,/stockMovementHtml\(item,q,'entry'/);
  assert.match(html,/const entryExpandedIds = new Set\(\)/);
  assert.match(html,/entryExpandedIds\.add\(id\)/);
  assert.match(html,/holdingExpandedIds\.add\(id\)/);
  assert.match(html,/launchExpandedIds\.add\(id\)/);
  assert.match(html,/\.stock-motion .stock-motion-status/);
  assert.match(html,/@media\(max-width:640px\)\{[\s\S]*?\.stock-motion/);
});
test('Movement cards only display S or already-valid C trades and never grant a buy',()=>{
  const src=section('      const stockMovementHtml = ', '      // UI-only folding. The holdings Map remains verified by the server.');
  assert.doesNotMatch(src,/\bfetch\s*\(|getLiveQuotes\s*\(|\bsetInterval\s*\(/);
  const fn=new Function('bestTodayQuote','validTodayQuote','quoteRecentForDisplay','volumePriceState',
    'chaseModelReady','unifiedRadarGeneration','overnightLifecycleState','chaseLimitNote','esc','num','radarShortAdvice','continuationRiskFullHtml','quoteDisplayState',
    src+'\nreturn stockMovementHtml;')(
    q=>q,q=>!!q&&q.has_today_trade===true&&q.price>0,q=>q.fresh===true,
    ()=>({tag:'🟢 量價改善',volumeRatio:1.2}),
    x=>x?.metrics?.chase_rule_version==='2026-10-20-bias-8-12-15-v1',
    ()=>true,()=>({label:'底部整理',tomorrow:'等量價轉強'}),()=>'+12%',
    x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    (x,d=1)=>Number(x).toFixed(d),(item,action)=>action?.detail||'觀察量價',()=> '',q=>({label:q?'C 今日前次成交（非即時）':'S 完整日K收盤（非即時）',moment:'2026/10/20 13:30',live:false}));
  const item={stock_id:'1605',as_of:'2026-10-19',metrics:{
    chase_rule_version:'2026-10-20-bias-8-12-15-v1',close:100,prev_close:98,
    current_volume_lots:1100,ma10:99,ma20:97,ma60:95}};
  const saved=fn(item,null,'launch',{text:'🌱 發動前',detail:'等突破'});
  assert.match(saved,/S 完整日K收盤（非即時）/);
  assert.match(saved,/100\.00/);
  assert.match(saved,/等突破/);
  assert.doesNotMatch(saved,/C 今日即時成交/);
  const live=fn(item,{has_today_trade:true,price:103,prev_close:100,volume_lots:1800,
    quote_time:'10:30:00',fresh:false},'entry',{text:'🟡 等回踩',detail:'觀察MA20'});
  assert.match(live,/C 今日前次成交（非即時）/);
  assert.match(live,/103\.00/);
  assert.match(live,/觀察MA20/);
  const legacy={...item,metrics:{...item.metrics,chase_rule_version:'old'}};
  assert.match(fn(legacy,null,'entry',{}),/舊版模型待補算/);
  assert.match(fn(item,null,'entry',{phase:'confirmed',buyable:false,text:'🟢 正式買點'}),/目前不可直接買/);
  assert.match(fn(item,null,'entry',{phase:'trial',trialable:false,text:'🟠 可小量試單'}),/目前非買點/);
});

test('Launch, entry and tomorrow cards are brief when closed, compact when open, detailed only on demand',()=>{
  const launch=section('      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml =');
  const entryCard=section('      const entryCompactStock = (row, bucketLabel) => {','      const entryBucketHtml=');
  const research=section('        const researchCard=info=>{','        // One stock per evening research panel.');
  const retained=section('      const groupedEntrySavedWatches = visibleIds => {','      const simplifiedEntryHtml =');
  const movement=section('      const stockMovementHtml = ', '      // UI-only folding. The holdings Map remains verified by the server.');
  const wrap=section('      const radarDeepDetailsHtml=', '      // Shared stock movement panel.');
  assert.match(launch,/entry-mini-summary radar-compact-summary/);
  assert.match(entryCard,/entry-mini-summary radar-compact-summary/);
  assert.match(research,/entry-research-summary radar-compact-summary/);
  assert.match(retained,/entry-mini-summary radar-compact-summary/);
  assert.match(retained,/radarDeepDetailsHtml\(detail\)/);
  assert.match(launch,/radarDeepDetailsHtml\(/);
  assert.match(entryCard,/radarDeepDetailsHtml\(v5MonitorCard/);
  assert.match(html,/radarDeepDetailsHtml\(v5MonitorCard\(item,validatedQuote,studyAction\)\)/);
  assert.match(wrap,/details class="radar-deep-dive"/);
  assert.match(movement,/stock-motion-compact/);
  assert.doesNotMatch(movement,/20日前高/);
  assert.doesNotMatch(movement,/量比 \+/);
  assert.doesNotMatch(entryCard,/<span class="entry-mini-score">/);
  assert.doesNotMatch(launch,/<span class="entry-mini-score">/);
  assert.doesNotMatch(research,/'分數 '/);
  assert.match(html,/\.radar-compact-summary/);
  // User's previously approved holdings layout is outside these refactors.
  const holding=section('      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =');
  assert.match(holding,/holdingMini-stats|holding-mini-stats/);
  assert.match(holding,/holdingMa20DaysHtml\(item,live\)/);
});
test('Signed saved and research watch stocks share existing C quote batch',()=>{
  const follow=section('      const entryQuoteFollowups = () => {','      const bestTodayQuote =');
  const saved=section('      const groupedEntrySavedWatches = visibleIds => {','      const simplifiedEntryHtml =');
  const live=section('      async function refreshLiveQuotes() {','      const loadEntrySourcePair =');
  const f=new Function('stage','holdings','overnightPassiveResearch','passiveRadarWatchEligible',
    'pullbackWatch','pullbackWatchSnapshots','unifiedRadarGeneration',follow+'return entryQuoteFollowups;');
  const list=f('ENTRY',new Map(),[{stock_id:'3062',signed:true}],()=>true,
    new Map([['4960',{stock_id:'4960',active:true}],['6925',{stock_id:'6925',active:false}]]),
    new Map([['4960',{stock_id:'4960',signed:true}],['6925',{stock_id:'6925',signed:true}]]),x=>x?.signed===true)();
  assert.deepEqual(list.map(x=>x.stock_id),['3062','4960']);
  assert.match(live,/\.\.\.liveBasePicks,\.\.\.entryQuoteFollowups\(\)/);
  assert.match(live,/extras\.length&&marketBridgeReady\(\)&&cQuoteReadWindow\(\)/);
  assert.match(saved,/bestTodayQuote\(null,id\)/);
  assert.match(saved,/stockMovementHtml\(item,q,'entry'/);
  assert.match(saved,/quoteDisplayState\(q,item\)/);
  assert.match(saved,/s.label/);
  assert.doesNotMatch(follow,/\bfetch\s*\(|setInterval\s*\(/);
});
test('Tomorrow watchlist reuses valid C quotes in summary and expanded data',()=>{
  const expanded=section('        const researchExpandedCard = (row,blocked=false) => {','        const riskStudyHtml=');
  const compact=section('        const researchCard=info=>{','        // One stock per evening research panel.');
  assert.match(expanded,/bestTodayQuote\(row\?\.quote,String\(item\.stock_id\|\|''\)\)/);
  assert.match(expanded,/stockMovementHtml\(item,validatedQuote,'entry',studyAction\)/);
  assert.match(expanded,/v5MonitorCard\(item,validatedQuote,studyAction\)/);
  assert.match(compact,/bestTodayQuote\(info\.row\?\.quote,id\)/);
  assert.match(compact,/quoteDisplayState\(live,item\)/);
  assert.match(compact,/s.label/);
  assert.match(compact,/s.moment/);
  assert.match(compact,/close>0/);
  assert.doesNotMatch(expanded+compact,/\bfetch\s*\(|getLiveQuotes\s*\(|\bsetInterval\s*\(/);
});
test('Tomorrow watchlist does not repeat 4960 and 6925 in passive tracking',()=>{
  const part=section('        const dedupeEveningResearch=(candidateRows,alreadyShown=[])=>{',
    '        const primaryResearchRows=[');
  const dedupe=new Function('const dedupeEveningResearch=(candidateRows,alreadyShown=[])=>{'
    +part.split('const dedupeEveningResearch=(candidateRows,alreadyShown=[])=>{')[1]
    +'return dedupeEveningResearch;')();
  const stock=id=>({item:{stock_id:id}});
  const existing=[stock('4960'),stock('6925')];
  const supplementary=[stock('4960'),stock('6925'),stock('3062'),stock('3062'),stock('1319')];
  const result=dedupe(supplementary,existing).map(row=>row.item.stock_id);
  assert.deepEqual(result,['3062','1319']);
  assert.match(html,/const primaryResearchRows=\[/);
  assert.match(html,/\.values\(\)\],primaryResearchRows\)\.slice\(0,8\)/);
  // Same stock still appears in primary "已發動等回踩" and is not deleted
  // from the source model or persistent tracking.
  assert.match(html,/const strongFollowups=rows\.filter/);
  assert.match(html,/const passiveResearch=dedupeEveningResearch/);
});
test('3062 and 4960 track support/overextension without a fabricated buy',()=>{
  const source=section('      const passiveRadarWatchEligible=item=>{','      const displayModelWarning=item=>');
  const held=new Map();
  const {passiveRadarWatchEligible:eligible,passiveWatchDescription:describe}=
    new Function('unifiedRadarGeneration','expectedSignalDataDate','holdings','num','chaseLimitNote','bestTodayQuote','validTodayQuote',
      source+'\nreturn {passiveRadarWatchEligible,passiveWatchDescription};')(
      ()=>true,()=>'2026-10-20',held,(x,d=1)=>Number(x).toFixed(d),()=>'+12%',q=>q,q=>q?.valid===true);
  const base={as_of:'2026-10-19',__passive_monitor:true,__observation_only:true,metrics:{
    close:22.35,ma10:22.37,ma20:22.27,ma60:21.1,current_volume_lots:2948,avg_volume_20_lots:2714,
    shanchuan_v2:{mother_child:{lifecycle:{state:'formed'}}},
    entry_candle_guard:{weak_after_breakout:false}}};
  const han={...base,stock_id:'3062',__observation_kind:'ma10_pending_ma20_supported'};
  assert.equal(eligible(han),true);
  assert.match(describe(han).label,/MA10 待站穩/);
  assert.match(describe(han).label,/非買點/);
  const mei={...base,stock_id:'4960',__observation_kind:'extended_breakout_wait_pullback',
    metrics:{...base.metrics,close:27.8,ma10:24.44,ma20:23.88,ma60:21.79,
      current_volume_lots:19185,avg_volume_20_lots:7000,
      launch_sequence:{first_signal_date:'2026-10-19'}}};
  assert.equal(eligible(mei),true);
  assert.match(describe(mei).label,/等回踩/);
  assert.match(describe(mei).detail,/追高風險觀察/);
  const broken={...han,metrics:{...han.metrics,shanchuan_v2:{mother_child:{lifecycle:{state:'mother_low_broken'}}}}};
  assert.equal(eligible(broken),false);
  assert.equal(eligible({...han,as_of:'2026-10-13'}),false);
  held.set('3062',{avg_cost:20});
  assert.equal(eligible(han),false);
});
test('Passive lifecycle is visible in LAUNCH, ENTRY and tomorrow watchlist only',()=>{
  const launch=section('      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml =');
  const entrySection=section('      const renderEntrySections = (rows,{quoteUpdate=false}={}) => {','      const isEntryRadarItem =');
  const source=section('      const loadEntrySourcePair = async () => {','      async function refreshV5MonitorPool() {');
  assert.match(html,/const nearTurnWatch=\(launchData\.observation_followups\|\|\[\]\)/);
  assert.match(launch,/__passive_monitor===true/);
  assert.match(html,/const breakoutFollowups=\(launchData\?\.observation_followups\|\|\[\]\)/);
  assert.match(entrySection,/if\(item\.__passive_monitor===true\)\{/);
  assert.match(entrySection,/b\.retained\.push\(safeRow\(row/);
  assert.match(entrySection,/const passiveResearch=/);
  assert.match(entrySection,/passiveResearchHtml/);
  assert.match(source,/overnightPassiveResearch=/);
  assert.match(html,/const activeTrial=originalAction\.phase==='trial'&&originalAction\.trialable===true/);
  assert.match(html,/const activeFormal=originalAction\.phase==='confirmed'&&originalAction\.buyable===true/);
  assert.doesNotMatch(source,/spring-swallow-scan-batch/);
});
test('Latest S-signed continuation warning is read-only and appears in all radar areas',()=>{
 const src=section('      // 2026-10-20-continuation-risk-display-v1: read-only continuation warning','      const radarDeepDetailsHtml=html=>');
 const funcs=new Function('unifiedRadarGeneration','num','esc',src+
  '\nreturn {continuationRiskState,continuationRiskMiniHtml,continuationRiskFullHtml};')(
   x=>x?.metrics?.signed===true,(n,d)=>Number(n).toFixed(d),x=>String(x));
 const sample=(vol,up,signed=true)=>({as_of:'2026-10-19',
  metrics:{signed,ma_cluster:{day_volume_ratio:vol,rising:{ma60:up}}}});
 assert.equal(funcs.continuationRiskState(sample(2,false)).flag,true);
 assert.equal(funcs.continuationRiskState(sample(1.99,false)).flag,false);
 assert.equal(funcs.continuationRiskState(sample(2,true)).flag,false);
 assert.equal(funcs.continuationRiskState(sample(2,false,false)).flag,false);
 assert.equal(funcs.continuationRiskState({metrics:{signed:true}}).flag,false);
 assert.match(funcs.continuationRiskMiniHtml(sample(2,false)),/續漲風險/);
 assert.match(funcs.continuationRiskFullHtml(sample(2,false)),/第3個交易日/);
 assert.match(funcs.continuationRiskFullHtml(sample(2,false)),/非自動賣出/);
 for(const [a,b] of [
 ['      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml ='],
 ['      const entryCompactStock = (row, bucketLabel) => {','      const entryBucketHtml='],
 ['      const groupedEntrySavedWatches = visibleIds => {','      const simplifiedEntryHtml ='],
 ['        const riskStudyHtml=','        const researchCard=info=>{'],
 ['        const researchCard=info=>{','        // One stock per evening research panel.'],
 ['      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =']
 ])assert.match(section(a,b),/continuationRiskMiniHtml\(item\)/);
 assert.match(section('      const stockMovementHtml = (item, quote = null, zone =',
      '      // UI-only folding. The holdings Map remains verified by the server.'),
      /continuationRiskFullHtml\(item\)/);
 assert.doesNotMatch(src,/\bfetch\s*\(|getLiveQuotes\s*\(|setInterval\s*\(/);
 assert.match(html,/const CONTINUATION_RISK_DISPLAY_VERSION='2026-10-20-continuation-risk-display-v1'/);
 assert.match(html,/const LOCKED_RULE_VERSION = '2026-10-06-ma10-20-60-v1'/);
 assert.match(html,/selectionMas: Object.freeze\(\['MA10','MA20','MA60'\]\)/);
 assert.match(html,/holdingQuoteRefreshMs: 180000/);
});

test('Expanded radar shows one clear action, next and three prices; holdings operations remain visible',()=>{
 const body=section('      const stockMovementHtml = (item, quote = null, zone =','      // UI-only folding. The holdings Map remains verified by the server.');
 for(const re of [/① 目前判斷/,/② 下一步/,/'MA10'/,/'MA20'/,/priceSource.label/])
   assert.match(body,re);
 assert.doesNotMatch(body,/\bfetch\s*\(|getLiveQuotes\s*\(|setInterval\s*\(/);
 const holding=section('      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =');
 assert.match(holding,/stockMovementHtml\(item,live,'holding'/);
 assert.match(holding,/holdingCloseWatchHtml\(item,live\)/);
 assert.match(holding,/data-holding-edit=/);
 assert.match(holding,/data-holding-sell=/);
 assert.match(holding,/radarDeepDetailsHtml\(card\(item,\{quote:safeQuote,hideHoldingControls:true,technicalOnly:true\}\)\)/);
 assert.match(html,/options\.hideHoldingControls === true/);
 assert.match(html,/const LOCKED_RULE_VERSION = '2026-10-06-ma10-20-60-v1'/);
 assert.match(html,/CONTINUATION_RISK_DISPLAY_VERSION='2026-10-20-continuation-risk-display-v1'/);
 assert.match(section('      const entryCompactStock = (row, bucketLabel) => {','      const entryBucketHtml='),/radarDeepDetailsHtml\(v5MonitorCard/);
 assert.match(section('      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml ='),/radarDeepDetailsHtml\(/);
});

test('Final C quote is fetched only in foreground once per stock and never unlocks a buy',()=>{
 const flow=section('      // Post-close foreground C snapshot only','      const HOLDINGS_CACHE_PREFIX =');
 assert.match(flow,/m\.totalMinutes>810&&m\.totalMinutes<=1020/);
 assert.match(flow,/if\(postClose\)return !cPostCloseQuoteAttempted\.has\(item.stock_id\)/);
 assert.match(flow,/cPostCloseQuoteAttempted\.add\(item.stock_id\)/);
 assert.match(flow,/post_close_checked:true/);
 assert.doesNotMatch(flow,/setInterval\s*\(/);
 const chunk=section('      const fetchLiveQuoteChunk = async symbols => {','      const fetchScanStatusShared =');
 assert.match(chunk,/!cQuoteReadWindow\(\)/);
 assert.match(chunk,/Authorization:'Bearer '/);
 assert.match(section('      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml ='),/bestTodayQuote\(marketBridgeReady\(\)&&validTodayQuote\(quote\)\?quote:null,id\)/);
 assert.match(section('      async function refreshLiveQuotes() {','      const loadEntrySourcePair ='),/cPostCloseWindow\(\)&&marketBridgeReady\(\)/);
 assert.match(html,/const quoteOpen = !document.hidden && marketBridgeReady\(\) && cQuoteReadWindow\(\)/);
 assert.match(html,/if\(!market.open\|\|market.totalMinutes<540\|\|market.totalMinutes>=800\)return false/);
 assert.match(html,/const LOCKED_RULE_VERSION = '2026-10-06-ma10-20-60-v1'/);
});

test('C failure is visible and user can manually retry failed quotes without exposing tokens',()=>{
 const htmlStatus=section('<div class="c-quote-diagnostic"','</section>');
 assert.match(htmlStatus,/id="cQuoteStatus"/);
 assert.match(htmlStatus,/id="cQuoteCheck"/);
 const checker=section("      $('#cQuoteCheck').addEventListener('click',",
   '      // Capture native details toggles');
 assert.match(checker,/cPostCloseQuoteAttempted\.clear\(\)/);
 assert.match(checker,/configureCloudflareMarketBridge\(\)/);
 assert.match(checker,/holdingManualQuoteRefresh\(\)/);
 assert.match(checker,/refreshLiveQuotes\(\)/);
 assert.match(checker,/refreshSimpleQuotes\(\)/);
 assert.doesNotMatch(checker,/\bsignOut\s*\(|\bfetch\s*\(|setInterval\s*\(|saveHolding/);
 const fetcher=section("      let cQuoteLastCheck={status:'尚未請求'",'      const fetchScanStatusShared =');
 assert.match(fetcher,/C 拒絕管理員驗證/);
 assert.match(fetcher,/C 無法取得交易所報價/);
 assert.match(fetcher,/C 連線／逾時／CORS 異常/);
 assert.match(html,/const LOCKED_RULE_VERSION = '2026-10-06-ma10-20-60-v1'/);
});

test('All three zones use identical two-click expanded cards with accessible technical sections',()=>{
 const component=section('      const radarDeepDetailsHtml=html=>','      // Shared stock movement panel.');
 const create=new Function(component+'return radarDeepDetailsHtml;');
 const render=create();
 const nested='<article><details class="card-details"><summary>完整判斷</summary>'
   +'<p>數據保留</p><details open><summary>山川戰法</summary>'
   +'<div>MA20出場規則保留</div></details></details></article>';
 const out=render(nested);
 assert.equal((out.match(/<details\b/g)||[]).length,1);
 assert.equal((out.match(/<\/details>/g)||[]).length,1);
 assert.equal((out.match(/<summary\b/g)||[]).length,1);
 assert.match(out,/完整技術資料｜一次看完/);
 assert.match(out,/<h4 class="radar-technical-title">山川戰法<\/h4>/);
 assert.match(out,/數據保留/);
 assert.match(out,/MA20出場規則保留/);
 for(const [start,end,expected] of [
  ['      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml =',/stockMovementHtml\(item,q,'launch'/],
  ['      const entryCompactStock = (row, bucketLabel) => {','      const entryBucketHtml=',/stockMovementHtml\(item,q,'entry'/],
  ['      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =',/stockMovementHtml\(item,live,'holding'/]
 ])assert.match(section(start,end),expected);
 const holding=section('      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =');
 assert.match(holding,/holdingCloseWatchHtml\(item,live\)/);
 assert.match(holding,/holdingMa20DaysHtml\(item,live\)/);
 assert.match(holding,/data-holding-edit/);
 assert.match(holding,/data-holding-sell/);
 assert.match(holding,/radarDeepDetailsHtml\(card\(item,\{quote:safeQuote,hideHoldingControls:true,technicalOnly:true\}\)\)/);
 assert.match(html,/options\.technicalOnly === true/);
 assert.match(html,/const LOCKED_RULE_VERSION = '2026-10-06-ma10-20-60-v1'/);
 assert.match(html,/holdingQuoteRefreshMs: 180000/);
 assert.doesNotMatch(component,/fetch\s*\(|setInterval\s*\(|getLiveQuotes\s*\(/);
});

test('All three zones show actual C trade time, never falsely live after the close',()=>{
 const s=section('      // Unified display-only C/S quote source','      const companyProfileState =');
 const fn=new Function('validTodayQuote','quoteRecentForDisplay','todayQuoteDate','taipeiMarketState','num',
  s+'return quoteDisplayState;')(
    q=>q?.has_today_trade===true&&Number(q.price)>0,
    q=>q?.fresh===true,()=>'20261020',()=>({weekday:true,open:false,totalMinutes:967}),
    (n,d=2)=>Number(n).toFixed(d));
 const item={as_of:'2026-10-19',metrics:{close:37.55}};
 const q={has_today_trade:true,quote_date:'20261020',quote_time:'13:30:00',price:37};
 assert.equal(fn(q,item).value,37);
 assert.equal(fn(q,item).moment,'2026/10/20 13:30');
 assert.equal(fn(q,item).live,false);
 assert.match(fn(q,item).label,/今日最後有效成交（盤後非即時）/);
 assert.match(fn({...q,quote_time:'12:20:00'},item).label,/今日前次成交（非即時）/);
 assert.match(fn(null,item).label,/S 模型收盤（非即時）/);
 assert.equal(fn(null,item).value,37.55);
 const timing=section('      const timeInfoHtml = (item, quote) => {','      function card(item, options = {}) {');
 assert.match(timing,/C 成交時間：/);
 assert.doesNotMatch(timing,/即時成交更新：/);
 for(const [a,b] of [
 ['      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml ='],
 ['      const entryCompactStock = (row, bucketLabel) => {','      const entryBucketHtml='],
 ['        const researchCard=info=>{','        // One stock per evening research panel.'],
 ['      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml ='],
 ['      const stockMovementHtml = (item, quote = null, zone =','      // UI-only folding. The holdings Map remains verified by the server.']
 ])assert.match(section(a,b),/quoteDisplayState\(/);
 assert.match(html,/const LOCKED_RULE_VERSION = '2026-10-06-ma10-20-60-v1'/);
 assert.match(html,/holdingQuoteRefreshMs: 180000/);
 assert.doesNotMatch(s,/fetch\s*\(|getLiveQuotes\s*\(|setInterval\s*\(/);
});
test('Today opportunity shelf excludes yellow MA10 watch and stale C quotes across entry rendering',()=>{
  const entry=section('      const simplifiedEntryHtml = (labels={}) => {','      // Only compare existing EOD radar snapshots;');
  assert.match(entry,/const verifiedToday=\(rows,kind\)=>/);
  assert.match(entry,/quoteFreshForTrial\(row\?\.quote\)/);
  assert.match(entry,/a\.live_quote_verified===true/);
  assert.match(entry,/a\.phase==='trial'&&a\.trialable===true/);
  assert.match(entry,/a\.phase==='confirmed'&&a\.buyable===true/);
  assert.match(entry,/const safeStarter=verifiedToday\(labels\.starterRows,'trial'\)/);
  assert.match(entry,/const safeCompleted=verifiedToday\(labels\.completedRows,'confirmed'\)/);
  assert.match(entry,/試單待重新確認｜非買點/);
  assert.doesNotMatch(entry,/\.\.\.add\(labels\.eodTrialRows,'🟠 明日試單觀察｜目前非買點'\)\];\s*const watch=/);
});
test('MA10/MA20 pullback early orange avoids 1000-lot wait and overextension',()=>{
  const helper=section('      const ma10StarterSetup = item => {','      const eodStarterWatchEligible = item => {');
  const held=new Map();
  const {ma10StarterSetup,ma10StarterLiveTrial}=new Function(
    'holdings','unifiedRadarGeneration','chaseModelReady','expectedSignalDataDate',
    'chasePass','quoteFreshForTrial','marketFraction',
    helper+'return {ma10StarterSetup,ma10StarterLiveTrial};'
  )(held,()=>true,()=>true,()=>'2026-10-20',()=>true,q=>q?.fresh===true,()=>.1);
  const item={stock_id:'3013',as_of:'2026-10-20',score:86,metrics:{
    ma10:95.34,ma20:91.09,ma60:86.67,close:95.6,avg_volume_20_lots:3143,
    current_volume_lots:4060,position_1y_pct:32.4,daily_k:63.3,chip:{score:61},
    ma_cluster:{all_rising:true,above_all_mas:true},
    entry_candle_guard:{main_bull:true,macd_hist:.573756,macd_weak:true},
    scan_intelligence:{effective_lifecycle:'ACTIVE'},
    trade_lifecycle:{entry:{state:'starter'}},holding_management:{strong_breakdown:false}
  }};
  const quote={fresh:true,price:96.3,open:96,high:96.7,volume_lots:500,quote_time:'09:35:00'};
  assert.ok(ma10StarterSetup(item));
  assert.ok(ma10StarterLiveTrial(item,quote,true),'time-adjusted 500-lot quote can be orange');
  assert.equal(ma10StarterLiveTrial(item,{...quote,fresh:false},true),null);
  assert.equal(ma10StarterLiveTrial(item,{...quote,volume_lots:150},true),null);
  assert.equal(ma10StarterLiveTrial(item,{...quote,price:99.6,open:99,high:99.8},true),null);
  assert.equal(ma10StarterLiveTrial(item,quote,false),null);
  const near20={...item,metrics:{...item.metrics,close:92.2,
    ma_cluster:{...item.metrics.ma_cluster,above_all_mas:false},
    entry_candle_guard:{main_bull:true,macd_hist:.4,macd_weak:false}}};
  assert.equal(ma10StarterSetup(near20).support,'MA20');
  assert.equal(ma10StarterLiveTrial(near20,{...quote,price:94.8,open:94.5,high:95},true),null);
  assert.equal(ma10StarterSetup({...item,as_of:'2026-10-19'}),null);
  assert.equal(ma10StarterSetup({...item,metrics:{...item.metrics,
    entry_candle_guard:{main_bull:true,weak_after_breakout:true,macd_hist:.5}}}),null);
  held.set('3013',{});assert.equal(ma10StarterSetup(item),null);held.clear();
  const entry=section('      const entrySnapshotState = (item, baseAction, quote = null) => {','      // Compact entry display only;');
  assert.match(entry,/const earlyEligible=fresh&&modelFresh&&masOkay&&chasePass\(item,price\)/);
  assert.match(entry,/ma10StarterLiveTrial\(item,quote,earlyEligible\)/);
  assert.match(entry,/buyable:false,trialable:true/);
  const render=section('      const renderEntrySections =','      // Explain an empty launch list');
  assert.match(render,/const starterRows=byRank/);
  assert.match(render,/quoteFreshForTrial\(row.quote\)/);
  assert.match(html,/holdingQuoteRefreshMs: 180000/);
  assert.match(html,/selectionMas: Object.freeze\(\['MA10','MA20','MA60'\]\)/);
});
test('ACTIVE starter MA10 C-only orange stays fresh, guarded and non-green',()=>{
 const source=section('      const ma10StarterSetup = item => {','      const eodStarterWatchEligible = item => {');
 const held=new Map();
 const {ma10StarterSetup,ma10StarterLiveTrial}=new Function(
   'holdings','unifiedRadarGeneration','chaseModelReady','expectedSignalDataDate',
   'chasePass','quoteFreshForTrial','marketFraction',
   source+'return {ma10StarterSetup,ma10StarterLiveTrial};'
 )(held,()=>true,()=>true,()=>'2026-10-20',()=>true,q=>q?.fresh===true,()=>.5);
 // 3013: 2026-10-20 signed EOD values. Price/volume on the next day are SYNTHETIC.
 const item={stock_id:'3013',as_of:'2026-10-20',score:86,metrics:{
   ma10:95.34,ma20:91.09,ma60:86.67,close:95.6,avg_volume_20_lots:3143,
   current_volume_lots:4060,position_1y_pct:32.4,daily_k:63.3,chip:{score:61},
   ma_cluster:{all_rising:true,above_all_mas:true},
   entry_candle_guard:{main_bull:true,macd_hist:.573756,macd_weak:true},
   scan_intelligence:{effective_lifecycle:'ACTIVE'},
   trade_lifecycle:{entry:{state:'starter'}},holding_management:{strong_breakdown:false}
 }};
 const q={fresh:true,price:97,open:96.1,high:97.5,volume_lots:2400,quote_time:'10:05:00'};
 assert.equal(ma10StarterSetup(item)?.macdSlowing,true);
 assert.ok(ma10StarterLiveTrial(item,q,true));
 assert.equal(ma10StarterLiveTrial(item,null,true),null);
 assert.equal(ma10StarterLiveTrial(item,{...q,fresh:false},true),null);
 assert.equal(ma10StarterLiveTrial(item,q,false),null);
 assert.equal(ma10StarterLiveTrial(item,{...q,volume_lots:1200},true),null);
 assert.equal(ma10StarterLiveTrial(item,{...q,price:101,open:100,high:101.2},true),null);
 assert.equal(ma10StarterSetup({...item,as_of:'2026-10-19'}),null);
 assert.equal(ma10StarterSetup({...item,metrics:{...item.metrics,close:97}}),null);
 assert.equal(ma10StarterSetup({...item,metrics:{...item.metrics,chip:{score:49}}}),null);
 assert.equal(ma10StarterSetup({...item,metrics:{...item.metrics,entry_candle_guard:{...item.metrics.entry_candle_guard,weak_after_breakout:true}}}),null);
 held.set('3013',{});assert.equal(ma10StarterSetup(item),null);held.clear();
 const fusion=section('      const legacyEarlyStarterTrial = (item,quote,eligible) => {','      const eodStarterWatchEligible = item => {');
 assert.match(fusion,/quoteFreshForTrial\(quote\)/);
 assert.match(fusion,/pace<\.55\|\|pace>2\.60/);
 assert.match(fusion,/gap20<0\|\|gap20>5/);
 assert.match(fusion,/!chasePass\(item,price\)/);
 assert.match(fusion,/macd_weak===true/);
 assert.doesNotMatch(html,/const legacyStarter=legacyEarlyStarterTrial\(item,quote,earlyEligible\)/);
 assert.doesNotMatch(html,/key:'legacy_early_starter_trial'/);
 assert.match(html,/buyable:false,trialable:true,live_quote_verified:true/);
 const burst=section('      const legacyVolumeBreakoutTrial = (item,quote,eligible) => {','      const eodStarterWatchEligible = item => {');
 assert.match(burst,/quoteFreshForTrial\(quote\)/);
 assert.match(burst,/pos>=0&&pos<=35&&pace>2\.6&&pace<=4/);
 assert.match(burst,/pos>35&&pos<=70&&pace>2\.6&&pace<=3\.2/);
 assert.match(burst,/gap20>=0&&gap20<=5/);
 assert.match(burst,/!chasePass\(item,price\)/);
 assert.doesNotMatch(html,/const legacyBurst=legacyVolumeBreakoutTrial\(item,quote,earlyEligible\)/);
 assert.match(html,/buyable:false,trialable:true,live_quote_verified:true/);
 const action=section('      const entrySnapshotState = (item, baseAction, quote = null) => {','      // Compact entry display only;');
 assert.match(action,/ma10StarterLiveTrial\(item,quote,earlyEligible\)/);
 assert.doesNotMatch(action,/const legacyStarter=legacyEarlyStarterTrial/);
 assert.doesNotMatch(action,/const legacyBurst=legacyVolumeBreakoutTrial/);
 assert.match(action,/phase:'trial',rank:Math.max\(95/);
 assert.match(action,/buyable:false,trialable:true/);
 const eod=section('      const eodStarterWatchEligible = item => {','      const pullbackWatchState =');
 assert.match(eod,/ma10StarterSetup\(item\)/);
 const grouped=section('      const renderEntrySections =','      // Explain an empty launch list');
 assert.match(grouped,/const starterRows=byRank/);
 assert.match(grouped,/quoteFreshForTrial\(row.quote\)/);
 assert.match(html,/nightlySnapshotOnly: true/);
 assert.match(html,/selectionMas: Object.freeze\(\['MA10','MA20','MA60'\]\)/);
});
test('Unified passive C/S status is identical for mini, deep guide and next step',()=>{
  const presentSource=section('      const passiveWatchDescription=(item,quote=null)=>{','      const displayModelWarning=item=>');
  const present=new Function('bestTodayQuote','validTodayQuote','num',
    presentSource+'return passiveWatchDescription;')(
      q=>q,q=>q?.valid===true,(v,d=2)=>Number(v).toFixed(d));
  const item={stock_id:'3062',as_of:'2026-10-19',
    __passive_monitor:true,__observation_kind:'ma10_pending_ma20_supported',
    metrics:{close:22.1,ma10:22.37,ma20:22.27}};
  const live=present(item,{valid:true,price:23.15});
  const below=present(item,{valid:true,price:22.1});
  const noC=present(item,null);
  assert.equal(live.liveAbove,true);
  assert.match(live.label,/盤中已站上MA10／MA20/);
  assert.match(live.position,/C當日成交 23\.15/);
  assert.match(live.position,/前次S均線 MA10 22\.37／MA20 22\.27/);
  assert.match(live.modelPrefix,/S 2026-10-19 前次完整日K/);
  assert.match(live.shortAdvice,/已站上兩線/);
  assert.match(live.detail,/非小量試單或正式買點/);
  assert.equal(below.liveAbove,false);
  assert.match(below.label,/MA10 待站穩/);
  assert.match(noC.position,/S 2026-10-19 收盤/);
  const high=present({...item,__observation_kind:'extended_breakout_wait_pullback'},{valid:true,price:23.15});
  assert.match(high.label,/前次模型高乖離/);
  assert.match(high.detail,/非小量試單或正式買點/);
  const guide=section('        const passivePresentation=item.__passive_monitor===true','        const launch = metrics.launch_candidate || {};');
  assert.match(guide,/passiveWatchDescription\(item,displayQuote\)/);
  assert.match(guide,/guide\.status=passivePresentation\.label/);
  assert.match(guide,/guide\.position=passivePresentation\.position/);
  assert.match(guide,/guide\.shape=passivePresentation\.modelPrefix/);
  assert.match(guide,/guide\.note=passivePresentation\.note/);
  assert.doesNotMatch(guide,/price>=ma10/);
  const movement=section('      const stockMovementHtml =','      const holdingUrgencyRank =');
  assert.match(movement,/const passive=item\.__passive_monitor===true\?passiveWatchDescription\(item,q\)/);
  assert.match(movement,/passive\?passive\.label/);
  assert.match(movement,/passive\?passive\.detail/);
  assert.match(movement,/passive\?passive\.nextStep/);
  const short=section('      const radarShortAdvice=','      \/\/ 2026-10-20-continuation-risk-display-v1');
  assert.match(short,/passiveWatchDescription\(item,quote\)\.shortAdvice/);
  assert.match(html,/radarShortAdvice\(item,safeDisplayAction,q\)/);
  assert.match(html,/radarShortAdvice\(item,\{text:status\},q\)/);
  assert.match(html,/radarShortAdvice\(item,action,q\)/);
  assert.match(html,/const rawStudyLabel=blocked\?'🔴 暫不進場｜風控待核對'/);
  assert.match(html,/passive\?passive\.label:String\(original\.text\|\|phaseInfo\.label\)/);
  assert.match(html,/S '\+esc\(item\.as_of\|\|'日期待更新'\)\+' 前次日K/);
});
test('Signed watch attention cannot invent a buy or hide a strong overextended stock',()=>{
  const src=section('      // V2 signed S-only observation;',
    '      // Presentation only. The original action/risk model stays untouched.');
  const attention=new Function('holdings','unifiedRadarGeneration','chaseModelReady',
    'expectedSignalDataDate','validTodayQuote','chasePass','chaseOver','num',
    src+'\nreturn radarWatchAttentionState;')(
    new Map(),()=>true,()=>true,()=> '2026-10-20',q=>!!q&&q.price>0,
    (item,price)=>(price/Number(item.metrics.ma20)-1)*100<=12,
    (item,price)=>(price/Number(item.metrics.ma20)-1)*100>12,
    (x,d=1)=>Number(x).toFixed(d));
  const sample=(id,price,lots,avg,ma20)=>({stock_id:id,as_of:'2026-10-20',
    metrics:{close:price,ma20,current_volume_lots:lots,avg_volume_20_lots:avg,
      ma_cluster:{above_all_mas:true,rising:{ma10:true,ma20:true,ma60:true}},
      entry_candle_guard:{main_bull:true,recent_breakout:true}}});
  const k=sample('8089',23.9,3623,482,20.15);
  assert.equal(attention(k).priority,82);
  assert.match(attention(k).label,/高乖離禁追/);
  assert.equal(attention(k,{price:26.25}).priority,96);
  assert.equal(attention(sample('6418',44,127,101,35.21)).priority,0);
  assert.equal(attention({...k,as_of:'2026-10-19'}).priority,0);
  const weak={...k,metrics:{...k.metrics,
    entry_candle_guard:{main_bull:true,recent_breakout:true,weak_after_breakout:true}}};
  assert.equal(attention(weak).priority,0);
  assert.doesNotMatch(src,/fetch\s*\(|getLiveQuotes\s*\(|savePullbackWatchRows\s*\(/);
  const htmlEntry=section('      const simplifiedEntryHtml =', '      // Only compare existing EOD radar snapshots;');
  assert.match(htmlEntry,/watch\.sort\(\(a,b\)=>radarWatchAttentionState/);
  assert.match(html,/radarWatchAttentionState\(item,q\)/);
  assert.match(html,/const maxVisible=key==='today'\?5:key==='tracking'\?9:4/);
  assert.match(html,/const entryCompactStock =/);
  assert.match(html,/const launchMiniHtml =/);
  assert.match(html,/const holdingMiniHtml =/);
  assert.match(html,/if\(stage==='ENTRY'\|\|stage==='LIVE'\)return loadLiveMonitor\(\)/);
});
test('Pre-breakout signal survives live breakout without bypassing trade gates',()=>{
  const src=section('      // V2 signed S-only observation;',
    '      const RADAR_WATCH_ATTENTION_VERSION=');
  const scout=new Function('holdings','unifiedRadarGeneration','chaseModelReady',
    'expectedSignalDataDate','validTodayQuote','chasePass','chaseOver','num',
    src+'\nreturn radarPreBreakoutState;')(
    new Map(),()=>true,()=>true,()=> '2026-10-20',q=>!!q&&q.price>0,
    (item,price)=>(price/Number(item.metrics.ma20)-1)*100<=12,
    (item,price)=>(price/Number(item.metrics.ma20)-1)*100>12,
    (v,d=1)=>Number(v).toFixed(d));
  const item={stock_id:'TEST',as_of:'2026-10-20',metrics:{
    close:100,prev_close:99,ma10:99,ma20:98,ma60:97,high20_prev:102,
    position_1y_pct:35,current_volume_lots:1200,avg_volume_20_lots:450,
    ma_cluster:{rising:{ma10:true,ma20:true},day_volume_ratio:1.2},
    entry_candle_guard:{weak_after_breakout:false},
    prebreakout_scout:{version:'2026-10-21-prebreakout-scout-v1',
      as_of:'2026-10-20',eligible:true,state:'ready',actionable:false}}};
  assert.equal(scout(item).priority,94);
  assert.match(scout(item).label,/非買點/);
  assert.equal(scout(item,{price:103}).priority,95);
  assert.equal(scout(item,{price:120}).priority,98);
  assert.match(scout(item,{price:120}).label,/禁追/);
  assert.equal(scout({...item,as_of:'2026-10-19'}).eligible,false);
  assert.equal(scout({...item,metrics:{...item.metrics,position_1y_pct:96}}).eligible,false);
  assert.equal(scout({...item,metrics:{...item.metrics,current_volume_lots:150}}).eligible,false);
  assert.equal(scout({...item,metrics:{...item.metrics,prebreakout_scout:{
    version:'2026-10-21-prebreakout-scout-v1',as_of:'2026-10-20',
    eligible:false,actionable:false}}}).eligible,false);
  assert.match(html,/if\(radarPreBreakoutState\(item\)\.eligible\)return true/);
  assert.match(html,/rank:155,className:'prebreakout-watch'/);
  assert.match(html,/preScout\.eligible\?radarPreBreakoutState\(item,q\)\.label/);
  assert.match(html,/const launchShownIds =/);
  assert.match(html,/quoteFreshForTrial\(row\.quote\)/);
  assert.doesNotMatch(src,/fetch\s*\(|getLiveQuotes\s*\(|savePullbackWatchRows\s*\(/);
});
test('Current and historical scouts render as one-level clickable stock cards without buy signals',()=>{
  const src=section('      let launchDisplayedIds=new Set();','      const flushScoutCloud=async()=>{');
  const rows=new Map([
    ['5521',{stock_id:'5521',stock_name:'工信',as_of:'2026-10-21',
      state:'prelaunch',label:'山川前哨',close:11.15,reason:'前高觀察'}],
    ['3062',{stock_id:'3062',stock_name:'建漢',as_of:'2026-10-21',
      state:'prelaunch',label:'山川第一根前哨',close:23.1,bias:2.4,first_bar_date:'2026-10-14'}],
    ['3013',{stock_id:'3013',stock_name:'晟銘電',as_of:'2026-10-21',
      state:'first_bar',label:'已轉進場雷達',close:95.6}],
    ['1609',{stock_id:'1609',stock_name:'大亞',as_of:'2026-10-21',
      state:'invalid',label:'結構轉弱',close:37.25}],
    ['1802',{stock_id:'1802',stock_name:'台玻',as_of:'2026-10-21',
      state:'overheated',label:'過熱',close:18.2}]
  ]);
  const escape=v=>String(v).replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const savedOpen=new Set(['1609']);
  const renderFn=new Function('scoutHistory','holdings','stage','esc','num',
    'launchExpandedIds','document',src+
    '\nreturn {scoutOnlyLaunchRows,launchScoutOnlyHtml,renderScoutPanel,setVisible:xs=>{launchDisplayedIds=new Set(xs)}};');
  let content='',fakePresent=false;
  const list={
    querySelector:selector=>selector==='.launch-mini-wrap'?{}:null,
    querySelectorAll:()=>fakePresent?[{
      dataset:{stockId:'3062'},
      querySelector:()=>({open:false}),
      remove:()=>{content='';fakePresent=false;}
    }]:[],
    insertAdjacentHTML:(_where,html)=>{content=html;fakePresent=true;}
  };
  const sut=renderFn(rows,new Map(),'LAUNCH',escape,(n,p)=>Number(n).toFixed(p),
    savedOpen,{getElementById:id=>id==='list'?list:null});
  sut.setVisible(['5521']);
  const watch=sut.scoutOnlyLaunchRows();
  assert.deepEqual(watch.map(x=>x.stock_id),['3062','3013','1609','1802']);
  const cards=watch.map(x=>sut.launchScoutOnlyHtml(x));
  for(const card of cards){
    assert.match(card,/class="entry-mini" data-stock-key="/);
    assert.match(card,/class="card radar-scout-detail"/);
    assert.match(card,/歷史收盤（非即時）/);
    assert.match(card,/歷史資料，非目前買點/);
    assert.equal((card.match(/<details/g)||[]).length,1,'ONE fold level per historical stock');
    assert.doesNotMatch(card,/data-holding-buy|buyable:true|trialable:true|🟢 正式買點/);
  }
  assert.doesNotMatch(cards[0],/data-stock-key="3062" open/);
  assert.match(cards[1],/已轉進場/);
  assert.match(cards[2],/結構失效/);
  assert.match(cards[2],/data-stock-key="1609" open/);
  assert.match(cards[3],/過熱觀察/);
  assert.match(cards[0],/第一根紀錄：2026-10-14/);
  assert.match(cards[0],/MA20 乖離（歷史）：\+2.40%/);
  sut.renderScoutPanel();
  assert.match(content,/3062 建漢/);
  assert.doesNotMatch(content,/5521 工信/);
  assert.equal(rows.size,5,'Cloud history stays stored');
  sut.setVisible(['5521','3062','3013','1609','1802']);
  sut.renderScoutPanel();
  assert.equal(content,'','No duplicated rows after main list owns them');
  assert.doesNotMatch(html,/id="scoutPanel"/);
  assert.match(html,/scoutOnlyLaunchRows\(\)\.map\(x=>launchScoutOnlyHtml\(x\)\)/);
  assert.match(html,/launchListHtml\(liveLaunchItems,liveQuoteMap\)/);
  assert.match(html,/const launchListHtml = \(items,quoteMap=null\) =>/);
  assert.match(html,/launchScoutHistoryHtml\(item\)/);
  assert.doesNotMatch(src,/getLiveQuotes\s*\(|scanBatch\s*\(|setInterval\s*\(/);
});
test('Tomorrow ENTRY research and continued pullback share one nonduplicated card shelf',()=>{
  assert.match(html,/compactEntryGroupHtml\('tracking','🌙 明日看盤清單｜追蹤與等待回踩'/);
  assert.match(html,/const tomorrowResearchRows=\[/);
  assert.match(html,/\.{3}topResearch\.map\(x=>x\.row\)/);
  assert.match(html,/\.{3}strongFollowups/);
  assert.match(html,/\.{3}passiveResearch/);
  assert.match(html,/const uniqueWatch=watch\.filter/);
  assert.match(html,/blockedIds\.has\(id\)\|\|tomorrowSeen\.has\(id\)/);
  assert.match(html,/const outHtml=banner\+simplifiedEntryHtml/);
  assert.doesNotMatch(html,/const outHtml=banner\+researchPreview\+simplifiedEntryHtml/);
  assert.match(html,/extraHtml:persistent\.savedHtml/);
  assert.match(html,/compactEntryGroupHtml\('today'/);
  assert.match(html,/compactEntryGroupHtml\('risk'/);
  assert.match(html,/data-entry-fold="simple-'\+key/);
});
test('ENTRY warns when newest signed daily-K coverage is partial',()=>{
  assert.match(html,/if\(launchData\?\.progress\)latestScanProgress=launchData\.progress/);
  assert.match(html,/latestCount<stockTotal\*\.98/);
  assert.match(html,/⚠️ 盤後日K只更新/);
  assert.match(html,/scanCoverage\+'<\/span>'/);
  assert.match(html,/const outHtml=banner\+simplifiedEntryHtml/);
  const source=section('        const latestCount=Number(latestScanProgress?.latest_count||0);',
    '        const outHtml=banner+simplifiedEntryHtml(');
  assert.doesNotMatch(source,/getLiveQuotes\s*\(|scanBatch\s*\(|buyable:true|trialable:true/);
});
test('Foreign 10-day net and quarterly quality reuse the existing chip/revenue row',()=>{
  const src=section('      const chipMergedSnapshotText =',
    '      const selectionGuide = (item, signal) => {');
  const helpers=new Function('num',src+
    '\nreturn {chipMergedSnapshotText,fundamentalChipBrief};')(
    (n,d=2)=>Number(n).toFixed(d));
  const net=helpers.chipMergedSnapshotText({score:76,label:'籌碼偏多',
    institutional:{foreign_net_5d:-2000,foreign_net_10d:1943133,foreign_10d_covered:true},
    foreign:{change_10d_pp:-.12}});
  assert.match(net,/外資10日累計買超/);
  assert.doesNotMatch(net,/近5日累計賣超|持股比|連買/);
  const sold=helpers.chipMergedSnapshotText({score:42,label:'籌碼偏弱',
    institutional:{foreign_net_10d:-649119,foreign_10d_covered:true}});
  assert.match(sold,/外資10日累計賣超/);
  const old=helpers.chipMergedSnapshotText({score:70,label:'籌碼偏多',
    institutional:{foreign_net_5d:12345},foreign:{change_10d_pp:1.55}});
  assert.match(old,/外資近5日累計買超/);
  assert.doesNotMatch(old,/10日累計買超/);
  assert.equal(helpers.chipMergedSnapshotText({score:55,label:'籌碼中性'}),'籌碼 55分・中性');
  const all={version:'2026-10-21-fundamental-chip-confluence-v1',
    as_of:'2026-10-21',all_five_confirmed:true};
  assert.match(helpers.fundamentalChipBrief({fundamental_blend:all}),/五項成長／籌碼／突破共振（仍非買點）/);
  const partial={version:all.version,as_of:all.as_of,
    gross_margin_2q_up:true,operating_cashflow_positive:true};
  assert.match(helpers.fundamentalChipBrief({fundamental_blend:partial}),
    /毛利率連兩季改善・單季營業現金流正/);
  assert.equal(helpers.fundamentalChipBrief({}), '');
  assert.match(html,/const chipText = chipMergedSnapshotText\(metrics\.chip,chipRaw\)/);
  assert.match(html,/esc\(chipMergedSnapshotText\(chip\)\)/);
  assert.match(html,/fundamentals: \[chipText,revenueText,fundamentalChipBrief\(metrics\)\]/);
  assert.doesNotMatch(src,/fetch\s*\(|getLiveQuotes\s*\(|setInterval\s*\(/);
});
test('KD-high is an oscillator warning, not a high-price veto for 2633',()=>{
  const source=section('      const newEntryRiskGate = (item, quote = null) => {',
    '      const entryCandleGuard =');
  const gate=new Function('chaseModelReady','liveSelloffRisk','validTodayQuote',
    'chaseOver','chaseLimitNote','num',source+'\nreturn newEntryRiskGate;')(
    ()=>true,()=>null,()=>false,(item,p)=>p>Number(item.metrics.ma20)*1.12,
    ()=>'12%',(x,n=1)=>Number(x).toFixed(n));
  // Isolate the KD oscillator check from the independently required TDCC
  // 2-week entry gate. Without these certified fields, the TDCC veto should
  // correctly block and this test would be testing the wrong decision layer.
  const asOf='2026-10-28';
  const item={stock_id:'2633',as_of:asOf,metrics:{close:26.35,ma20:25.85,ma60:25.96,
    position_1y_pct:35.2,daily_k:83.8,daily_d:82.6,
    tdcc_holder_flow:{version:'2026-10-28-tdcc-ma20-0-8-two-weeks-v1',
      entry_gate_verified:true,pass:true,covered:true,as_of:asOf},
    entry_candle_guard:{main_bull:true,weak_after_breakout:false},
    holding_management:{strong_breakdown:false}},
    cautions:['日KD偏高']};
  assert.equal(gate(item),null,'KD 83.8 / D 82.6 must not be high-position risk');
  assert.equal(gate({...item,metrics:{...item.metrics,daily_d:84.6}})?.kind,
    'momentum','K < D may trigger the existing weakening check');
  assert.equal(gate({...item,metrics:{...item.metrics,position_1y_pct:89}})?.kind,
    'position','high one-year position must retain the original guard');
  const high=section('          const high=(Number.isFinite(pos)&&pos>=85)||chaseOver(item,price)',
    '          if(high){');
  assert.doesNotMatch(high,/k>80|日KD偏高/);
  assert.match(high,/risk\?\.kind==='position'/);
});
test('Compact summary, expanded decision and technical guide share one action',()=>{
  assert.match(html,/const decisionText=activeFormal\?/);
  assert.match(html,/const safeDisplayAction=\{\.\.\.originalAction,buyable:activeFormal,trialable:activeTrial,[\s\S]*?text:decisionText/);
  assert.match(html,/const glanceSignal=String\(decisionText\)\.split/);
  assert.match(html,/const stageLabel=rawStageLabel\.includes\('非買點'\)/);
  assert.match(html,/stockMovementHtml\(item,q,'entry',safeDisplayAction\)/);
  assert.match(html,/guide\.status=String\(signal\.text\|\|guide\.status\)/);
  assert.match(html,/stockMovementHtml\(item,q,'launch',launchDisplayAction\)/);
  assert.match(html,/hideDecisionBanner:true,actionOverride:launchDisplayAction/);
  assert.match(html,/const rawStudyLabel=blocked\?'🔴 暫不進場｜風控待核對'/);
  assert.match(html,/String\(info\.row\?\.action\?\.text\|\|phaseInfo\.label\)/);
  assert.match(html,/const decision=holdingDisplay\(item,live\)/);
  assert.match(html,/stockMovementHtml\(item,live,'holding',\{text:actionLabel,detail:decision\.reminder\}\)/);
});
test('2023 signed pre-breakout gets cross-day observation without fictitious early alert or buy',()=>{
  const src=section('      const ingestSignedPrebreakoutRows=rows=>{',
    '      const ENTRY_QUOTE_REFRESH_MS =');
  assert.doesNotMatch(src,/fetch\s*\(|getLiveQuotes\s*\(|scanBatch\s*\(|setInterval\s*\(|buyable:true|trialable:true/);
  const hist=new Map(),pending=new Map(),held=new Map();
  let renders=0,reads=0;
  const ingest=new Function('scoutHistory','scoutPending','holdings',
    'unifiedRadarGeneration','chaseModelReady','scoutNewer',
    'scoutCleanHistory','renderScoutPanel','scoutCloudReady',
    'flushScoutCloud','refreshScoutCloud',src+'\nreturn ingestSignedPrebreakoutRows;')(
    hist,pending,held,()=>true,()=>true,
    (old,next)=>String(old.as_of)>String(next.as_of),
    ()=>{},()=>{renders++},false,()=>Promise.resolve(),()=>{reads++;return Promise.resolve()});
  const make=(day,life,firstSeen,actionable=false)=>({
    stock_id:'2023',stock_name:'燁輝',as_of:day,scanned_at:day+'T14:15:00Z',
    metrics:{close:life==='ACTIVE'?14.7:13.9,
      prebreakout_scout:{version:'2026-10-21-prebreakout-scout-v1',
        as_of:day,eligible:true,actionable,score:72,reason:'模型均線轉強'},
      scan_intelligence:{effective_lifecycle:life,
        prebreakout_first_seen_as_of:firstSeen||day},
      ma_cluster:{launch_sequence:{first_signal_date:'2026-10-16'}}}
  });
  ingest([make('2026-10-14','PRELAUNCH')]);
  assert.equal(hist.get('2023').seen_as_of,'2026-10-14');
  assert.equal(hist.get('2023').state,'prelaunch');
  assert.match(hist.get('2023').label,/非買點/);
  ingest([make('2026-10-21','ACTIVE','2026-10-14')]);
  assert.equal(hist.get('2023').seen_as_of,'2026-10-14');
  assert.equal(hist.get('2023').state,'followup');
  assert.match(hist.get('2023').label,/已轉進場雷達/);
  assert.equal(hist.get('2023').as_of,'2026-10-21');
  assert.equal(pending.size,1);
  ingest([make('2026-10-22','ACTIVE','2026-10-14',true)]);
  assert.equal(hist.get('2023').as_of,'2026-10-21',
    'actionable scout payload must never be saved as observation');
  assert.ok(renders>=2&&reads>=2);
});
test('Bottom-first v2 separates early base observation from verified C trial and holding',()=>{
  const source=section('      const BOTTOM_FIRST_QUALITY_VERSION=', '      // Entry radar is night-snapshot-only');
  const date=()=> '2026-10-27';
  const marketProxy={stock_id:'0050',price:150,prev_close:149.5,quote_date:'20261027',quote_time:'09:05:00'};
  const calls={
    validTodayQuote:q=>!!q,quoteFreshForTrial:q=>!!q,
    expectedSignalDataDate:date,unifiedRadarGeneration:()=>true,
    chaseModelReady:()=>true,chasePass:()=>true,marketFraction:()=>.5,
    benchmark0050Quote:marketProxy,
    num:(v,n=2)=>Number(v).toFixed(n)
  };
  const f=new Function(...Object.keys(calls),source+
    '\nreturn {bottomFirstQuality,guardBottomFirstAction,BOTTOM_FIRST_QUALITY_VERSION};');
  const {bottomFirstQuality:q,guardBottomFirstAction:guard,BOTTOM_FIRST_QUALITY_VERSION:version}
    =f(...Object.values(calls));
  assert.match(version,/2026-10-28/);
  const model={
    stock_id:'3062',as_of:'2026-10-27',
    metrics:{close:100,prev_close:99.5,ma5:99,ma10:98.5,ma20:98,
      ma60:97,high20_prev:103,current_volume_lots:1500,avg_volume_20_lots:1200,
      position_1y_pct:22,entry_candle_guard:{main_bull:true},
      prebreakout_scout:{eligible:true,as_of:'2026-10-27'},
      box_strategy:{discovery:{ready_watch:true}}}
  };
  const live={price:101,open:100,prev_close:99.5,high:101.1,
    volume_lots:1200,quote_time:'09:05:00',quote_date:'20261027'};
  assert.equal(q(model).prelaunch,true);
  assert.equal(q(model,live).trial,true);
  assert.ok(q(model,live).relativePct>0.5);
  marketProxy.price=154;
  assert.equal(q(model,live).trial,false,'index proxy outruns stock, no trial');
  marketProxy.price=150;
  assert.equal(q({...model,metrics:{...model.metrics,close:97.9}},live).prelaunch,true,'near MA20 can be WATCH');
  assert.equal(q({...model,metrics:{...model.metrics,close:97}},live).prelaunch,true,'unfinished base stays WATCH');
  assert.equal(q({...model,metrics:{...model.metrics,close:97}},live).trialBase,false,'unfinished base not a trial');
  assert.equal(q({...model,metrics:{...model.metrics,close:95}},live).prelaunch,false,'support lost');
  const forming={...model,metrics:{...model.metrics,current_volume_lots:380,avg_volume_20_lots:600}};
  assert.equal(q(forming).prelaunch,true,'forming stock should be visible before volume reaches 1000');
  assert.equal(q(forming).trialBase,false,'forming watch must never be an actionable trade');
  assert.equal(q({...model,metrics:{...model.metrics,quality_gate:{mode:'warning_only_for_bc',pass:false}}}).prelaunch,
    true,'B/C warning-only quality gate is NOT an early-watch veto');
  assert.equal(q({...model,metrics:{...model.metrics,
    quality_gate:{mode:'warning_only_for_bc',pass:false}}},live).trial,
    true,'warning-only does not override live trade-quality/risk gate');
  const ultraLow={...model,metrics:{...model.metrics,current_volume_lots:100,avg_volume_20_lots:300}};
  assert.equal(q(ultraLow).prelaunch,false,'very low daily liquidity stays excluded');
  assert.match(html,/const BOTTOM_FIRST_QUALITY_VERSION='2026-10-28-bottom-first-quality-v2'/);
  const unlabeled=f(...Object.values({...calls,benchmark0050Quote:null})).bottomFirstQuality;
  assert.equal(unlabeled(model,live).trial,true,'missing 0050 does not veto strong C trade');
  assert.equal(unlabeled(model,live).relativePct,null,'do not invent proxy outperformance');
  assert.equal(unlabeled(model,{...live,price:100.1}).trial,false,'without proxy require stronger stock gain');
  const heldRecovery={...model,metrics:{...model.metrics,
    position_1y_pct:78,
    box_strategy:{...model.metrics.box_strategy,levels:{top:99}},
    entry_candle_guard:{main_bull:true}}};
  assert.equal(q(heldRecovery).prelaunch,false,'high percentile not a fresh new-entry');
  assert.equal(q(heldRecovery).holdingRebreak,true,'rebuilding held loss can qualify by setup');
  assert.equal(q({...heldRecovery,metrics:{...heldRecovery.metrics,
    box_strategy:{levels:{top:109}}}}).holdingRebreak,false,'unbroken box is not add-ready');
  const action={key:'legacy_early_starter_trial',phase:'trial',trialable:true,buyable:false,text:'🟠 舊版試單'};
  assert.equal(guard(model,live,action).trialable,true);
  for(const bad of [
    {...live,price:99},              // negative open candle
    {...live,prev_close:103},        // no strength vs yesterday
    {...live,high:105},              // long upper wick
    {...live,volume_lots:100},       // weak/too early
    {...live,price:108,high:108},    // extended chase
  ]){
    assert.equal(q(model,bad).trial,false);
    const blocked=guard(model,bad,action);
    assert.equal(blocked.trialable,false);
    assert.equal(blocked.buyable,false);
    assert.equal(blocked.phase,'observe');
  }
  assert.equal(q({...model,as_of:'2026-10-24'},live).trial,false);
  assert.equal(q({...model,metrics:{...model.metrics,position_1y_pct:85}},live).trial,false);
  assert.equal(q({...model,metrics:{...model.metrics,current_volume_lots:450}},live).trial,false);
  assert.equal(q(model,{...live,volume_lots:999}).trial,false,'actual 1000-lot floor not relaxed');
  assert.equal(q({...model,metrics:{...model.metrics,entry_candle_guard:{main_bull:false}}},live).prelaunch,true);
  assert.equal(q({...model,metrics:{...model.metrics,entry_candle_guard:{main_bull:false}}},live).trial,false);
  const slowing={...model,metrics:{...model.metrics,entry_candle_guard:{main_bull:true,macd_weak:true}}};
  assert.equal(q(slowing).prelaunch,true,'slowing MACD stays visible for early research');
  assert.equal(q(slowing,live).trial,false,'slowing MACD cannot buy on a small bounce');
  assert.equal(q(slowing,{...live,price:102,high:102.1}).trial,true,
    'stronger fresh C reversal plus 1000 real traded lots may become orange trial');
  assert.equal(q({...model,metrics:{...model.metrics,entry_candle_guard:{weak_after_breakout:true}}},live).trial,false);
  const watch={phase:'observe',trialable:false,text:'🌱 低檔追蹤'};
  assert.equal(guard(model,live,watch),watch);
  assert.match(html,/rows=rows\.map\(row=>\(\{\.\.\.row,action:guardBottomFirstAction/);
  assert.match(html,/const earlyQuality=bottomFirstQuality\(item\)/);
  assert.match(html,/const addReady=addPlan\?\.eligible===true[\s\S]{0,190}bottomFirstQuality\(item,live\)\.holdingRebreak/);
  assert.match(html,/guardBottomFirstAction\(model,observedQuote,entrySnapshotState/);
  assert.doesNotMatch(source,/fetch\s*\(|getLiveQuotes\s*\(|setInterval\s*\(|scanBatch\s*\(/);
  assert.match(html,/existingSymbols\.length===30/);
  assert.match(html,/const quoteSymbols=reservedOutIndex<0/);
  assert.match(html,/benchmarkSlotClaimed=false;/);
  assert.match(html,/rawQuotes\.filter\(x=>String\(x\?\.stock_id\|\|''\)!=='0050'\)/);
  assert.match(html,/benchmarkInBatch[\s\S]*?0050:tse/);
  assert.match(html,/fetchLiveQuoteChunk\(symbols\)/);
  assert.match(html,/i \+= 30/);
});

test('Entry C quote proxy handles full 30-slot batches, no extra request',()=>{
  const source=section('      let benchmark0050Quote=null;', '      const fetchScanStatusShared = async () => {');
  assert.match(source,/const benchmarkInBatch=stage==='ENTRY'&&!benchmarkSlotClaimed/);
  assert.match(source,/existingSymbols\.length===30/);
  assert.match(source,/existingSymbols\.filter\(\(_,i\)=>i!==reservedOutIndex\)/);
  assert.match(source,/\[\.\.\.quoteSymbols,'0050:tse'\]\.join\(','\)/);
  assert.match(source,/rawQuotes\.filter\(x=>String\(x\?\.stock_id\|\|''\)!=='0050'\)/);
  assert.match(html,/benchmarkSlotClaimed=false;\s*const results = await Promise\.all\(chunks\.map/);
});
test('Launch and entry labels cannot bypass bottom-first trial and EOD preparation gates',()=>{
  const launch=section('      const launchMiniHtml = (item, quote = null) => {','      const launchListHtml =');
  const entry=section('      const renderEntrySections = (rows,{quoteUpdate=false}={}) => {','      const isEntryRadarItem =');
  assert.match(launch,/ma10Preliminary/);
  assert.match(launch,/MA10初步轉強｜進場區待確認（非試單）/);
  assert.match(launch,/q&&ma20>0&&price<ma20\?'🟠 今日已知成交低於MA20/);
  assert.doesNotMatch(launch,/:[ ]?trial\?trial\.text/);
  assert.doesNotMatch(launch,/ma10PullbackTrialState\(item,q\)[\s\S]{0,100}\?trial\.text/);
  assert.match(entry,/const eodTrialWatchReady=row=>\([\s\S]*?bottomFirstQuality\(row.item\)\.trialBase[\s\S]*?bottomFirstQuality\(row.item\)\.prelaunch/);
  assert.match(html,/const relaxedQuality=bottomFirstQuality\(item,quote\)/);
  assert.match(html,/key:'bottom_first_live_trial',phase:'trial'/);
  assert.match(html,/formalEntryValidation\.enabled&&m\.v5\?\.entry_confirmed===true/);
  assert.match(html,/if \(earlyQuality\.prelaunch&&!earlyQuality\.trialBase\)/);
  assert.match(entry,/rows=rows\.map\(row=>\(\{\.\.\.row,action:guardBottomFirstAction\(row.item,row.quote,row.action\)\}\)\)/);
  assert.match(html,/const addReady=addPlan\?\.eligible===true[\s\S]{0,220}risk\?\.stopHard!==true/);
});
test('Open-market EOD trial candidate shows live C status, never preopen instructions',()=>{
  const snippet=section('        const entryTrialPreparationCopy=(item,quote,starterSetup=null)=>{','        const assign=row=>{');
  let current={open:true,weekday:true,totalMinutes:646};
  let trial=false;
  const factory=new Function('taipeiMarketState','validTodayQuote','quoteFreshForTrial','bottomFirstQuality','num',
    snippet+'\nreturn entryTrialPreparationCopy;');
  const label=factory(()=>current,q=>q?.valid===true,q=>q?.fresh===true,
    ()=>({trial,reasons:['累計成交量未達1,000張','支撐未確認']}),
    (v,d=2)=>Number(v).toFixed(d));
  const model={stock_id:'5521',as_of:'2026-10-27'};
  const missing=label(model,null);
  assert.match(missing.text,/已開盤｜尚未取得今日C成交/);
  assert.match(missing.detail,/不是|不能宣稱/);
  const stale=label(model,{valid:true,fresh:false,quote_time:'10:24:00'});
  assert.match(stale.text,/已開盤｜C成交已超過5分鐘/);
  assert.match(stale.detail,/10:24:00/);
  const fresh={valid:true,fresh:true,price:11.35,volume_lots:860,quote_time:'10:46:00'};
  const notYet=label(model,fresh);
  assert.match(notYet.text,/已開盤｜試單條件尚未達標/);
  assert.match(notYet.detail,/860/);
  assert.match(notYet.detail,/累計成交量未達1,000張/);
  assert.doesNotMatch(notYet.text,/開盤再確認/);
  assert.doesNotMatch(notYet.detail,/開盤再確認/);
  trial=true;
  const eligibleButNotPromoted=label(model,{...fresh,volume_lots:1100});
  assert.match(eligibleButNotPromoted.text,/原進場條件未確認/);
  assert.match(eligibleButNotPromoted.detail,/非買點|不可視為橘色/);
  current={open:true,weekday:true,totalMinutes:805};
  assert.match(label(model,fresh).text,/盤中試單確認已截止/);
  current={open:false,weekday:true,totalMinutes:530};
  assert.match(label(model,null).text,/盤前試單準備｜09:00後核對/);
  current={open:false,weekday:true,totalMinutes:845};
  assert.match(label(model,null).text,/盤後試單候選｜下個交易日確認/);
  assert.doesNotMatch(html,/🟠 試單準備｜開盤再確認/);
  assert.match(html,/const status=entryTrialPreparationCopy\(item,q,starterSetup\)/);
  assert.match(html,/盤中試單待確認 \${groups\.eodTrialRows\.length}/);
});
for(const g of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=/.test(g[1]))continue;
  new Function(g[2]);
}
console.log('PASS inline JavaScript syntax');
console.log('Radar regression gates: '+passed+' groups passed; 0 network calls.');

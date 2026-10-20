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
  assert.match(holding,/card\(item,\{quote:safeQuote,hideHoldingControls:true\}\)/);
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
    'chaseModelReady','unifiedRadarGeneration','overnightLifecycleState','chaseLimitNote','esc','num','radarShortAdvice','continuationRiskFullHtml',
    src+'\nreturn stockMovementHtml;')(
    q=>q,q=>!!q&&q.has_today_trade===true&&q.price>0,q=>q.fresh===true,
    ()=>({tag:'🟢 量價改善',volumeRatio:1.2}),
    x=>x?.metrics?.chase_rule_version==='2026-10-20-bias-8-12-15-v1',
    ()=>true,()=>({label:'底部整理',tomorrow:'等量價轉強'}),()=>'+12%',
    x=>String(x).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    (x,d=1)=>Number(x).toFixed(d),(item,action)=>action?.detail||'觀察量價',()=> '');
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
  assert.match(saved,/C 今日即時成交/);
  assert.match(saved,/C 今日前次成交/);
  assert.doesNotMatch(follow,/\bfetch\s*\(|setInterval\s*\(/);
});
test('Tomorrow watchlist reuses valid C quotes in summary and expanded data',()=>{
  const expanded=section('        const researchExpandedCard = (row,blocked=false) => {','        const riskStudyHtml=');
  const compact=section('        const researchCard=info=>{','        // One stock per evening research panel.');
  assert.match(expanded,/bestTodayQuote\(row\?\.quote,String\(item\.stock_id\|\|''\)\)/);
  assert.match(expanded,/stockMovementHtml\(item,validatedQuote,'entry',studyAction\)/);
  assert.match(expanded,/v5MonitorCard\(item,validatedQuote,studyAction\)/);
  assert.match(compact,/bestTodayQuote\(info\.row\?\.quote,id\)/);
  assert.match(compact,/quoteRecentForDisplay\(live\)/);
  assert.match(compact,/C 今日即時成交/);
  assert.match(compact,/C 今日前次成交/);
  assert.match(compact,/模型收盤/);
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
    new Function('unifiedRadarGeneration','expectedSignalDataDate','holdings','num','chaseLimitNote',
      source+'\nreturn {passiveRadarWatchEligible,passiveWatchDescription};')(
      ()=>true,()=>'2026-10-20',held,(x,d=1)=>Number(x).toFixed(d),()=>'+12%');
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
  assert.match(describe(mei).detail,/不追價/);
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
 for(const re of [/① 目前判斷/,/② 下一步/,/'MA10'/,/'MA20'/,/C 今日前次成交（非即時）/])
   assert.match(body,re);
 assert.doesNotMatch(body,/\bfetch\s*\(|getLiveQuotes\s*\(|setInterval\s*\(/);
 const holding=section('      const holdingMiniHtml = (item, quote = null) => {','      const holdingPlaceholderHtml =');
 assert.match(holding,/stockMovementHtml\(item,live,'holding'/);
 assert.match(holding,/holdingCloseWatchHtml\(item,live\)/);
 assert.match(holding,/data-holding-edit=/);
 assert.match(holding,/data-holding-sell=/);
 assert.match(holding,/radarDeepDetailsHtml\(card\(item,\{quote:safeQuote,hideHoldingControls:true\}\)\)/);
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
for(const g of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(/\bsrc=/.test(g[1]))continue;
  new Function(g[2]);
}
console.log('PASS inline JavaScript syntax');
console.log('Radar regression gates: '+passed+' groups passed; 0 network calls.');

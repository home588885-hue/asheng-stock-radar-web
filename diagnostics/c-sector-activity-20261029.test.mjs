import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../sector-c-activity.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
const globals={window:{},Intl,Date,Math,Number,Map,Set,Object,String,RegExp};
vm.runInNewContext(source,globals,{filename:'sector-c-activity.js'});
const make=()=>globals.window.AshengCSectorActivity.createCSectorActivity();
const on=(clock)=>new Date('2026-10-29T'+clock+':00+08:00');
const stock=(id,market='tse',industry='半導體業')=>({stock_id:id,market,industry,avg_volume_20_lots:540,as_of:'2026-10-28',stage:'LAUNCH'});
const quote=(id,clock,vol,opts={})=>({stock_id:id,market:'tse',quote_date:'20261029',
  quote_time:clock,price:100,volume_lots:vol,has_today_trade:true,
  price_source:'mis_last_trade',...opts});

test('only truly successive verified intraday C trades create an estimated activity pair',()=>{
 const m=make(),ids=['2330','2303','2454'];
 for(const id of ids)m.track(stock(id));
 assert.equal(m.observe(ids.map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true}),3);
 assert.equal(m.summarize('半導體業','tse',{now:on('10:04'),marketOpen:true}).ready,false);
 assert.equal(m.observe(ids.map(id=>quote(id,'10:06:00',150)),
   {now:on('10:08'),marketOpen:true}),3);
 const group=m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:true});
 assert.equal(group.ready,true);
 assert.equal(group.covered,3);
 assert.equal(group.total,3);
 assert.equal(group.median_volume_pace,6.25);
 assert.equal(group.estimated_twd_per_minute,3750000);
 assert.equal(group.is_net_inflow,false);
 assert.equal(group.is_exact_trade_value,false);
 assert.match(m.label('半導體業','tse',{now:on('10:08'),marketOpen:true}),/估每分鐘成交額/);
 assert.match(m.label('半導體業','tse',{now:on('10:08'),marketOpen:true}),/非淨買超/);
});
test('a cached quote or identical timestamp never becomes another new trade sample',()=>{
 const m=make();for(const id of ['2330','2303','2454'])m.track(stock(id));
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true});
 assert.equal(m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:00',110)),
   {now:on('10:04'),marketOpen:true}),0);
 assert.equal(m.observe(['2330','2303','2454'].map(id=>quote(id,'10:06:00',180,
   {cached_last_trade:true})),{now:on('10:08'),marketOpen:true}),0);
 assert.equal(m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:true}).ready,false);
});
test('stale, prior day, missing price or unsupported price source cannot be counted',()=>{
 const m=make();['2330','2303','2454'].forEach(id=>m.track(stock(id)));
 assert.equal(m.observe([quote('2330','09:30:00',100)],
   {now:on('10:04'),marketOpen:true}),0);
 assert.equal(m.observe([quote('2330','10:02:00',100,{quote_date:'20261028'})],
   {now:on('10:04'),marketOpen:true}),0);
 assert.equal(m.observe([quote('2330','10:02:00',100,{price:0})],
   {now:on('10:04'),marketOpen:true}),0);
 assert.equal(m.observe([quote('2330','10:02:00',100,{price_source:'indicative_ask'})],
   {now:on('10:04'),marketOpen:true}),0);
 assert.equal(m.observe([quote('2330','10:02:00',100)],
   {now:on('10:04'),marketOpen:false}),0);
});
test('one stock, cross-market symbols or sparse tracked cohort cannot claim group flow',()=>{
 const m=make();m.track(stock('2330','tse'));m.track(stock('2303','tse'));
 m.track(stock('2454','otc'));m.track(stock('3017','tse','電子零組件業'));
 m.observe([quote('2330','10:01:00',100),quote('2303','10:01:00',100),
   quote('2454','10:01:00',100)],{now:on('10:03'),marketOpen:true});
 m.observe([quote('2330','10:05:00',150),quote('2303','10:05:00',150),
   quote('2454','10:05:00',150)],{now:on('10:07'),marketOpen:true});
 assert.equal(m.summarize('半導體業','tse',{now:on('10:07'),marketOpen:true}).ready,false);
 assert.equal(m.summarize('半導體業','otc',{now:on('10:07'),marketOpen:true}).ready,false);
 assert.match(m.label('半導體業','tse',{now:on('10:07'),marketOpen:true}),/樣本不足/);
});
test('volume reset, short quote interval and ten-minute gaps are not valid paired activity',()=>{
 const m=make();for(const id of ['2330','2303','2454'])m.track(stock(id));
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:30',120)),
   {now:on('10:04'),marketOpen:true});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:06:00',50)),
   {now:on('10:08'),marketOpen:true});
 assert.equal(m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:true}).ready,false);
});
test('no persistent quote history or cross-day stale market flow',()=>{
 const m=make();for(const id of ['2330','2303','2454'])m.track(stock(id));
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:06:00',150)),
   {now:on('10:08'),marketOpen:true});
 assert.equal(m.summarize('半導體業','tse',{now:on('10:20'),marketOpen:true}).ready,false);
 assert.equal(m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:false}).ready,false);
});
test('production front end uses only the existing C quote return path',()=>{
 assert.match(ui,/<script src="\.\/sector-c-activity\.js"><\/script>/);
 assert.match(ui,/sectorCActivity\.observe\(quotes\.filter\(q=>q\.cached_last_trade!==true\)/);
 assert.match(ui,/marketOpen:taipeiMarketState\(\)\.open/);
 assert.match(ui,/registerCSectorStock\(item\)/);
 assert.match(ui,/data-sector-industry/);
 assert.match(ui,/data-sector-market/);
 assert.match(ui,/const sectorRotationText = \(industry,market=''\)/);
 assert.match(source,/is_net_inflow:false/);
 assert.match(source,/非淨買超/);
 const start=ui.indexOf('<script>\n    (async()=>{');
 const end=ui.indexOf('</script>',start);
 assert.ok(start>0&&end>start);
 assert.doesNotThrow(()=>new vm.Script(ui.slice(start+'<script>'.length,end),
   {filename:'admin-c-sector.js'}));
});
test('quote monitor itself has no fetch, trading action, Supabase calls or timers',()=>{
 for(const forbidden of [/\bfetch\s*\(/,/\bsetInterval\s*\(/,/\blocalStorage\b/,
   /\bSupabase\b/,/\btrade_order\b/,/scan.bridge/i,/\bsetTimeout\s*\(/])
   assert.doesNotMatch(source,forbidden);
});

test('C active radar stage cannot silently pool previous-stage stocks',()=>{
 const m=make();
 m.track(stock('2330','tse','半導體業'));
 m.track(stock('2303','tse','半導體業'));
 m.track({...stock('2454','tse','半導體業'),stage:'ENTRY'});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true,stage:'LAUNCH'});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:06:00',150)),
   {now:on('10:08'),marketOpen:true,stage:'LAUNCH'});
 const l=m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:true,stage:'LAUNCH'});
 const e=m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:true,stage:'ENTRY'});
 assert.equal(l.ready,false);
 assert.equal(l.total,2);
 assert.equal(e.ready,false);
 assert.equal(e.total,1);
});
test('a six-day-old S reference volume cannot be called a current C pace baseline',()=>{
 const m=make();
 for(const id of ['2330','2303','2454'])m.track({...stock(id),as_of:'2026-10-20'});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true,stage:'LAUNCH'});
 m.observe(['2330','2303','2454'].map(id=>quote(id,'10:06:00',150)),
   {now:on('10:08'),marketOpen:true,stage:'LAUNCH'});
 const v=m.summarize('半導體業','tse',{now:on('10:08'),marketOpen:true,stage:'LAUNCH'});
 assert.equal(v.ready,false);
 assert.equal(v.reason,'missing_verified_S_avg_volume');
});


test('tab remapping resets old trade pairs for an overlapping stock cohort',()=>{
 const m=make(),ids=['2330','2303','2454'];
 for(const id of ids)m.track(stock(id));
 m.observe(ids.map(id=>quote(id,'10:02:00',100)),
   {now:on('10:04'),marketOpen:true,stage:'LAUNCH'});
 m.observe(ids.map(id=>quote(id,'10:06:00',150)),
   {now:on('10:08'),marketOpen:true,stage:'LAUNCH'});
 assert.equal(m.summarize('半導體業','tse',
   {now:on('10:08'),marketOpen:true,stage:'LAUNCH'}).ready,true);
 // Same symbols may occur in two cards/tabs. Earlier tab's paired trades
 // MUST NOT make the freshly opened tab look like it has two new trades.
 for(const id of ids)m.track({...stock(id),stage:'ENTRY'});
 assert.equal(m.summarize('半導體業','tse',
   {now:on('10:08'),marketOpen:true,stage:'ENTRY'}).ready,false);
 m.observe(ids.map(id=>quote(id,'10:09:00',180)),
   {now:on('10:10'),marketOpen:true,stage:'ENTRY'});
 assert.equal(m.summarize('半導體業','tse',
   {now:on('10:10'),marketOpen:true,stage:'ENTRY'}).ready,false);
 m.observe(ids.map(id=>quote(id,'10:12:00',200)),
   {now:on('10:13'),marketOpen:true,stage:'ENTRY'});
 assert.equal(m.summarize('半導體業','tse',
   {now:on('10:13'),marketOpen:true,stage:'ENTRY'}).ready,true);
 for(const id of ids)m.track({...stock(id),stage:'HOLDING'});
 assert.equal(m.summarize('半導體業','tse',
   {now:on('10:13'),marketOpen:true,stage:'HOLDING'}).ready,false);
});

test('a late asynchronous C reply cannot seed a newly selected radar tab',()=>{
 const start=ui.indexOf('window.getLiveQuotes = async items => {');
 const end=ui.indexOf('const HOLDINGS_CACHE_PREFIX',start);
 assert.ok(start>0&&end>start,'C quote function must remain present');
 const quoteFlow=ui.slice(start,end);
 assert.match(quoteFlow,/const observationStage = stage;/);
 assert.match(quoteFlow,/if\(sectorCActivity && stage===observationStage\)/);
 assert.match(quoteFlow,/stage:observationStage/);
 assert.ok(quoteFlow.indexOf('const observationStage = stage;')
   <quoteFlow.indexOf('await Promise.all(chunks.map'),
   'capture tab before the C network operation');
 assert.ok(quoteFlow.indexOf('if(sectorCActivity && stage===observationStage)')
   <quoteFlow.indexOf('sectorCActivity.observe('),
   'discard late old-tab quote pairs before recording samples');
});

test('C/S sector observation is visible without expanding compact cards in all three radar tabs',()=>{
 assert.match(source,/C盤中族群成交活躍度/);
 const portions=[
   ['ENTRY', 'const entryCompactStock =', 'const entryBucketHtml='],
   ['LAUNCH', 'const launchMiniHtml =', 'const launchListHtml ='],
   ['HOLDING', 'const holdingMiniHtml =', 'const holdingPlaceholderHtml =']
 ];
 for(const [stage,startText,endText] of portions){
   const start=ui.indexOf(startText),end=ui.indexOf(endText,start);
   assert.ok(start>=0&&end>start,stage+' compact card exists');
   const compact=ui.slice(start,end);
   assert.match(compact,/sectorRotationCompactHtml\(item/,stage+' summary displays C/S sector status');
   assert.ok(compact.indexOf('sectorRotationCompactHtml(item') <
       compact.indexOf('</summary>'),stage+' C/S status must be in visible summary');
 }
 assert.match(ui,/const sectorRotationCompactHtml=\(item,style='radar-compact-next'\)/);
 assert.match(ui,/data-sector-industry/);
 assert.match(ui,/data-sector-market/);
 assert.match(ui,/\.radar-compact-next\.sector-compact/);
 assert.match(ui,/return live\+eod/);
});

test('historical scout cards receive today-only verified C trades without becoming buy signals',()=>{
 const historicStart=ui.indexOf('const scoutHistoryQuoteTargets=');
 const historicEnd=ui.indexOf('const renderScoutPanel=',historicStart);
 assert.ok(historicStart>=0&&historicEnd>historicStart);
 const historic=ui.slice(historicStart,historicEnd);
 assert.match(historic,/scoutOnlyLaunchRows\(\)/);
 assert.match(historic,/const scoutHistoryTodayTrade=id=>/);
 assert.match(historic,/validTodayQuote\(quote\)\?quote:null/);
 assert.match(historic,/liveQuoteCache\.get\(String\(id\|\|''\)\)/);
 assert.match(historic,/C 今日有效成交待取得/);
 assert.match(historic,/S 歷史收盤（非即時）/);
 assert.match(historic,/尚非買點|禁止追高|非目前買點/);
 const quoteStart=ui.indexOf('async function refreshSimpleQuotes()');
 const quoteEnd=ui.indexOf('const v5MonitorState',quoteStart);
 assert.ok(quoteStart>=0&&quoteEnd>quoteStart);
 const quoteFlow=ui.slice(quoteStart,quoteEnd);
 assert.match(quoteFlow,/\.\.\.scoutHistoryQuoteTargets\(\)/);
 assert.match(quoteFlow,/const payload = await window\.getLiveQuotes\(quoteTargets\)/);
 assert.match(quoteFlow,/new Set\(quoteTargets\.map/);
 assert.doesNotMatch(historic,/\bfetch\s*\(|\bsetInterval\s*\(|\bauditSignalObserved\s*\(/);
 // The only preexisting C quote reader still handles all symbols and keeps
 // the 30-stock-per-batch limit and the old 150-second cache reuse intact.
 assert.match(ui,/for \(let i = 0; i < pending.length; i \+= 30\)/);
 assert.match(ui,/const LIVE_QUOTE_REUSE_MS = 150000/);
});

test('late account-scoped scout cloud rows receive C price without waiting for S cards',()=>{
 const cloudStart=ui.indexOf('const refreshScoutCloud=async(force=false)=>');
 const cloudEnd=ui.indexOf('const ingestScoutObservations=',cloudStart);
 assert.ok(cloudStart>=0&&cloudEnd>cloudStart);
 const cloud=ui.slice(cloudStart,cloudEnd);
 assert.match(cloud,/scoutOnlyLaunchRows\(\)\.some\(x=>/);
 assert.match(cloud,/!liveQuoteRequestAt\.has\(String\(x\.stock_id\|\|''\)\)/);
 assert.match(cloud,/void refreshSimpleQuotes\(\)/);
 const loadStart=ui.indexOf('async function load()');
 const loadEnd=ui.indexOf('const v5MonitorState',loadStart);
 const loading=ui.slice(loadStart,loadEnd);
 assert.match(loading,/if \(stage === 'LAUNCH'\) \{\s*liveBasePicks = rankedPicks\.slice\(0,100\)/);
 assert.match(loading,/liveTimer = setInterval\(\(\) => \{/);
 assert.match(loading,/\}, 180000\);/);
 const refreshStart=ui.indexOf('async function refreshSimpleQuotes()');
 const refreshEnd=ui.indexOf('const v5MonitorState',refreshStart);
 const refresh=ui.slice(refreshStart,refreshEnd);
 assert.match(refresh,/rows\.length\|\|scoutOnlyLaunchRows\(\)\.length/);
 assert.match(refresh,/\.\.\.scoutHistoryQuoteTargets\(\)/);
 assert.match(refresh,/const payload = await window\.getLiveQuotes\(quoteTargets\)/);
 // The server-side S scan and user holding risk must remain separate.
 assert.doesNotMatch(cloud,/scanBatch\(|fetchLiveQuoteChunk\(|setInterval\(/);
 assert.match(ui,/const LIVE_QUOTE_REUSE_MS = 150000/);
});

test('an account scout C quote is displayed only for validated same-day trades',()=>{
 const start=ui.indexOf('const scoutMarketAttempt=new Map()');
 const end=ui.indexOf('const launchScoutOnlyHtml=',start);
 assert.ok(start>=0&&end>start);
 const cache=new Map();
 const rows=()=>[{stock_id:'5392'},{stock_id:'3293'}];
 const fn=new Function('scoutOnlyLaunchRows','liveQuoteCache','marketBridgeReady','stage',
   'validTodayQuote',ui.slice(start,end)+
   '\nreturn {scoutHistoryQuoteTargets,scoutHistoryTodayTrade};');
 const valid=q=>q?.has_today_trade===true&&q?.quote_date==='20261029'&&Number(q?.price)>0;
 const sut=fn(rows,cache,()=>true,'LAUNCH',valid);
 assert.deepEqual(sut.scoutHistoryQuoteTargets().map(x=>x.market),['tse','tse']);
 assert.equal(sut.scoutHistoryTodayTrade('5392'),null);
 assert.deepEqual(sut.scoutHistoryQuoteTargets().map(x=>x.market),['otc','otc']);
 const trade={stock_id:'5392',quote_date:'20261029',has_today_trade:true,price:38.7,
   quote_time:'12:44:00',market:'tse'};
 cache.set('5392',trade);
 assert.equal(sut.scoutHistoryTodayTrade('5392')?.price,38.7);
 cache.set('5392',{...trade,quote_date:'20261028'});
 assert.equal(sut.scoutHistoryTodayTrade('5392'),null);
 assert.equal(sut.scoutHistoryQuoteTargets()[0].market,'tse');
});

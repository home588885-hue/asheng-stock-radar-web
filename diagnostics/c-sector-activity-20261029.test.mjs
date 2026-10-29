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
const stock=(id,market='tse',industry='半導體業')=>({stock_id:id,market,industry,avg_volume_20_lots:540});
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
 assert.match(ui,/is_net_inflow:false|非淨買超/);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const admin=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
test('holding page JS parses without execution',()=>{
 const start=admin.indexOf('(async()=>{',admin.indexOf("const SUPABASE_URL"));
 const opening=admin.lastIndexOf('<script',start);
 const scriptStart=admin.indexOf('>',opening)+1;
 const end=admin.indexOf('</script>',start);
 assert.ok(start>0&&end>start);
 assert.doesNotThrow(()=>new vm.Script(admin.slice(scriptStart,end),{filename:'admin-main-script.js'}));
});
test('peak endpoint is optional and not a scan, has JWT, only when holding tab open',()=>{
 assert.match(admin,/const VERIFIED_PEAK_API = SHARED_DATA_HUB \+ '\/asheng-holding-peak'/);
 assert.match(admin,/authClient\.auth\.getSession\(\)/);
 assert.match(admin,/Authorization:'Bearer '\+memberSession\.access_token/);
 assert.match(admin,/if\(taipeiMarketState\(\)\.open&&cQuoteReadWindow\(\)\)/);
 assert.match(admin,/symbols\.slice\(i,i\+30\)/);
 assert.match(admin,/refreshVerifiedPeakEvidence\(symbols\)/);
});
test('server peak is account-bound and cannot be interpreted as complete purchase history',()=>{
 assert.match(admin,/_verified_observed_peak/);
 assert.match(admin,/remote\.history_complete===false/);
 assert.match(admin,/remoteAt>=Date\.parse\(String\(holding\.bought_at/);
 assert.match(admin,/remoteAt<=observedAt\+120000/);
 assert.match(admin,/const peak=Math\.max\(price,serverPeak,durablePeak/);
});
test('lack of remote peak API does not block existing holdings or overwrite portfolio',()=>{
 assert.match(admin,/catch\(error\)\{[\s\S]*?optional verified-peak lane may be temporarily unavailable/);
 assert.match(admin,/if\(!changed\|\|!holdingStillCurrent\(\)\)return/);
 assert.doesNotMatch(admin,/autoTrade|placeBrokerOrder/);
});

test('verified peak watch accepts TWSE quote clocks and YYYYMMDD dates',()=>{
 const line=admin.split('\n').find(row=>row.includes('const quoteTimeParts='));
 assert.ok(line,'expected quote-time parse must exist');
 const literal=line.slice(line.indexOf('=')+1,line.indexOf('.exec(')).trim();
 const clock=vm.runInNewContext('('+literal+')');
 assert.equal(clock.test('10:12:20'),true);
 assert.equal(clock.test('10:12'),true);
 assert.equal(clock.test('bad clock'),false);
 assert.equal(clock.test('10:12:99'),false);
 assert.ok(admin.includes(String.raw`/^\d{8}$/`),'quote date must be 8-digit, not a literal backslash');
 assert.equal(admin.includes(String.raw`/^\\d{8}$/`),false,
   'double-escaped date regex silently discards all verified server peaks');
 const stamp='2026-10-29T10:12:20+08:00';
 assert.equal(new Date(stamp).toISOString(),'2026-10-29T02:12:20.000Z');
});


test('verified C post-entry +2% peak can warn after half the gain is given back',()=>{
 const start=admin.indexOf('const HOLDING_PROFIT_GUARD_PREFIX =');
 const end=admin.indexOf('const HOLDING_RISK_VERSION=',start);
 assert.ok(start>=0&&end>start);
 const src=admin.slice(start,end);
 const mem=new Map(),localStorage={
   getItem:key=>mem.get(key)||null,
   setItem:(key,value)=>mem.set(key,value)
 };
 const h={avg_cost:100,bought_at:'2026-10-22T09:45:00+08:00'};
 const rows=new Map([['2504',h]]);
 const fn=new Function('holdings','portfolioId','todayQuoteDate',
   'validTodayQuote','marketFraction','localStorage',src+
   '\nreturn holdingProfitProtection;');
 const check=fn(rows,'account-1',()=> '20261029',
   q=>!!q&&q.has_today_trade===true&&q.quote_date==='20261029',
   ()=>.5,localStorage);
 const item={stock_id:'2504',as_of:'2026-10-28',
   metrics:{close:101,ma5:101.8,ma10:101.5,prev_close:102,
     avg_volume_20_lots:1500,holding_management:{}}};
 const quote=(price,quote_time)=>({
   price,quote_date:'20261029',quote_time,has_today_trade:true,
   volume_lots:1200,prev_close:102
 });
 assert.equal(check(item,quote(103,'10:05:00')).earlyGiveback,false);
 const gaveBack=check(item,quote(101,'10:11:00'));
 assert.equal(gaveBack.earlyGiveback,true);
 assert.equal(gaveBack.shortMaWeak,true);
 assert.equal(gaveBack.maxGain,3);
 assert.equal(gaveBack.currentGain,1);
 assert.equal(gaveBack.observedDate,'2026-10-29');
 assert.equal(gaveBack.armed,false); // B's +20% trailing remains separate
 assert.equal(gaveBack.triggered,false);
 // Prior versions stored YYYYMMDD. A later S snapshot must not be blocked
 // by a lexicographically incomparable observation date.
 const key=[...mem.keys()][0],prev=JSON.parse(mem.get(key));
 mem.set(key,JSON.stringify({...prev,lastDate:'20261028'}));
 assert.ok(check(item,quote(101,'10:12:00')),'old date can be read');
 // A new position with a different cost must not inherit old gain or warning.
 rows.set('2504',{...h,avg_cost:105});
 const restarted=check(item,quote(101,'10:13:00'));
 assert.equal(restarted.maxGain<0,true);
 assert.equal(restarted.earlyGiveback,false);
});

test('observed profit warning cannot replace hard stop or +20% trailing exit',()=>{
 const start=admin.indexOf('const holdingBDecision=(item,quote=null)=>');
 const end=admin.indexOf('const actionDecision =',start);
 assert.ok(start>0&&end>start);
 const src=admin.slice(start,end);
 let risk={stopHard:false,confirmed:true,lossWarning:false,cost:100,price:101,pnl:1};
 let trail={armed:false,triggered:false,live:true,earlyGiveback:true,
   shortMaWeak:true,ma5Broken:true,ma10Broken:true,highestPrice:103,
   maxGain:3,currentGain:1,price:101,source:'C今日有效成交'};
 const evalDecision=new Function('holdingRiskPlan','holdingProfitProtection',
   'quoteRecentForDisplay','expectedSignalDataDate','num',
   src+'\nreturn holdingBDecision;')(
     ()=>risk,()=>trail,()=>true,()=> '2026-10-28',
     (n,p)=>Number(n).toFixed(p??2)
   );
 const item={stock_id:'2504',as_of:'2026-10-28',metrics:{}};
 assert.equal(evalDecision(item,{price:101}).kind,'profit_giveback_watch');
 assert.match(evalDecision(item,{price:101}).detail,/僅觀察警示，非B方案出場條件/);
 risk={...risk,stopHard:true,price:89};
 assert.equal(evalDecision(item,{price:89}).kind,'exit');
 risk={...risk,stopHard:false,price:111};trail={...trail,triggered:true};
 assert.equal(evalDecision(item,{price:111}).kind,'exit');
 trail={...trail,triggered:false};
 const staleDecision=new Function('holdingRiskPlan','holdingProfitProtection',
   'quoteRecentForDisplay','expectedSignalDataDate','num',
   src+'\nreturn holdingBDecision;')(
     ()=>risk,()=>trail,()=>false,()=> '2026-10-28',
     (n,p)=>Number(n).toFixed(p??2));
 assert.notEqual(staleDecision(item,{price:101}).kind,'profit_giveback_watch');
 assert.match(admin,/bDecision\.kind==='profit_giveback_watch'\s*\?bDecision\.title/);
 assert.match(admin,/獲利回吐／短均線轉弱/);
});

test('entry ready card displays missing C, signed model and trial quality without unlocking',()=>{
 const start=admin.indexOf('const entryTrialGapNote=(item,quote,action)=>');
 const end=admin.indexOf('const entryExpandedIds =',start);
 assert.ok(start>=0&&end>start);
 let fresh=false,trial=false;
 const helper=new Function('expectedSignalDataDate','unifiedRadarGeneration',
   'chaseModelReady','validTodayQuote','quoteFreshForTrial',
   'bottomFirstQuality',
   admin.slice(start,end)+'\nreturn entryTrialGapNote;')(
     ()=> '2026-10-28',()=>true,()=>true,q=>!!q&&q.valid===true,
     ()=>fresh,()=>({trial,reasons:['盤中量價未確認','模型仍接近支撐']})
   );
 const item={stock_id:'3062',score:64,as_of:'2026-10-28',
   metrics:{trade_lifecycle:{entry:{state:'starter'}}}};
 assert.match(helper({...item,as_of:'2026-10-27'},null,{}),/最新簽名日K/);
 assert.match(helper(item,null,{}),/缺當日有效C成交/);
 assert.match(helper(item,{valid:true,price:23},{}),/超過5分鐘/);
 fresh=true;
 const note=helper(item,{valid:true,price:23},{phase:'candidate'});
 assert.match(note,/盤中量價未確認/);
 assert.match(note,/MA10先手路線未達75分/);
 assert.match(helper(item,{valid:true},{phase:'trial',trialable:true}),/已驗證/);
 assert.match(helper(item,{valid:true},{phase:'blocked'}),/不可試單/);
 assert.match(admin,/entryGapNote=entryTrialGapNote/);
 assert.match(admin,/｜\$\{esc\(entryGapNote\)\}/);
 assert.match(admin,/formalEntryValidation\.enabled&&m\.v5\?\.entry_confirmed===true/);
});

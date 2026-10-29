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

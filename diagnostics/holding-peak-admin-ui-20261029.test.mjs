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

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../supabase/functions/asheng-holding-peak/index.ts',import.meta.url),'utf8');
const migration=readFileSync(new URL('../supabase/migrations/20261029_asheng_verified_holding_peaks.sql',import.meta.url),'utf8');
test('only verified user owns the source holding; no arbitrary portfolio input',()=>{
 assert.match(src,/userClient\.auth\.getUser\(\)/);
 assert.match(src,/\.eq\('user_id',user\.id\)/);
 assert.match(src,/membership_required/);
 assert.match(src,/held\.has\(id\)/);
 assert.doesNotMatch(src,/body\?\.portfolio_id/);
});
test('server never accepts client supplied price/peak or paid scanner API',()=>{
 assert.doesNotMatch(src,/body\?\.(price|high|peak|cost)/);
 assert.match(src,/mis\.twse\.com\.tw\/stock\/api\/getStockInfo\.jsp/);
 assert.doesNotMatch(src,/\/functions\/v1\/asheng-scan-bridge|api\.finmindtrade\.com|scan_now\s*\(/i);
});
test('quote proof required before RPC write',()=>{
 assert.match(src,/verifiedTwsePeak\(q,holding,now\)/);
 assert.match(src,/if\(!evidence\.ok\)/);
 assert.match(src,/asheng_upsert_verified_holding_peak/);
 assert.match(src,/p_user_id:user\.id/);
});
test('data read is scoped to authenticated user, not portfolio identifier',()=>{
 assert.match(src,/eq\('user_id',user\.id\)/);
 assert.match(src,/samePosition\(pos,state\)/);
 assert.match(src,/history_complete:false/);
});
test('migration restricts user mutations and makes observations monotone',()=>{
 assert.match(migration,/enable row level security/i);
 assert.match(migration,/grant select on table public\.asheng_holding_verified_peaks to authenticated/i);
 assert.doesNotMatch(migration,/grant (update|insert|delete).*to authenticated/i);
 assert.match(migration,/revoke all on function.*[\s\S]*from public,anon,authenticated/i);
 assert.match(migration,/greatest\(public\.asheng_holding_verified_peaks\.peak_price,excluded\.peak_price\)/i);
 assert.match(migration,/excluded\.position_updated_at>public\.asheng_holding_verified_peaks\.position_updated_at/);
 assert.match(migration,/security invoker/i);
});

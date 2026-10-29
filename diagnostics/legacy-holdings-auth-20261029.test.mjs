import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src=readFileSync(new URL('../supabase/functions/spring-swallow-holdings/index.ts', import.meta.url),'utf8');
const handlerStart=src.indexOf('Deno.serve(async(req)=>');
const userValidated=src.indexOf('await client.auth.getUser()',handlerStart);
const memberValidated=src.indexOf('.from(\'radar_memberships\')',handlerStart);
const adminChecked=src.indexOf("member?.role!=='admin'",handlerStart);
const get=src.indexOf("if(req.method==='GET')",handlerStart);
const post=src.indexOf("if(req.method!=='POST')",handlerStart);

test('legacy HTTP route requires verified user and admin membership before read/write routes',()=>{
  assert.ok(handlerStart>=0 && userValidated>handlerStart);
  assert.ok(memberValidated>userValidated);
  assert.ok(adminChecked>memberValidated);
  assert.ok(get>adminChecked && post>get);
});
test('deny missing/malformed authorization',()=>{
  assert.match(src,/req\.headers\.get\('Authorization'\)/);
  assert.match(src,/if \(!\/\^Bearer\\s\+\[\^\\s\]\+\$\/\.test\(bearer\)\) return out\(\{ok:false,error:'unauthorized'\},401\)/);
});
test('reject absent admin portfolio configuration',()=>{
  assert.match(src,/ASHENG_ADMIN_PORTFOLIO_ID/);
  assert.match(src,/legacy_endpoint_not_configured/);
  assert.ok(src.indexOf('legacy_endpoint_not_configured')<get);
});
test('GET and POST both enforce identical server-configured portfolio',()=>{
  assert.match(src,/if \(p!==allowedPortfolio\) return out\(\{ok:false,error:'forbidden_portfolio'\},403\)/);
  assert.match(src,/if \(p !== allowedPortfolio\) return out\(\{ok:false,error:'forbidden_portfolio'\},403\)/);
});
test('server does not expose hard-coded production portfolio identifiers',()=>{
  assert.doesNotMatch(src,/d092f22e-9d7a-408a-8e8b-4c95e31e3a10/i);
  assert.doesNotMatch(src,/supabase_secret_\w+/);
});
test('preflight is harmless and allows Authorization header',()=>{
  assert.match(src,/req\.method==='OPTIONS'/);
  assert.match(src,/Access-Control-Allow-Headers':'authorization,apikey,content-type'/);
});

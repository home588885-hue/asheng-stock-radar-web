import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
const H={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'};
function out(x:any,s=200){return new Response(JSON.stringify(x),{status:s,headers:H})}
async function db(path:string,opts:any={}){const url=Deno.env.get('SUPABASE_URL')!;const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;return fetch(`${url}/rest/v1/${path}`,{...opts,headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(opts.headers||{})}})}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const symbol=/^[0-9A-Z.-]{2,12}$/;
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:H});
  // Defense in depth: this legacy handler must never trust portfolio_id alone.
  // Main admin.html uses the authenticated asheng-member-api instead.
  const bearer = String(req.headers.get('Authorization') || '');
  if (!/^Bearer\\s+[^\\s]+$/.test(bearer)) return out({ok:false,error:'unauthorized'},401);
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const url = Deno.env.get('SUPABASE_URL') || '';
  const allowedPortfolio = Deno.env.get('ASHENG_ADMIN_PORTFOLIO_ID') || '';
  if (!url || !anon || !uuid.test(allowedPortfolio))
    return out({ok:false,error:'legacy_endpoint_not_configured'},503);
  const client = createClient(url,anon,{
    global:{headers:{Authorization:bearer}},
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data:userData,error:userError}=await client.auth.getUser();
  const user=userData?.user;
  if (userError || !user?.id) return out({ok:false,error:'unauthorized'},401);
  const {data:member,error:memberError}=await client.from('radar_memberships')
    .select('role,status').eq('user_id',user.id).maybeSingle();
  if (memberError) return out({ok:false,error:'auth_check_failed'},503);
  if (member?.role!=='admin') return out({ok:false,error:'forbidden'},403);
  const requestedPortfolio=(req.method==='GET'
    ? new URL(req.url).searchParams.get('portfolio_id')
    : null);
  if (requestedPortfolio && requestedPortfolio!==allowedPortfolio)
    return out({ok:false,error:'forbidden_portfolio'},403);
  if(req.method==='GET'){
    const u=new URL(req.url);const p=(u.searchParams.get('portfolio_id')||'').trim();
    if(!uuid.test(p))return out({ok:false,error:'invalid portfolio'},400);
    if (p!==allowedPortfolio) return out({ok:false,error:'forbidden_portfolio'},403);
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),2500);
    try{
      const r=await db(`spring_swallow_holdings?select=stock_id,avg_cost,quantity,bought_at,updated_at&portfolio_id=eq.${encodeURIComponent(p)}&active=eq.true&order=updated_at.desc`,{signal:controller.signal});
      if(!r.ok)return out({ok:false,error:'holdings read failed'},500);
      return out({ok:true,holdings:await r.json()});
    }catch(e){
      return out({ok:false,error:'holdings read timeout'},503);
    }finally{
      clearTimeout(timer);
    }
  }
  if(req.method!=='POST')return out({ok:false,error:'method not allowed'},405);
  let body:any;try{body=await req.json()}catch{return out({ok:false,error:'invalid json'},400)}
  const p=String(body?.portfolio_id||'').trim();const s=String(body?.stock_id||'').trim().toUpperCase();const action=String(body?.action||'buy');
  if (p !== allowedPortfolio) return out({ok:false,error:'forbidden_portfolio'},403);
  if(!uuid.test(p)||!symbol.test(s))return out({ok:false,error:'invalid input'},400);
  if(action==='sell'){
    const r=await db(`spring_swallow_holdings?portfolio_id=eq.${encodeURIComponent(p)}&stock_id=eq.${encodeURIComponent(s)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({active:false,sold_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    if(!r.ok)return out({ok:false,error:'sell update failed'},500);
    return out({ok:true,holding:(await r.json())[0]||null});
  }
  const avg=Number(body?.avg_cost),qty=Math.trunc(Number(body?.quantity));
  if(!Number.isFinite(avg)||avg<=0||!Number.isFinite(qty)||qty<=0||qty>100000000)return out({ok:false,error:'invalid cost or quantity'},400);
  const mr=await db(`spring_swallow_stock_master?select=stock_id&stock_id=eq.${encodeURIComponent(s)}&active=eq.true&limit=1`);
  if(!mr.ok||!(await mr.json()).length)return out({ok:false,error:'stock not found'},404);
  const row={portfolio_id:p,stock_id:s,avg_cost:avg,quantity:qty,active:true,sold_at:null,updated_at:new Date().toISOString()};
  const r=await db('spring_swallow_holdings?on_conflict=portfolio_id,stock_id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=representation'},body:JSON.stringify(row)});
  if(!r.ok)return out({ok:false,error:'holding save failed'},500);
  return out({ok:true,holding:(await r.json())[0]||row});
});
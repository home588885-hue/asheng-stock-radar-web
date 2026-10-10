/**
 * 阿勝底部起漲雷達 | Independent Cloudflare Worker, server-authenticated quotes.
 * Only an authenticated admin can request quotes. Existing Supabase model services are unchanged.
 * No Supabase calls, user holdings, credentials, or model algorithms are included.
 */
const ALLOWED_ORIGINS = new Set([
  "https://home588885-hue.github.io"
]);
function makeHeaders(origin) {
  const h = new Headers({
    "Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    "Vary":"Origin"
  });
  if (ALLOWED_ORIGINS.has(origin)) {
    h.set("Access-Control-Allow-Origin",origin);
    h.set("Access-Control-Allow-Methods","GET,OPTIONS");
    h.set("Access-Control-Allow-Headers","Content-Type,Authorization");
  }
  return h;
}
function json(value,status,origin) {
  return new Response(JSON.stringify(value),{
    status,headers:makeHeaders(origin)
  });
}

/** Compatibility adapter from the existing Supabase asheng-live-quotes v18.
 * Validate existing Supabase admin sessions; do not touch scanner or holdings.
 */
const finitePositive = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const taipeiDay = () => new Intl.DateTimeFormat("en-CA", {
  timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date()).replace(/[^0-9]/g,"");
function parseSymbols(raw) {
  if (typeof raw !== "string" || raw.length > 320) return null;
  const values=raw.split(",").map(v=>v.trim()).filter(Boolean);
  if (!values.length || values.length>30) return null;
  const seen=new Set();
  const items=[];
  for (const item of values) {
    const match=/^([0-9A-Za-z]{3,8})(?::(tse|otc|tpex))?$/i.exec(item);
    if (!match) return null;
    const id=match[1].toUpperCase();
    const market=match[2]?.toLowerCase()==="otc" || match[2]?.toLowerCase()==="tpex" ? "otc" : "tse";
    const key=market+"_"+id;
    if (!seen.has(key)) { seen.add(key); items.push({id,market}); }
  }
  return items;
}
async function readTwseQuotes(items) {
  const ex=items.map(s=>s.market+"_"+s.id+".tw").join("|");
  const target="https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch="
    +encodeURIComponent(ex)+"&json=1&delay=0&_="+Date.now();
  const response=await fetch(target,{
    headers:{"Accept":"application/json,text/plain,*/*"},
    signal:AbortSignal.timeout(9000)
  });
  if (!response.ok) throw new Error("upstream_http_"+response.status);
  const payload=await response.json();
  if (!Array.isArray(payload?.msgArray)) throw new Error("upstream_invalid_payload");
  const today=taipeiDay();
  const allowed=new Set(items.map(s=>s.id));
  const quotes=payload.msgArray.map(q=>{
    const stockId=String(q.c||"").trim().toUpperCase();
    const d=String(q.d||"").replace(/[^0-9]/g,"");
    const z=finitePositive(q.z),v=finitePositive(q.v);
    // Last trade ONLY. Bid/ask must not be represented as a completed trade.
    const hasTodayTrade=d===today && z!==null && v!==null;
    return {
      stock_id:stockId,stock_name:String(q.n||""),market:String(q.ex||""),
      price:hasTodayTrade?z:null,prev_close:finitePositive(q.y),
      open:finitePositive(q.o),high:finitePositive(q.h),low:finitePositive(q.l),
      volume_lots:v,quote_date:d,quote_time:String(q.t||""),
      has_today_trade:hasTodayTrade,price_source:hasTodayTrade?"mis_last_trade":null
    };
  }).filter(q=>allowed.has(q.stock_id));
  return {ok:true,source:"TWSE MIS",today,quotes};
}


const MEMBER_API_ME = "https://qexbtubfoyfsllaiecvv.supabase.co/functions/v1/asheng-member-api?action=me";
const checkedAdmins = new Map();
const ADMIN_CACHE_MS = 5 * 60 * 1000;
// The visitor's Supabase bearer token is verified by the existing admin API.
// No admin password, server secret or service-role key is embedded in the browser.
async function isAuthenticatedAdmin(request) {
  const auth = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(auth);
  if (!match) return false;
  const token = match[1];
  let expiresAt = Date.now() + ADMIN_CACHE_MS;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const claims = JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));
    if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now() + 10000) return false;
    expiresAt = Math.min(expiresAt, claims.exp*1000 - 10000);
  } catch { return false; }
  const data = new TextEncoder().encode(token);
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256",data))]
    .map(n=>n.toString(16).padStart(2,"0")).join("");
  const cached = checkedAdmins.get(digest);
  if (cached && cached > Date.now()) return true;
  try {
    const response = await fetch(MEMBER_API_ME, {
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return false;
    const result = await response.json();
    const allowed = result?.ok === true &&
      result?.membership?.role === "admin" && result?.access?.active === true;
    if (!allowed) return false;
    if (checkedAdmins.size >= 128) {
      for(const [key,time] of checkedAdmins) if(time <= Date.now()) checkedAdmins.delete(key);
      if(checkedAdmins.size >= 128) checkedAdmins.delete(checkedAdmins.keys().next().value);
    }
    checkedAdmins.set(digest,expiresAt);
    return true;
  } catch { return false; }
}

export default {
  async fetch(request, env) {
    const url=new URL(request.url);
    const origin=request.headers.get("Origin")||"";
    if (request.method==="OPTIONS") {
      if (!ALLOWED_ORIGINS.has(origin)) return new Response(null,{status:403});
      return new Response(null,{status:204,headers:makeHeaders(origin)});
    }
    if(request.method!=="GET") return json({ok:false,error:"method_not_allowed"},405,origin);
    if(url.pathname==="/"||url.pathname==="/health") {
      return json({
        ok:true,
        service:"asheng-market-bridge",
        status:"quote_route_configured",
        deployment_marker:"admin-auth-market-bridge-20261010",
        source:"TWSE MIS",
        twse_mis_enabled:true,
        supabase_requests:0,
        note:"/quotes 僅限已登入且已開通管理員，驗證沿用既有帳號，不使用公開金鑰"
      },200,origin);
    }
    if(url.pathname==="/quotes") {
      if (!(await isAuthenticatedAdmin(request))) {
        return json({ok:false,error:"admin_auth_required",quotes:[]},401,origin);
      }
      const items=parseSymbols(url.searchParams.get("symbols")||"");
      if (!items) return json({ok:false,error:"invalid_symbols",quotes:[]},400,origin);
      try {
        return json(await readTwseQuotes(items),200,origin);
      } catch {
        return json({ok:false,error:"upstream_unavailable",quotes:[]},502,origin);
      }
    }
    return json({ok:false,error:"not_found"},404,origin);
  }
};

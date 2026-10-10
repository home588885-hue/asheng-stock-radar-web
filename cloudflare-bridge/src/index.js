/**
 * 阿勝底部起漲雷達 | Independent Cloudflare Worker, server-authenticated quotes.
 * TWSE quotation retrieval is available only after verifying the server-to-server access key.
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
    h.set("Access-Control-Allow-Headers","Content-Type");
  }
  return h;
}
function json(value,status,origin) {
  return new Response(JSON.stringify(value),{
    status,headers:makeHeaders(origin)
  });
}

/** Compatibility adapter from the existing Supabase asheng-live-quotes v18.
 * Keep a private server-to-server access key. Do not touch scanner or holdings.
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
        deployment_marker:"bridge-quote-gate-off-20261010",
        source:"TWSE MIS",
        twse_mis_enabled:true,
        supabase_requests:0,
        note:"/quotes 已移除額外授權開關；仍須設定 BRIDGE_SERVER_KEY，且不對公開網頁暴露金鑰"
      },200,origin);
    }
    if(url.pathname==="/quotes") {
      // Never put BRIDGE_SERVER_KEY in a GitHub Pages / browser application.
      // Server-to-server staging only; admin browser auth is a separate gated step.
      const key=env?.BRIDGE_SERVER_KEY;
      if (!key || request.headers.get("x-bridge-server-key")!==key) {
        return json({ok:false,error:"server_auth_required",quotes:[]},401,origin);
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

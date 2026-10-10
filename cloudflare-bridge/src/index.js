/**
 * 阿勝底部起漲雷達 | Independent Cloudflare Worker (permission-safe staging).
 * This service does NOT access TWSE MIS until programmatic use is authorized.
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
export default {
  async fetch(request) {
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
        status:"standby",
        source:"none",
        twse_mis_enabled:false,
        supabase_requests:0,
        note:"行情來源授權未確認，僅開放健康檢查"
      },200,origin);
    }
    if(url.pathname==="/quotes") {
      return json({
        ok:false,
        error:"market_data_authorization_pending",
        quotes:[],
        note:"TWSE MIS 個人程式化存取許可尚未獲核准，不執行任何行情抓取"
      },503,origin);
    }
    return json({ok:false,error:"not_found"},404,origin);
  }
};

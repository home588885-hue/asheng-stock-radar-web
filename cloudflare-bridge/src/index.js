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
    // TWSE MIS sometimes leaves top-level z="-" despite a real matched trade
    // in trade.z. Both fields are transaction prices, never bid/ask estimates.
    const directTrade=finitePositive(q.z);
    const nestedTrade=finitePositive(q?.trade?.z);
    const tradePrice=directTrade ?? nestedTrade;
    const v=finitePositive(q.v); // cumulative market volume, not trade.v (single print)
    const tradeTime=directTrade!==null ? String(q.t||"") : String(q?.trade?.t||q.t||"");
    const hasTodayTrade=d===today && tradePrice!==null && v!==null && /^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(tradeTime);
    return {
      stock_id:stockId,stock_name:String(q.n||""),market:String(q.ex||""),
      price:hasTodayTrade?tradePrice:null,prev_close:finitePositive(q.y),
      open:finitePositive(q.o),high:finitePositive(q.h),low:finitePositive(q.l),
      volume_lots:v,quote_date:d,quote_time:hasTodayTrade?tradeTime:String(q.t||""),
      has_today_trade:hasTodayTrade,
      price_source:hasTodayTrade ? (directTrade!==null?"mis_last_trade":"mis_trade_last") : null
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


/**
 * 盤後純觀察型初篩（獨立測試，與正式模型沒有任何資料寫入）。
 * 每次只查一個市場的官方最新交易日批量開放資料。
 * 僅檢查股價、成交量等「廉價價量初篩」，絕不宣稱 MA10/20/60 已完成。
 * 無 Cron、無 Supabase 掃描請求、無持股資料讀寫。
 */
const BULK_EOD_FEEDS = Object.freeze({
  tse: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  otc: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
});
function parseRocDay(value) {
  const digits=String(value ?? "").trim().replace(/[^0-9]/g,"");
  const m=/^(\d{3})(\d{2})(\d{2})$/.exec(digits);
  if(!m) return null;
  const year=Number(m[1])+1911,month=Number(m[2]),day=Number(m[3]);
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()+1!==month||d.getUTCDate()!==day)return null;
  return year+"-"+m[2]+"-"+m[3];
}
function marketNum(raw) {
  const v=String(raw ?? "").replace(/,/g,"").trim();
  if(!v||v==="--"||v==="---")return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function normalizeBulkEod(row,market) {
  const code=String(market==="tse"?row.Code:row.SecuritiesCompanyCode ?? "").trim();
  // Exclude ETFs, structured products and warrants; no assumption they are ordinary shares.
  if(!/^[1-9][0-9]{3}$/.test(code))return null;
  const tradeDay=parseRocDay(row.Date);
  const close=marketNum(market==="tse"?row.ClosingPrice:row.Close);
  const open=marketNum(market==="tse"?row.OpeningPrice:row.Open);
  const high=marketNum(market==="tse"?row.HighestPrice:row.High);
  const low=marketNum(market==="tse"?row.LowestPrice:row.Low);
  const shares=marketNum(market==="tse"?row.TradeVolume:row.TradingShares);
  if(!tradeDay||!(close>0)||!(open>0)||!(shares>=0))return null;
  const volumeLots=Math.floor(shares/1000);
  return {
    stock_id:code,stock_name:String(market==="tse"?row.Name:row.CompanyName ?? "").trim(),
    market,source_date:tradeDay,open,close,high,low,volume_lots:volumeLots,
    day_change_pct:Math.round((close/open-1)*10000)/100
  };
}
async function readDailyPrefilter(request,market) {
  const feed=BULK_EOD_FEEDS[market];
  if(!feed)throw new Error("invalid_market");
  const cache=typeof caches!=="undefined" ? caches.default : null;
  const key=new Request(new URL("/__eod_prefilter_cache_"+market,request.url).toString());
  if(cache){
    try {
      const saved=await cache.match(key);
      if(saved) {
        const j=await saved.json();
        if(j?.ok&&j.market===market&&Array.isArray(j.candidates))
          return {...j,cached:true};
      }
    } catch {}
  }
  const upstream=await fetch(feed,{
    headers:{Accept:"application/json"},
    signal:AbortSignal.timeout(15000)
  });
  if(!upstream.ok)throw new Error("official_feed_http_"+upstream.status);
  const payload=await upstream.json();
  if(!Array.isArray(payload)||payload.length<300||payload.length>25000)
    throw new Error("official_feed_incomplete_or_unexpected");
  const valid=[];
  const byDate=new Map();
  for(const row of payload){
    const x=normalizeBulkEod(row,market);
    if(!x)continue;
    valid.push(x);
    byDate.set(x.source_date,(byDate.get(x.source_date)||0)+1);
  }
  if(valid.length<200)throw new Error("official_feed_too_few_common_stocks");
  const sourceDate=[...byDate.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const sameDay=valid.filter(x=>x.source_date===sourceDate);
  const liquid=sameDay.filter(x=>x.volume_lots>=1000);
  // Preview only. This is NOT a full-market MA/KD/MACD selection or a buy signal.
  liquid.sort((a,b)=>b.volume_lots-a.volume_lots||a.stock_id.localeCompare(b.stock_id));
  const body={
    ok:true,market,source:"official_bulk_daily_open_data",source_date:sourceDate,
    received_rows:payload.length,valid_common_stocks:sameDay.length,
    liquidity_pass_count:liquid.length,liquidity_min_lots:1000,
    candidates:liquid.slice(0,120),result_capped:liquid.length>120,
    preview_only:true,full_model_scanned:false,eligible_to_trade:false,
    prefilter_version:"2026-10-11-bulk-eod-v1",
    supabase_model_invocations:0,supabase_database_writes:0,
    note:"僅官方盤後價量初篩；未計算MA10/MA20/MA60、KD、MACD、籌碼，絕不作正式買點"
  };
  if(cache) {
    try{
      const response=new Response(JSON.stringify(body),{
        headers:{"Content-Type":"application/json","Cache-Control":"public, max-age=1800"}
      });
      await cache.put(key,response);
    }catch{}
  }
  return body;
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
        eod_prefilter_route:"read_only_available",
        deployment_marker:"admin-auth-market-bridge-20261010",
        source:"TWSE MIS",
        twse_mis_enabled:true,
        supabase_quote_requests:0,
        admin_auth_check:"existing_supabase_member_api",
        note:"報價走 Cloudflare，僅管理員；身分驗證仍低頻呼叫 Supabase，不含持股清單"
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
    // Isolated read-only preview. Never inserts candidates into Supabase or changes the radar.
    if(url.pathname==="/eod-prefilter") {
      if (!(await isAuthenticatedAdmin(request))) {
        return json({ok:false,error:"admin_auth_required"},401,origin);
      }
      const market=url.searchParams.get("market");
      if(!["tse","otc"].includes(market))
        return json({ok:false,error:"market_must_be_tse_or_otc"},400,origin);
      try {
        return json(await readDailyPrefilter(request,market),200,origin);
      } catch(error) {
        return json({
          ok:false,error:"official_bulk_feed_not_ready",
          diagnostic:String(error?.message||"unavailable").slice(0,100),
          preview_only:true,supabase_model_invocations:0,supabase_database_writes:0
        },503,origin);
      }
    }
    return json({ok:false,error:"not_found"},404,origin);
  }
};

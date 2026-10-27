// Observed actionable UI signals only. This function never scans, changes holdings,
// computes a new trading permission, or sends orders.
const H: Record<string,string> = {
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"POST,GET,OPTIONS",
  "Access-Control-Allow-Headers":"authorization,apikey,x-client-info,content-type",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};
const out=(v:unknown,s=200)=>new Response(JSON.stringify(v),{status:s,headers:H});
const url=Deno.env.get("SUPABASE_URL")||"";
const secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const anon=Deno.env.get("SUPABASE_ANON_KEY")||"";
const symbol=/^[0-9A-Z.-]{2,12}$/;
const date=/^\d{4}-\d{2}-\d{2}$/;
const n=(v:unknown,max=100000000)=>v===null||v===""||v===undefined?null:
  Number.isFinite(Number(v)) && Math.abs(Number(v))<=max?Number(v):null;
function headers(extra:Record<string,string>={}):Record<string,string>{
  return {apikey:secret,...(secret.startsWith("sb_")?{}:{Authorization:"Bearer "+secret}),
    "Content-Type":"application/json",...extra};
}
async function rows(path:string,options:RequestInit={}){
  const r=await fetch(url+"/rest/v1/"+path,{...options,headers:{...headers(),...(options.headers||{})}});
  return {ok:r.ok,status:r.status,data:r.ok?await r.json().catch(()=>[]):null};
}
const taipeiDate=()=>new Intl.DateTimeFormat("en-CA",
  {timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
Deno.serve(async (req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:H});
  if(req.method==="GET")return out({ok:true,service:"radar_trade_signal_history",write_only:true});
  if(req.method!=="POST")return out({ok:false,error:"method_not_allowed"},405);
  if(!url||!secret||!anon)return out({ok:false,error:"server_configuration_missing"},503);
  const authorization=req.headers.get("Authorization")||"";
  if(!/^Bearer \S+$/i.test(authorization))return out({ok:false,error:"unauthorized"},401);
  const who=await fetch(url+"/auth/v1/user",{headers:{apikey:anon,Authorization:authorization}});
  if(!who.ok)return out({ok:false,error:"unauthorized"},401);
  const user=await who.json().catch(()=>null);
  const userId=String(user?.id||"");
  if(!/^[a-f0-9-]{36}$/i.test(userId))return out({ok:false,error:"unauthorized"},401);
  const mem=await rows("radar_memberships?select=role,status,current_period_end&user_id=eq."+encodeURIComponent(userId)+"&limit=1");
  if(!mem.ok)return out({ok:false,error:"membership_unavailable"},503);
  const membership=mem.data?.[0];
  const allowed=membership?.role==="admin" ||
    (["trialing","active"].includes(String(membership?.status||"")) &&
      (!membership?.current_period_end || Date.parse(membership.current_period_end)>Date.now()));
  if(!allowed)return out({ok:false,error:"forbidden"},403);
  let body:any;
  try{body=await req.json()}catch{return out({ok:false,error:"invalid_json"},400)}
  const id=String(body?.stock_id||"").trim().toUpperCase();
  const type=String(body?.signal_type||"");
  const label=String(body?.signal_label||"").trim().slice(0,160);
  const asOf=String(body?.model_as_of||"");
  const day=String(body?.signal_date||"");
  const source=String(body?.source||"");
  const price=n(body?.price,100000);
  if(!symbol.test(id)||!["trial","add"].includes(type)||!label ||
    !date.test(day)||!date.test(asOf)||!["C","S"].includes(source)||price===null||price<=0)
    return out({ok:false,error:"invalid_signal"},400);
  // Capture only ACTUAL displayed actionable labels, not research or no-buy descriptions.
  const trial=type==="trial" &&
    /^(?:🎯 第一根可試單|🟠 可小量試單|🔵 盤中起漲｜可小量試單|🧪 可試單)/u.test(label);
  const add=type==="add" &&
    /^(?:🟠 可評估加碼|🟢 可加碼)/u.test(label);
  if(!trial&&!add)return out({ok:false,error:"non_actionable_label"},400);
  const now=taipeiDate();
  const validDay=source==="C"?day===now:day===asOf &&
    Math.abs(Date.parse(now+"T00:00:00Z")-Date.parse(day+"T00:00:00Z"))<8*86400000;
  if(!validDay)return out({ok:false,error:"stale_signal_date"},409);
  const model=await rows("spring_swallow_scan_results?select=stock_id,as_of&stock_id=eq."+encodeURIComponent(id)+"&limit=1");
  if(!model.ok)return out({ok:false,error:"model_unavailable"},503);
  if(String(model.data?.[0]?.as_of||"")!==asOf)return out({ok:false,error:"model_snapshot_changed"},409);
  const data={
    user_id:userId,stock_id:id,stock_name:String(body?.stock_name||"").slice(0,100),
    signal_type:type,signal_label:label,signal_date:day,model_as_of:asOf,source,
    quote_time:String(body?.quote_time||"").slice(0,48)||null,price,
    ma5:n(body?.ma5),ma10:n(body?.ma10),ma20:n(body?.ma20),ma60:n(body?.ma60),
    volume_lots:n(body?.volume_lots),avg20_volume_lots:n(body?.avg20_volume_lots),
    volume_ratio:n(body?.volume_ratio,10000),holding_cost:n(body?.holding_cost,100000),
    pnl_pct:n(body?.pnl_pct,100000),reason:String(body?.reason||"").slice(0,700),
    evidence:{method:"ui_render_observation_v1",client_reported:true,
      model_version:String(body?.model_version||"").slice(0,90),
      holding_add_kind:String(body?.holding_add_kind||"").slice(0,160),
      ma20_distance_pct:n(body?.ma20_distance_pct,10000),
      stop_warning_preserved:true,
      quote_date:source==="C"?day:null}
  };
  const path="radar_trade_signal_history?on_conflict="+
    "user_id,stock_id,signal_type,signal_date,source,signal_label";
  const wrote=await fetch(url+"/rest/v1/"+path,{method:"POST",
    headers:headers({Prefer:"resolution=ignore-duplicates,return=minimal"}),
    body:JSON.stringify(data)});
  if(!wrote.ok)return out({ok:false,error:"history_write_failed",status:wrote.status},503);
  return out({ok:true,saved:true,signal_date:day,stock_id:id,signal_type:type});
});
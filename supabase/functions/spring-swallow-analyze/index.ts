const H={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"GET, OPTIONS","Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const FINMIND='https://api.finmindtrade.com/api/v4/data';
function resp(x:any,s=200){return new Response(JSON.stringify(x),{status:s,headers:H})}
async function getJson(url:string,ms=18000){const c=new AbortController();const t=setTimeout(()=>c.abort(),ms);try{const headers:any={Accept:'application/json','User-Agent':'AshengStockRadar/2.0'};const token=Deno.env.get('FINMIND_TOKEN')||'';if(token)headers.Authorization=`Bearer ${token}`;const r=await fetch(url,{headers,signal:c.signal});const j=await r.json();return {ok:r.ok&&j?.status!==402,status:r.status,body:j}}catch(e){return {ok:false,status:0,body:String(e)}}finally{clearTimeout(t)}}

const CHASE_RULE_VERSION='2026-10-20-bias-8-12-15-v1';
const TDCC_RISK_VERSION='2026-10-28-tdcc-ma20-0-8-two-weeks-v1';
async function tdccHolderFlow(symbol:string,asOf:string,biasPct:number|null){
 const missing=(reason:string)=>({version:TDCC_RISK_VERSION,source:'third_party_archive_of_public_tdcc_csv',
  covered:false,pass:false,reason,stock_id:symbol,as_of:asOf,bias20_pct:biasPct,
  snapshot_date:null,usable_from:null,two_week400_up:false,two_week1000_up:false,
  two_week_both_up:false,holder_400_pct:null,holder_1000_pct:null});
 if(!/^\d{4}$/.test(symbol))return missing('invalid_stock_id');
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return missing('cache_access_unavailable');
 try{
  const headers:any={apikey:key};if(!key.startsWith('sb_'))headers.Authorization='Bearer '+key;
  const c=await fetch(url+'/rest/v1/spring_swallow_tdcc_holder_flow?select=stock_id,snapshot_date,usable_from,pct_400,pct_1000,change_400_pp,change_1000_pp,streak_400_weeks,streak_1000_weeks,streak_both_weeks,streak_history_snapshots,two_week400_up,two_week1000_up,two_week_both_up,status,source_kind&stock_id=eq.'+encodeURIComponent(symbol)+'&limit=1',
    {headers,signal:AbortSignal.timeout(4000)});
  if(!c.ok)return missing('cache_http_'+c.status);
  const x=(await c.json())[0];if(!x)return missing('no_stock_snapshot');
  const age=(Date.parse(asOf+'T00:00:00Z')-Date.parse(x.snapshot_date+'T00:00:00Z'))/86400000;
  const covered=x.status==='complete'&&x.usable_from<=asOf&&age>=0&&age<=20;
  const biasPass=Number.isFinite(biasPct)&&biasPct!==null&&biasPct>=0&&biasPct<=8;
  const holderPass=x.two_week400_up===true&&x.two_week1000_up===true;
  const pass=!!(covered&&biasPass&&holderPass);
  return {version:TDCC_RISK_VERSION,source:'third_party_archive_of_public_tdcc_csv',
   stock_id:symbol,as_of:asOf,snapshot_date:x.snapshot_date,usable_from:x.usable_from,
   age_days:age,covered,pass,reason:!covered?'missing_or_not_yet_available':!biasPass?'ma20_bias_out_of_0_8':!holderPass?'holder_two_week_increase_not_confirmed':'confirmed',
   bias20_pct:biasPct,ma20_bias_0_8_pass:biasPass,holder_400_pct:x.pct_400===null?null:Number(x.pct_400),
   holder_1000_pct:x.pct_1000===null?null:Number(x.pct_1000),
   delta_400_pp:x.change_400_pp===null?null:Number(x.change_400_pp),
   delta_1000_pp:x.change_1000_pp===null?null:Number(x.change_1000_pp),
   two_week400_up:x.two_week400_up===true,two_week1000_up:x.two_week1000_up===true,
   two_week_both_up:holderPass,
   streak_400_weeks:x.streak_400_weeks===null?null:Number(x.streak_400_weeks),
   streak_1000_weeks:x.streak_1000_weeks===null?null:Number(x.streak_1000_weeks),
   streak_both_weeks:x.streak_both_weeks===null?null:Number(x.streak_both_weeks),
   streak_history_snapshots:x.streak_history_snapshots===null?null:Number(x.streak_history_snapshots),
   streak_display_only:true,trade_gate_applied_to_new_entries:false,not_new_buy_signal:true};
 }catch(e){return missing('cache_fetch_failed')}
}

const CHASE_TW50_20260921=new Set('2330 2454 2308 2317 3711 2383 2303 3037 2891 2881 2345 2882 1303 2327 3017 2887 2382 2885 2360 2059 6669 2886 2884 3231 2408 2344 2357 2301 2412 2890 2883 3008 2880 2892 3665 1216 3443 3653 7769 4958 2368 2395 6446 2449 5880 8046 2603 4904 3045 6505'.split(' '));
function chaseTier(symbol:string,verifiedTier=''){
  if(CHASE_TW50_20260921.has(symbol)||verifiedTier==='large')return {tier:'large',name:'大型權值股',limit:8};
  if(verifiedTier==='small_spike')return {tier:'small_spike',name:'中小型飆股',limit:15};
  return {tier:'general',name:'一般／強勢主流股',limit:12};
}
function chaseRisk(symbol:string,price:number,ma20:number,verifiedTier=''){
  const rule=chaseTier(symbol,verifiedTier);
  const valid=Number.isFinite(price)&&price>0&&Number.isFinite(ma20)&&ma20>0;
  const bias=valid?(price/ma20-1)*100:null;
  const pass=valid&&(bias as number)<=rule.limit+1e-9;
  return {...rule,version:CHASE_RULE_VERSION,bias20_pct:bias==null?null:Math.round(bias*100)/100,pass,over:valid&&!pass,valid};
}
// Strict second-platform REBREAK research, separate from selection and from cost-specific trade permission.
// Uses only verified daily OHLCV. A breakout needs a DISTINCT prior 20-day-high breakout
// followed by 3-8 completed narrow, lower-volume bars; watch levels do not mean "add".
function holdingSecondPlatformAt(rows:any[], ctx:any){
  if(!Array.isArray(rows)||rows.length<70)return null;
  const i=rows.length-1,now=rows[i],last=Number(now?.close),open=Number(now?.open);
  const ma5=Number(ctx.ma5),ma10=Number(ctx.ma10),ma20=Number(ctx.ma20),ma60=Number(ctx.ma60);
  if(!(last>0&&ma5>ma10&&ma10>ma20&&ma20>ma60&&last>=ma5
    &&ctx.chasePass===true&&last<=ma20*1.05+1e-8&&ctx.noBreakdown===true))return null;
  const hs=rows.map((r:any)=>Number(r.max)),cs=rows.map((r:any)=>Number(r.close));
  const volumeOf=(r:any)=>Number(r?.Trading_Volume||0);
  const avg20=Number(ctx.avg20Lots||0),currentLots=Number(ctx.currentLots||0);
  const dailyK=Number(ctx.dailyK);
  let watch:any=null;
  for(let b=i-4;b>=Math.max(24,i-11);b--){
    const base=rows[b],baseClose=Number(base.close),baseOpen=Number(base.open);
    const firstHigh=maxN(hs,20,b-1),prevHigh=maxN(hs,20,b-2);
    const baseVolume=volumeOf(base),baseAvg=sma(rows.map((r:any)=>volumeOf(r)),20,b-1)||0;
    const firstBreak=baseClose>0&&baseClose>baseOpen&&baseClose>firstHigh*1.003
      &&Number(rows[b-1]?.close)<=prevHigh*1.003
      &&baseVolume>=1000000&&baseAvg>=500000
      &&baseClose/Number(rows[b-1]?.close)<=1.08;
    if(!firstBreak)continue;
    const barsUntilYesterday=rows.slice(b+1,i),barsThroughToday=rows.slice(b+1,i+1);
    const box=(bars:any[])=>{
      if(bars.length<3||bars.length>8)return null;
      const highs=bars.map(x=>Number(x.max)),lows=bars.map(x=>Number(x.min));
      if(!highs.every(x=>x>0)||!lows.every(x=>x>0))return null;
      const top=Math.max(...highs),bottom=Math.min(...lows);
      const width=(top/bottom-1)*100;
      const avgVol=bars.reduce((a,x)=>a+volumeOf(x),0)/bars.length;
      if(width>6||bottom<baseClose*.92||top<baseClose*.98||avgVol>baseVolume*.95)return null;
      return {top,bottom,width,avgVol};
    };
    const before=box(barsUntilYesterday);
    const ratio=avg20>0?currentLots/avg20:0;
    const confirmed=!!before&&last>=before.top*1.003&&last<=before.top*1.04
      &&last>open&&last>=Number(rows[i-1].close)
      &&currentLots>=1000&&avg20>=500&&ratio>=1.2&&ratio<=2.2
      &&Number.isFinite(dailyK)&&dailyK<=85;
    if(confirmed)return {status:'confirmed',as_of:String(now.date),
      first_breakout_date:String(base.date),first_breakout_close:+baseClose.toFixed(3),
      platform_days:barsUntilYesterday.length,trigger:+before.top.toFixed(3),
      bottom:+before.bottom.toFixed(3),width_pct:+before.width.toFixed(2),
      consolidation_vs_initial_volume:+(before.avgVol/baseVolume).toFixed(2),
      breakout_volume_ratio:+ratio.toFixed(2),automatic_order:false,requires_holding_cost:true};
    const current=box(barsThroughToday);
    if(current&&last<=current.top*1.003&&last>=current.top*.97){
      const candidate={status:'watch',as_of:String(now.date),
        first_breakout_date:String(base.date),first_breakout_close:+baseClose.toFixed(3),
        platform_days:barsThroughToday.length,trigger:+current.top.toFixed(3),
        bottom:+current.bottom.toFixed(3),width_pct:+current.width.toFixed(2),
        consolidation_vs_initial_volume:+(current.avgVol/baseVolume).toFixed(2),
        breakout_volume_ratio:null,automatic_order:false,requires_holding_cost:true};
      if(!watch||candidate.first_breakout_date>watch.first_breakout_date)watch=candidate;
    }
  }
  return watch;
}

// Independent, read-only early-breakout scout. Uses only the already downloaded
// historical daily bars at the current as_of. Never changes MA10/20/60 selection,
// V5 trade gates, position sizing, daily scan counts or buy/sell permissions.
function preBreakoutScoutMetrics(bars){
  const version='2026-10-21-prebreakout-scout-v1';
  const none=(reason)=>({version,state:'none',eligible:false,score:0,
    reason,actionable:false});
  if(!Array.isArray(bars)||bars.length<65)return none('日K不足');
  const sample=bars.slice(-65),now=sample[sample.length-1];
  const closes=sample.map(r=>Number(r.close));
  const volumes=sample.map(r=>Number(r.Trading_Volume)||0);
  const last=closes.at(-1),prev=closes.at(-2);
  const mean=a=>a.reduce((x,y)=>x+y,0)/Math.max(1,a.length);
  const ma10=mean(closes.slice(-10)),ma20=mean(closes.slice(-20));
  const ma60=mean(closes.slice(-60)),ma20five=mean(closes.slice(-25,-5));
  const high20=Math.max(...sample.slice(-21,-1).map(r=>Number(r.max)||Number(r.close)||0));
  const before10=closes.slice(-11,-1),before20=closes.slice(-21,-1);
  const width=a=>Math.min(...a)>0?(Math.max(...a)/Math.min(...a)-1)*100:999;
  const width10=width(before10),width20=width(before20);
  const volLots=volumes.at(-1)/1000,avg20Lots=mean(volumes.slice(-20))/1000;
  const vol5=mean(volumes.slice(-5)),prior5=mean(volumes.slice(-10,-5));
  const volImpulse=prior5>0?vol5/prior5:0,dayVolumeRatio=avg20Lots>0?volLots/avg20Lots:0;
  const near=high20>0?(last/high20-1)*100:-999;
  const bias=ma20>0?(last/ma20-1)*100:999;
  const dailyReturn=prev>0?(last/prev-1)*100:999;
  const bandReady=(width10<=9||width20<=15);
  const trendReady=ma10>=ma20*.985&&ma20>=ma60*.97&&ma20>=ma20five*.995;
  const locationReady=near>=-6&&near<0&&bias>=-2&&bias<=6
    &&dailyReturn<=4.5&&dailyReturn>=-5;
  const liquidityReady=volLots>=1000&&avg20Lots>=400;
  const safe=bandReady&&trendReady&&locationReady&&liquidityReady;
  const score=(width10<=7?20:width20<=12?15:5)
    +(near>=-3?20:near>=-6?12:0)
    +(ma10>=ma20&&ma20>=ma20five?15:8)
    +(volImpulse>=1.1?15:volImpulse>=.75?9:3)
    +(volLots>=1000?10:0)+(bias>=0&&bias<=4?10:5);
  const eligible=safe&&score>=55,ready=eligible&&score>=65&&near>=-4;
  const state=ready?'ready':eligible?'forming':'none';
  return {version,state,eligible,score:eligible?score:0,
    as_of:String(now.date||''),range10_pct:+width10.toFixed(2),
    range20_pct:+width20.toFixed(2),distance_to_high20_pct:+near.toFixed(2),
    ma20_bias_pct:+bias.toFixed(2),
    volume5_vs_prior5:+volImpulse.toFixed(2),
    day_volume_ratio:+dayVolumeRatio.toFixed(2),
    liquidity_lots:Math.round(volLots),avg20_lots:Math.round(avg20Lots),
    breakout_trigger:+high20.toFixed(2),support_ma10:+ma10.toFixed(2),
    reason:eligible?(ready?'前高附近整理、均線轉強，等有效放量突破':'10至20日整理，觀察量能與前高'):'尚未同時滿足前哨條件',
    actionable:false,trade_gate_unchanged:true};
}

function sma(a:number[],n:number,i:number){if(i<n-1)return null;let s=0;for(let k=i-n+1;k<=i;k++)s+=a[k];return s/n}
function minN(a:number[],n:number,i:number){let m=Infinity;for(let k=Math.max(0,i-n+1);k<=i;k++)m=Math.min(m,a[k]);return m}
function maxN(a:number[],n:number,i:number){let m=-Infinity;for(let k=Math.max(0,i-n+1);k<=i;k++)m=Math.max(m,a[k]);return m}
function kd(high:number[],low:number[],close:number[],period=9){let K=50,D=50;const out:any[]=[];for(let i=0;i<close.length;i++){const hh=maxN(high,period,i),ll=minN(low,period,i);const rsv=hh===ll?50:(close[i]-ll)/(hh-ll)*100;K=(2*K+rsv)/3;D=(2*D+K)/3;out.push({k:K,d:D,j:3*K-2*D})}return out}
function aggregate(rows:any[],mode:'week'|'month'){const m=new Map<string,any>();for(const r of rows){const d=new Date(r.date+'T00:00:00Z');let key='';if(mode==='month'){key=`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`}else{const tmp=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()));const day=tmp.getUTCDay()||7;tmp.setUTCDate(tmp.getUTCDate()+4-day);const y0=new Date(Date.UTC(tmp.getUTCFullYear(),0,1));const w=Math.ceil((((tmp.getTime()-y0.getTime())/86400000)+1)/7);key=`${tmp.getUTCFullYear()}-W${String(w).padStart(2,'0')}`};const x=m.get(key);if(!x)m.set(key,{date:r.date,open:+r.open,high:+r.max,low:+r.min,close:+r.close});else{x.date=r.date;x.high=Math.max(x.high,+r.max);x.low=Math.min(x.low,+r.min);x.close=+r.close}}
return [...m.values()]}
function pct(v:number|null,d=1){return v==null?null:+v.toFixed(d)}
function volumeBucket(r:number){if(!Number.isFinite(r))return 'unknown';if(r<.9)return 'light';if(r<=1.4)return 'normal';if(r<=2)return 'strong';return 'explosive'}
function bucketLabel(b:string){return b==='light'?'量縮':b==='normal'?'正常量':b==='strong'?'溫和放量':b==='explosive'?'爆量':'未知'}
function n(v:any){const x=Number(v);return Number.isFinite(x)?x:0}
function fmtDate(d:Date){return d.toISOString().slice(0,10)}
function chipLabel(score:number){return score>=75?'籌碼偏多':score>=60?'籌碼改善':score>=45?'籌碼中性':'籌碼偏弱'}
function addDays(s:string,days:number){const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return fmtDate(d)}
async function revenueHistory(symbol:string,start:string,end:string){const q=new URL(FINMIND);q.searchParams.set('dataset','TaiwanStockMonthRevenue');q.searchParams.set('data_id',symbol);q.searchParams.set('start_date',start);q.searchParams.set('end_date',end);const r=await getJson(q.toString(),10000);if(!r.ok||!Array.isArray(r.body?.data))return [];return r.body.data.map((x:any)=>{const y=Number(x.revenue_year),m=Number(x.revenue_month),rev=Number(x.revenue);const raw=String(x.date||'');const created=String(x.create_time||'');const effective=/^20\d\d-\d\d-\d\d$/.test(created)?created:addDays(raw,10);return {year:y,month:m,revenue:rev,date:raw,effective_date:effective}}).filter((x:any)=>Number.isFinite(x.year)&&Number.isFinite(x.month)&&Number.isFinite(x.revenue)&&x.revenue>0&&/^20\d\d-\d\d-\d\d$/.test(x.effective_date)).sort((a:any,b:any)=>(a.year-b.year)||(a.month-b.month))}
function revenueAt(revs:any[],asOf:string){const available=revs.filter((x:any)=>x.effective_date<=asOf);if(!available.length)return {coverage:false,score:50,label:'營收資料不足',as_of_month:null,latest_yoy_pct:null,aggregate_3m_yoy_pct:null,positive_yoy_months:null};const by=new Map<string,any>();for(const x of available)by.set(`${x.year}-${String(x.month).padStart(2,'0')}`,x);const ordered=[...by.values()].sort((a:any,b:any)=>(a.year-b.year)||(a.month-b.month));const last3=ordered.slice(-3);let cur=0,prev=0,pos=0,comp=0,lastYoy:number|null=null;for(const x of last3){const p=by.get(`${x.year-1}-${String(x.month).padStart(2,'0')}`);if(!p||!p.revenue)continue;const yoy=(x.revenue/p.revenue-1)*100;cur+=x.revenue;prev+=p.revenue;comp++;if(yoy>0)pos++;lastYoy=yoy}if(comp<2||prev<=0)return {coverage:false,score:50,label:'營收比較樣本不足',as_of_month:last3.length?`${last3[last3.length-1].year}-${String(last3[last3.length-1].month).padStart(2,'0')}`:null,latest_yoy_pct:pct(lastYoy,1),aggregate_3m_yoy_pct:null,positive_yoy_months:pos};const agg=(cur/prev-1)*100;let score=30;if(agg>=10&&pos===3)score=90;else if(agg>=5&&pos>=2)score=80;else if(agg>0&&pos>=2)score=70;else if(agg>=-5&&pos>=1)score=55;const label=score>=80?'營收成長穩定':score>=70?'營收偏正向':score>=55?'營收中性':'營收偏弱';return {coverage:true,score,label,as_of_month:`${last3[last3.length-1].year}-${String(last3[last3.length-1].month).padStart(2,'0')}`,latest_yoy_pct:pct(lastYoy,1),aggregate_3m_yoy_pct:pct(agg,1),positive_yoy_months:pos,comparison_months:comp,lookahead_guard:'歷史資料以月份資料日+10天視為可用；2026-04-21後優先用create_time'}}
async function chipSnapshot(symbol:string,end:string){
  const d=new Date(end+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-35);const start=fmtDate(d);
  const url=(dataset:string)=>{const q=new URL(FINMIND);q.searchParams.set('dataset',dataset);q.searchParams.set('data_id',symbol);q.searchParams.set('start_date',start);q.searchParams.set('end_date',end);return q.toString()};
  const [ir,mr,fr]=await Promise.all([
    getJson(url('TaiwanStockInstitutionalInvestorsBuySellWide'),8000),
    getJson(url('TaiwanStockMarginPurchaseShortSale'),8000),
    getJson(url('TaiwanStockShareholding'),8000)
  ]);
  const modules:any[]=[];const notes:string[]=[];let institutional:any=null,margin:any=null,foreign:any=null;
  const instRows=(ir.ok&&Array.isArray(ir.body?.data)?ir.body.data:[]).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date)));
  if(instRows.length){
    const last5=instRows.slice(-5);const rowNet=(r:any)=>n(r.Foreign_Investor_buy)-n(r.Foreign_Investor_sell)+n(r.Foreign_Dealer_Self_buy)-n(r.Foreign_Dealer_Self_sell)+n(r.Investment_Trust_buy)-n(r.Investment_Trust_sell)+n(r.Dealer_buy)-n(r.Dealer_sell)+n(r.Dealer_self_buy)-n(r.Dealer_self_sell)+n(r.Dealer_Hedging_buy)-n(r.Dealer_Hedging_sell);
    const foreign5=last5.reduce((s:number,r:any)=>s+n(r.Foreign_Investor_buy)-n(r.Foreign_Investor_sell)+n(r.Foreign_Dealer_Self_buy)-n(r.Foreign_Dealer_Self_sell),0);
    // Ten distinct prior trading sessions, not ten consecutive buying days.
    const uniqueDays=[...new Map(instRows.filter(r=>/^20\d\d-\d\d-\d\d$/.test(String(r.date||'')))
      .map(r=>[String(r.date),r])).values()].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const ten=uniqueDays.slice(-10);
    const net10=ten.length===10?ten.reduce((sum,r)=>sum
      +n(r.Foreign_Investor_buy)-n(r.Foreign_Investor_sell)
      +n(r.Foreign_Dealer_Self_buy)-n(r.Foreign_Dealer_Self_sell),0):null;
    const buyDays10=ten.length===10?ten.filter(r=>
      n(r.Foreign_Investor_buy)-n(r.Foreign_Investor_sell)
        +n(r.Foreign_Dealer_Self_buy)-n(r.Foreign_Dealer_Self_sell)>0).length:null;
    const trust5=last5.reduce((s:number,r:any)=>s+n(r.Investment_Trust_buy)-n(r.Investment_Trust_sell),0);
    const total5=last5.reduce((s:number,r:any)=>s+rowNet(r),0);const positiveDays=last5.filter((r:any)=>rowNet(r)>0).length;const lastNet=rowNet(last5[last5.length-1]);const last3=last5.slice(-3);const consecutive3=last3.length===3&&last3.every((r:any)=>rowNet(r)>0);
    let s=0;s+=total5>0?25:total5===0?12:0;s+=positiveDays>=4?20:positiveDays>=3?15:positiveDays===2?8:0;s+=consecutive3?15:0;s+=foreign5>0?15:foreign5===0?7:0;s+=trust5>0?15:trust5===0?7:0;s+=lastNet>0?10:lastNet===0?5:0;s=Math.min(100,s);
    institutional={score:s,net_5d:Math.round(total5),positive_days_5d:positiveDays,consecutive_buy_3d:consecutive3,foreign_net_5d:Math.round(foreign5),foreign_net_10d:net10==null?null:Math.round(net10),
      foreign_buy_days_10d:buyDays10,foreign_10d_covered:ten.length===10,
      trust_net_5d:Math.round(trust5),last_net:Math.round(lastNet),as_of:last5[last5.length-1]?.date||null};
    modules.push({score:s,weight:40});notes.push(total5>0?'法人近5日偏買':total5<0?'法人近5日偏賣':'法人近5日持平');
  }
  const marginRows=(mr.ok&&Array.isArray(mr.body?.data)?mr.body.data:[]).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date)));
  if(marginRows.length){
    const latest=marginRows[marginRows.length-1];const prev=marginRows[Math.max(0,marginRows.length-6)];const nowBal=n(latest.MarginPurchaseTodayBalance);const prevBal=n(prev.MarginPurchaseTodayBalance);const chg=prevBal>0?(nowBal/prevBal-1)*100:0;
    let s=chg<=-10?100:chg<=-5?90:chg<=-2?80:chg<=0?70:chg<=2?55:chg<=5?35:chg<=10?15:0;
    if(nowBal===0)s=70;
    margin={score:s,balance:Math.round(nowBal),change_5d_pct:pct(chg,1),as_of:latest.date||null};modules.push({score:s,weight:30});notes.push(chg<0?`融資5日下降 ${Math.abs(pct(chg,1)??0)}%`:chg>0?`融資5日增加 ${pct(chg,1)}%`:'融資5日持平');
  }
  const foreignRows=(fr.ok&&Array.isArray(fr.body?.data)?fr.body.data:[]).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date)));
  if(foreignRows.length){
    const latest=foreignRows[foreignRows.length-1];const prev=foreignRows[Math.max(0,foreignRows.length-11)];const ratio=n(latest.ForeignInvestmentSharesRatio);const prevRatio=n(prev.ForeignInvestmentSharesRatio);const delta=ratio-prevRatio;
    const s=delta>=.5?100:delta>=.2?85:delta>0?70:delta===0?50:delta>-.2?35:delta>-.5?15:0;
    foreign={score:s,ratio:pct(ratio,2),change_10d_pp:pct(delta,2),as_of:latest.date||null};modules.push({score:s,weight:30});notes.push(delta>0?`外資持股比10日增加 ${pct(delta,2)} 個百分點`:delta<0?`外資持股比10日減少 ${Math.abs(pct(delta,2)??0)} 個百分點`:'外資持股比10日持平');
  }
  if(!modules.length)return null;const weight=modules.reduce((s,x)=>s+x.weight,0);const score=Math.round(modules.reduce((s,x)=>s+x.score*x.weight,0)/weight);
  return {score,label:chipLabel(score),coverage_modules:modules.length,coverage_weight:weight,institutional,margin,foreign,notes,source:'FinMind free chip datasets',advanced:{large_small_holder:false,broker_branch:false}};
}
// Optional quarterly fundamentals for already-relevant candidates only.
// Conservative disclosure lag to prevent future-quarter hindsight in backtests.
function financialQualityFromRows(finRows,cashRows,asOf){
  const quarter=(date)=>{
    const x=/^(20\d\d)-(\d\d)-(\d\d)$/.exec(String(date));
    if(!x)return null;
    const y=Number(x[1]),m=Number(x[2]),day=Number(x[3]);
    if(![3,6,9,12].includes(m)||day!==(m===3||m===12?31:30))return null;
    const q=m/3,published=addDays(date,q===4?91:51);
    return {date,y,q,key:y*4+q,published};
  };
  const rowsFor=(rows,types)=>{
    const d=new Map();
    for(const r of rows||[]){
      if(!types.includes(r.type)||!Number.isFinite(Number(r.value)))continue;
      const z=quarter(r.date);
      if(!z||z.published>asOf)continue;
      if(!d.has(z.date))d.set(z.date,{...z});
      d.get(z.date)[r.type]=Number(r.value);
    }
    return [...d.values()].sort((a,b)=>b.key-a.key);
  };
  const margins=rowsFor(finRows,['Revenue','GrossProfit','CostOfGoodsSold'])
    .map(x=>{
      const sales=x.Revenue>0?x.Revenue:
        Number.isFinite(x.GrossProfit)&&Number.isFinite(x.CostOfGoodsSold)
          &&x.GrossProfit+x.CostOfGoodsSold>0?x.GrossProfit+x.CostOfGoodsSold:null;
      return {...x,margin:sales!=null&&Number.isFinite(x.GrossProfit)?100*x.GrossProfit/sales:null};
    }).filter(x=>x.margin!=null);
  const q=margins.slice(0,3);
  const comparable=q.length===3&&q[0].key===q[1].key+1&&q[1].key===q[2].key+1;
  const gross=comparable?q[0].margin>q[1].margin&&q[1].margin>q[2].margin:null;
  const cash=rowsFor(cashRows,['CashFlowsFromOperatingActivities'])
    .filter(x=>Number.isFinite(x.CashFlowsFromOperatingActivities));
  const newest=cash[0],prior=cash.find(x=>x.key===newest?.key-1);
  // FinMind cash-flow values are YTD. Q2/Q3/Q4 must subtract same-year
  // prior quarter; only Q1 can use the reported figure directly.
  const standalone=newest&&(newest.q===1||(prior&&prior.y===newest.y))
    ?newest.CashFlowsFromOperatingActivities
      -(newest.q===1?0:prior.CashFlowsFromOperatingActivities):null;
  return {version:'2026-10-21-quarter-finance-v1',
    gross_margin_2q_up:gross,
    gross_margin_latest_pct:q.length?Number(q[0].margin.toFixed(2)):null,
    gross_margin_period:q[0]?.date||null,
    operating_cashflow_positive:standalone==null?null:standalone>0,
    operating_cashflow_quarter_value:standalone,
    operating_cashflow_period:standalone==null?null:newest.date,
    coverage_gross_margin:comparable,coverage_cashflow:standalone!=null,
    data_as_of:asOf,source:'FinMind per-symbol quarterly statements',
    timing:'Q1-3 +51 days; Q4 +91 days',trade_gate_unchanged:true};
}
async function candidateQuarterFinancials(symbol,asOf){
  const d=new Date(asOf+'T00:00:00Z');d.setUTCMonth(d.getUTCMonth()-20);
  const url=(dataset)=>{const u=new URL(FINMIND);
    u.searchParams.set('dataset',dataset);u.searchParams.set('data_id',symbol);
    u.searchParams.set('start_date',fmtDate(d));u.searchParams.set('end_date',asOf);
    return u.toString()};
  const [a,b]=await Promise.all([
    getJson(url('TaiwanStockFinancialStatements'),2600),
    getJson(url('TaiwanStockCashFlowsStatement'),2600)]);
  return financialQualityFromRows(a.ok&&Array.isArray(a.body?.data)?a.body.data:[],
    b.ok&&Array.isArray(b.body?.data)?b.body.data:[],asOf);
}
function candleEntryMetrics(rows:any[]){
const c=rows.map((r:any)=>+r.close),o=rows.map((r:any)=>+r.open),h=rows.map((r:any)=>+r.max),l=rows.map((r:any)=>+r.min),v=rows.map((r:any)=>+r.Trading_Volume||0),i=c.length-1;
const d=kd(h,l,c),ma5=sma(c,5,i),ma10=sma(c,10,i),ma20=sma(c,20,i);
let e12=c[0],e26=c[0],dea=0,hist=0;const hs:number[]=[];
for(let z=0;z<=i;z++){if(z){e12+=(c[z]-e12)*2/13;e26+=(c[z]-e26)*2/27;}const dif=e12-e26;dea+=(dif-dea)*2/10;hist=(dif-dea)*2;hs.push(hist);}
let b=-1;for(let z=Math.max(21,i-20);z<i;z++){const hp=maxN(h,20,z-1);if(c[z]>o[z]&&c[z]>hp&&c[z-1]<=maxN(h,20,z-2))b=z;}
const two=c[i]<o[i]&&c[i-1]<o[i-1],lower=c[i]<c[i-1]&&c[i-1]<c[i-2];
const highKd=Math.max(...d.slice(Math.max(0,i-5),i+1).map((x:any)=>Math.max(x.k,x.d)))>=80;
const kw=highKd&&d[i].k<d[i].d;
const hw=hs[i]<hs[i-1]&&hs[i-1]<hs[i-2]&&((hs[i-2]>0&&hs[i]<=hs[i-2]*.8)||hs[i]<0);
const support=b>=0?maxN(h,20,b-1):null;
const avgPre=sma(v,5,Math.max(4,i-1))||0;
const contraction=v[i]<v[i-1]&&v[i]<avgPre;
const allRising=[10,20,60].every(n=>{const a=sma(c,n,i),p=sma(c,n,i-5);return a!=null&&p!=null&&a>=p;});
const mainBull=allRising&&c[i]>=(ma10||Infinity)&&c[i]>=(ma20||Infinity)&&c[i]>=(sma(c,60,i)||Infinity);
const holdShort=c[i]>=(ma5||Infinity)||c[i]>=(ma10||Infinity)||(support!=null&&c[i]>=support);
return {version:'2026-10-06-kbar-ma10-20-60-v3',as_of:rows[i].date,close:c[i],ma5:pct(ma5,4),ma10:pct(ma10,4),ma20:pct(ma20,4),two_black:two,lower_closes:lower,post_breakout:b>=0,breakout_date:b>=0?rows[b].date:null,breakout_support:support,kd_high_weak:kw,macd_weak:hw,macd_hist:pct(hs[i],6),macd_prev_hist:pct(hs[i-1],6),volume_contract:contraction,main_bull:mainBull,held_support:holdShort,below_ma5:ma5!=null&&c[i]<ma5,ma20_pullback:ma20!=null&&c[i]>=ma20*.97&&c[i]<=ma20*1.03&&ma5!=null&&c[i]<ma5,weak_after_breakout:two&&lower&&ma5!=null&&c[i]<ma5&&(kw||hw),consolidation:b>=0&&contraction&&holdShort&&mainBull,recent_breakout:b>=0};
}

/**
 * Shan-Chuan mother-child (harami/inside-range) research, 2026-10-16.
 * Uses completed historical OHLCV only; never creates or unlocks a trade signal.
 * Chip confirmation is from the existing current-date snapshot only; historical
 * price/volume studies do NOT misrepresent missing historical chip information.
 */
function shanchuanMotherChildResearch(rows:any[], chip:any, context:any){
  const N=rows.length, lastIndex=N-1;
  const num=(x:any)=>Number(x);
  const op=rows.map((r:any)=>num(r.open||r.close)),cl=rows.map((r:any)=>num(r.close));
  const hi=rows.map((r:any)=>num(r.max)),lo=rows.map((r:any)=>num(r.min));
  const vol=rows.map((r:any)=>num(r.Trading_Volume)||0);
  const pair=(m:number,b:number)=>{
    if(m<0||b>=N)return {formed:false,inside:false,contracted:false};
    const mr=hi[m]-lo[m],cr=hi[b]-lo[b],mb=Math.abs(cl[m]-op[m]),cb=Math.abs(cl[b]-op[b]);
    const valid=[mr,cr,hi[m],lo[m],hi[b],lo[b],vol[m],vol[b]].every(Number.isFinite)
      &&mr>0&&cr>=0&&cl[m]>0&&mr/cl[m]>=.015&&vol[m]>0;
    const inside=valid&&hi[b]<=hi[m]*1.001&&lo[b]>=lo[m]*.999;
    const contracted=valid&&cr<=mr*.82&&cb<=Math.max(mb*.70,mr*.30)
      &&vol[b]>0&&vol[b]<=vol[m]*.90;
    return {formed:!!(inside&&contracted),inside:!!inside,contracted:!!contracted,
      mother_index:m,child_index:b,mother_high:hi[m],mother_low:lo[m],
      child_low:lo[b],mother_date:String(rows[m].date),child_date:String(rows[b].date)};
  };
  const breakthrough=(x:number,pattern:any)=>{
    if(!pattern?.formed||x<20||x>=N)return {price:false,volume:false,passed:false,ratio:null};
    const avg=sma(vol,20,x-1)||0,ratio=avg>0?vol[x]/avg:0;
    const span=hi[x]-lo[x],location=span>0?(cl[x]-lo[x])/span:0;
    const price=cl[x]>pattern.mother_high*1.002&&cl[x]>op[x]
      &&cl[x]>hi[x-1]&&location>=.65&&lo[x]>=pattern.child_low*.995;
    const volume=vol[x]>=1000000&&avg>=500000&&ratio>=1.2&&ratio<=2.5;
    return {price:!!price,volume:!!volume,passed:!!(price&&volume),ratio};
  };
  const yesterday=pair(lastIndex-2,lastIndex-1);
  const today=pair(lastIndex-1,lastIndex);
  const breaking=breakthrough(lastIndex,yesterday);
  const ma10=num(context.ma10),ma20=num(context.ma20),ma60=num(context.ma60);
  const price=cl[lastIndex],position=num(context.position_pct);
  const bottom=!!(context.base_confirmed===true||context.low_base===true)
    &&position>=0&&position<=45&&ma20>0&&ma10>0&&ma60>0
    &&price>=Math.max(ma10,ma20,ma60)&&context.chase_limit>0&&price/ma20<=1+context.chase_limit/100;
  const institution=chip?.institutional||{};
  const chipAvailable=chip!=null&&Number.isFinite(Number(chip.score))
    &&num(chip.coverage_modules)>=2;
  const chipPass=chipAvailable&&num(chip.score)>=65
    &&(num(institution.net_5d)>0||num(institution.positive_days_5d)>=3);
  const guard=context.entry_guard||{};
  const riskPass=context.ma_all_rising===true&&guard.weak_after_breakout!==true
    &&guard.kd_high_weak!==true&&guard.macd_weak!==true
    &&context.strong_breakdown!==true;

  // Mother/child K levels remain fixed for 10 completed bars after formation.
  // Prior confirmed breakout stays visible even if a newer inside bar forms.
  const patternLifecycle=(()=>{
    const patterns:any[]=[];
    const asOf=String(rows[lastIndex]?.date||'');
    for(let b=lastIndex;b>=Math.max(1,lastIndex-10);b--){
      const pat=pair(b-1,b);
      if(!pat.formed)continue;
      let state=b===lastIndex?'formed':'waiting_breakout';
      let breakoutDate:any=null,brokenDate:any=null,weakBreak=false;
      for(let d=b+1;d<=lastIndex;d++){
        const price=cl[d];
        if(price<pat.mother_low*.999){state='mother_low_broken';brokenDate=String(rows[d].date);break;}
        if(price<pat.child_low*.999){state='child_low_broken';brokenDate=String(rows[d].date);break;}
        if(breakoutDate){state=price>=pat.mother_high?'breakout_held':'breakout_retest_watch';continue;}
        const signal=breakthrough(d,pat);
        if(signal.passed){state='breakout_confirmed';breakoutDate=String(rows[d].date);weakBreak=false;}
        else if(signal.price){state='breakout_wait_volume';weakBreak=true;}
        else {state='waiting_breakout';weakBreak=false;}
      }
      if(breakoutDate===asOf&&!brokenDate)state='breakout_confirmed';
      patterns.push({state,active:true,as_of:asOf,mother_date:pat.mother_date,
        child_date:pat.child_date,mother_high:pat.mother_high,mother_low:pat.mother_low,
        child_high:hi[b],child_low:pat.child_low,age_days:lastIndex-b,
        breakout_date:breakoutDate,broken_date:brokenDate,
        breakout_today:state==='breakout_confirmed',price_without_volume:weakBreak&&!breakoutDate});
    }
    const currentFailure=patterns.find(p=>p.broken_date===asOf);
    const continuingBreakout=patterns.find(p=>p.breakout_date
      &&['breakout_confirmed','breakout_held','breakout_retest_watch'].includes(p.state));
    const selected=currentFailure||continuingBreakout||patterns[0];
    return selected?{...selected,
      formed_another_today:patterns.some(p=>p.state==='formed'&&p.age_days===0),
      rule:'收盤帶量突破母K高點才確認；跌破子K低點警戒；跌破母K低點失效；不解鎖買進'}:
      {state:'none',active:false,as_of:asOf,mother_date:null,child_date:null,
       mother_high:null,mother_low:null,child_high:null,child_low:null,age_days:null,
       breakout_date:null,broken_date:null,breakout_today:false,
       price_without_volume:false,formed_another_today:false};
  })();
  const complete=!!(yesterday.formed&&breaking.passed&&bottom&&chipPass&&riskPass);
  const counts={calibration:{n:0,wins:0,sum:0},validation:{n:0,wins:0,sum:0}};
  let previousAccepted=-99;
  for(let x=260;x<=lastIndex-20;x++){
    if(x-previousAccepted<10)continue;
    const inside=pair(x-2,x-1),b=breakthrough(x,inside);
    if(!b.passed)continue;
    const m10=sma(cl,10,x),m20=sma(cl,20,x),m60=sma(cl,60,x);
    if(!m10||!m20||!m60||cl[x]<Math.max(m10,m20,m60)
      ||cl[x]/m20>1+context.chase_limit/100)continue;
    const hi252=maxN(hi,252,x),lo252=minN(lo,252,x);
    const positionAt=(cl[x]-lo252)/(hi252-lo252||1);
    if(positionAt<0||positionAt>.45)continue;
    const entry=op[x+1],exit=cl[x+20];
    if(!(entry>0&&exit>0))continue;
    const netPct=((exit*.995575)/(entry*1.001425)-1)*100;
    const g=String(rows[x].date)>='2025-01-01'?counts.validation:counts.calibration;
    g.n++;g.sum+=netPct;if(netPct>0)g.wins++;
    previousAccepted=x;
  }
  const pack=(g:any)=>({samples:g.n,win_rate_20d_pct:g.n?Math.round(1000*g.wins/g.n)/10:null,
    avg_net_return_20d_pct:g.n?Math.round(g.sum/g.n*100)/100:null});
  return {
    version:'2026-10-16-mother-child-pv-chip-research-v1',
    mother_child:{formed_today:today.formed,formed_yesterday:yesterday.formed,
      breakout_confirmed:breaking.passed,breakout_price_confirmed:breaking.price,
      mother_date:yesterday.formed?yesterday.mother_date:today.formed?today.mother_date:null,
      child_date:yesterday.formed?yesterday.child_date:today.formed?today.child_date:null,
      mother_high:yesterday.formed?yesterday.mother_high:today.formed?today.mother_high:null,
      child_low:yesterday.formed?yesterday.child_low:today.formed?today.child_low:null,
      volume_ratio:breaking.ratio==null?null:Math.round(breaking.ratio*100)/100,
      lifecycle:patternLifecycle},
    quality:{bottom_structure:bottom,volume_confirmed:breaking.volume,
      chip_status:chipAvailable?(chipPass?'supportive':'weak_or_neutral'):'unavailable',
      chip_confirmed:!!chipPass,risk_pass:!!riskPass,
      all_confirmed:complete},
    candidate_status:patternLifecycle.state==='mother_low_broken'?'mother_child_invalid':
      patternLifecycle.state==='child_low_broken'?'mother_child_warning':
      complete?'research_confluence':breaking.passed&&bottom?'research_breakout':
      today.formed&&bottom?'inside_bar_watch':yesterday.formed?'pending_or_failed_breakout':'none',
    historical_price_volume_only:{calibration_2022_2024:pack(counts.calibration),
      validation_2025plus:pack(counts.validation),
      historical_chip_available:false,entry:'next_open',exit:'20d_close',
      standard_fee_tax_included:true,non_overlapping_signal_days:10},
    actionable:false,formal_buy_unlocked:false,ranking_weight:0,
    note:'母子K需完全內包、實體與量能收縮；確認K需突破母K高點且當日量價轉強。籌碼僅有當期資訊，不能冒充歷史完整回測。正式買點與原風控維持鎖定。'
  };
}


/* Locked box-range observation: completed EOD OHLCV, no extra provider request.
   20 prior sessions define a 4%-14% wide range with repeated tests at both edges.
   A breakout freezes its historic top/bottom; do not roll these with daily prices.
   Pure analytics; official V5/MA20 trade gates remain separate. */
function boxRangeAt(rows,y){
  if(y<65||y>=rows.length)return null;
  const w=rows.slice(y-20,y);
  const highs=w.map(x=>Number(x.max)),lows=w.map(x=>Number(x.min));
  const closes=w.map(x=>Number(x.close)),vols=w.map(x=>Number(x.Trading_Volume)||0);
  if(highs.some(x=>!(x>0))||lows.some(x=>!(x>0)))return null;
  const top=Math.max(...highs),bottom=Math.min(...lows),width=top/bottom-1;
  if(width<.04||width>.14||Math.abs(closes[19]/closes[0]-1)>.09)return null;
  const upper=highs.map((x,i)=>x>=top*.978?i:-1).filter(i=>i>=0);
  const lower=lows.map((x,i)=>x<=bottom*1.022?i:-1).filter(i=>i>=0);
  if(upper.length<2||lower.length<2
    ||upper[upper.length-1]-upper[0]<3||lower[lower.length-1]-lower[0]<3)return null;
  const avg20=vols.reduce((a,b)=>a+b,0)/20;
  if(!(avg20>=500000))return null;
  return {top,bottom,width_pct:Math.round(width*10000)/100,days:20,avg20};
}
function boxBreakAt(rows,y,b){
  if(!b)return null;
  const r=rows[y],o=Number(r.open||r.close),c=Number(r.close);
  const h=Number(r.max),l=Number(r.min),vol=Number(r.Trading_Volume)||0;
  const ratio=b.avg20>0?vol/b.avg20:0,closePos=h>l?(c-l)/(h-l):0;
  if(!(c>b.top*1.003&&c>=o&&closePos>=.65&&vol>=1000000
    &&ratio>=1.2&&ratio<=2.5))return null;
  return {breakout_date:String(r.date),box_top:b.top,box_bottom:b.bottom,
    width_pct:b.width_pct,box_days:b.days,breakout_volume_ratio:Math.round(ratio*100)/100,
    breakout_index:y};
}
function boxStrategyMetrics(rows,context){
  const n=rows.length,i=n-1,px=Number(rows[i]?.close);
  const range=boxRangeAt(rows,i);
  const closePrices=rows.slice(-5).map(r=>[String(r.date),Number(r.close)]);
  const ma20=Number(context.ma20),ma10=Number(context.ma10),ma60=Number(context.ma60);
  let origin=null;
  for(let y=Math.max(65,i-45);y<=i;y++){
    const b=boxRangeAt(rows,y),candidate=boxBreakAt(rows,y,b);
    if(!candidate)continue;
    const c=Number(rows[y].close),m20=Number(context.ma20_at(y));
    if(!(m20>0&&c/m20<=1+context.chase_limit/100))continue;
    // Keep the first valid breakout for a sequence, not a newly rolling
    // moving range that would silently shift an active support line.
    if(!origin||y-origin.breakout_index>20)origin=candidate;
  }
  const recent=origin&&i-origin.breakout_index<=30?origin:null;
  const since=recent?i-recent.breakout_index:null;
  let below=0;
  if(recent)for(let z=i;z>recent.breakout_index;z--){
    if(Number(rows[z].close)<recent.box_bottom)below++;
    else break;
  }
  const touched=!!(recent&&since>=1&&since<=12&&
    Number(rows[i].min)<=recent.box_top*1.015&&
    Number(rows[i].min)>=recent.box_top*.985&&px>=recent.box_top);
  const dayVolume=Number(rows[i].Trading_Volume)||0;
  const avg=recent?boxRangeAt(rows,recent.breakout_index)?.avg20:range?.avg20;
  const retest=!!(touched&&avg>0&&dayVolume>=1000000&&
    dayVolume/avg>=.8&&dayVolume/avg<=2.0&&ma20>0&&
    px>=ma20&&px/ma20<=1+context.chase_limit/100&&ma10>0&&ma60>0&&px>=Math.max(ma10,ma20,ma60));
  // Independent Shan-Chuan EOD watch, never authorizes trades or changes original V5.
  const rawBreak=boxBreakAt(rows,i,range);
  const c=Number(rows[i]?.close),v=Number(rows[i]?.Trading_Volume)||0;
  const pos=Number(context.position_pct),rawAvg=range?.avg20||0;
  const readyWatch=!!(range&&!rawBreak&&c>=range.top*.97&&c<=range.top*1.003
    &&v>=1000000&&rawAvg>=500000&&Number.isFinite(pos)&&pos>=0&&pos<=60);
  const ma20Gap=ma20>0?(c/ma20-1)*100:null;
  const risk=ma20Gap!=null&&ma20Gap>context.chase_limit?'MA20正乖離超過 +'+context.chase_limit+'%，不得試單'
    :context.entry_guard?.weak_after_breakout===true||context.strong_breakdown===true
      ?'既有風控轉弱，不得試單':null;
  const discovery={
    version:'2026-10-16-shanchuan-independent-v2',
    as_of:String(rows[i]?.date||''),current_20day_box:!!range,
    ready_watch:readyWatch,first_bar_today:!!rawBreak,
    first_bar_date:rawBreak?String(rows[i].date):null,
    top:range?Math.round(range.top*100)/100:null,
    bottom:range?Math.round(range.bottom*100)/100:null,
    first_volume_ratio:rawBreak?.breakout_volume_ratio??null,
    ma60_rising_not_required:true,ma_all_rising:context.ma_all_rising===true,
    ma20_distance_pct:ma20Gap==null?null:Math.round(ma20Gap*100)/100,
    restricted_for_trial:!!risk,restriction:risk,
    state:rawBreak?'first_breakout_eod':readyWatch?'box_near_top_watch':range?'box_consolidation':'none',
    actionable:false,formal_buy_unlocked:false,
    note:'山川箱型觀察獨立於MA10/20/60齊揚，原V5正式買點及風控不變'
  };
  const ready=!!(range&&!recent&&px>=range.bottom&&px<=range.top*1.003
    &&px>=range.top*.97&&ma20>0&&px>=ma20*.985);

  // Show support/resistance from the original breakout box when available,
  // otherwise from the last 20 COMPLETED sessions; never rewrite a held anchor.
  const levels=recent?{top:recent.box_top,bottom:recent.box_bottom,
    source:'confirmed_breakout',breakout_date:recent.breakout_date}
    :range?{top:range.top,bottom:range.bottom,
    source:'rolling_prior_20',breakout_date:null}:null;
  let rangeState='no_valid_20day_box';
  if(recent){
    if(below>=3)rangeState='support_broken_3d';
    else if(below>0)rangeState='support_lost_warning';
    else if(retest)rangeState='retest_held';
    else if(since===0)rangeState='breakout_confirmed';
    else if(px>=recent.box_top)rangeState='above_resistance';
    else rangeState='back_in_range';
  }else if(range){
    if(px<range.bottom)rangeState='support_below_watch';
    else if(px>range.top*1.003)rangeState='breakout_without_confirmation';
    else if(px>=range.top*.97)rangeState='near_resistance';
    else if(px<=range.bottom*1.022)rangeState='near_support';
    else rangeState='range_consolidation';
  }
  return {version:'2026-10-16-20day-box-v1',range_days:20,box_range:range?
    {top:Math.round(range.top*100)/100,bottom:Math.round(range.bottom*100)/100,
    width_pct:range.width_pct,days:20}:null,
    prepared:ready,breakout_today:!!(recent&&since===0),
    anchor:recent?{breakout_date:recent.breakout_date,
      top:Math.round(recent.box_top*100)/100,
      bottom:Math.round(recent.box_bottom*100)/100,
      width_pct:recent.width_pct}:null,
    days_since_breakout:since,retest_held:retest,below_box_days:recent?below:null,
    recent_closes:closePrices,range_state:rangeState,
    levels:levels?{top:Math.round(levels.top*100)/100,
      bottom:Math.round(levels.bottom*100)/100,source:levels.source,
      breakout_date:levels.breakout_date,as_of:String(rows[i]?.date||'')}:null,
    as_of:String(rows[i]?.date||''),discovery,
    model_generation:'shanchuan-independent-v2',
    ma20_guard_pass:ma20>0&&px>=ma20&&px/ma20<=1+context.chase_limit/100,
    research_only:true,automatic_order:false,
    note:'箱頂箱底以突破前20交易日固定；盤中突破配量僅小量試單候選，回踩箱頂且風控全過才評估加碼；持股出場只依買進當時鎖定的箱底連3日收盤未站回，或原MA20三日規則。'}; 
}

/* Prospective EOD-only box study using the same FinMind OHLCV that the
   nightly scan already fetched. No extra network access or scan cadence.
   No historical chip snapshots exist, so this must NEVER be called a
   validated joint chip/pattern strategy or unlock a production buy. */
function boxHistoricalAudit(rows,chaseLimit:number){
  const groups:any={calibration:{n:0,wins:0,sum:0,losers:0,mae:0,days:0},
    validation_2025:{n:0,wins:0,sum:0,losers:0,mae:0,days:0},
    holdout_2026:{n:0,wins:0,sum:0,losers:0,mae:0,days:0}};
  const n=rows.length,cl=rows.map(r=>Number(r.close)),
    op=rows.map(r=>Number(r.open||r.close)),
    hi=rows.map(r=>Number(r.max)),lo=rows.map(r=>Number(r.min));
  let lastSignal=-99,accepted=0;
  const feeBuy=.001425,feeSell=.004425;
  for(let x=260;x<=n-31;x++){
    if(x-lastSignal<30)continue;
    const box=boxRangeAt(rows,x),breakout=boxBreakAt(rows,x,box);
    if(!breakout)continue;
    const m10=sma(cl,10,x),m20=sma(cl,20,x),m60=sma(cl,60,x),
      m10p=sma(cl,10,x-5),m20p=sma(cl,20,x-5),m60p=sma(cl,60,x-5);
    if(!m10||!m20||!m60||!m10p||!m20p||!m60p||
      m10<m10p||m20<m20p||m60<m60p||
      cl[x]<Math.max(m10,m20,m60)||cl[x]/m20>1+chaseLimit/100)continue;
    const high252=maxN(hi,252,x-1),low252=minN(lo,252,x-1);
    const position=(cl[x]-low252)/(high252-low252||1);
    if(!(position>=0&&position<=.45))continue;
    const entry=op[x+1];
    if(!(entry>0))continue;
    lastSignal=x;accepted++;
    let soldThird=false,remaining=1,cash=0,belowBox=0,belowMa20=0,holdingDays=30;
    let minLow=Infinity;
    // Track a maximum of 30 completed trading days after next-open entry.
    // All close-derived decisions execute only at the next day's OPEN.
    for(let d=x+1;d<=x+30;d++){
      if(d>n-1)break;
      minLow=Math.min(minLow,lo[d]);
      const currentMa20=sma(cl,20,d);
      belowBox=cl[d]<box.bottom?belowBox+1:0;
      belowMa20=currentMa20&&cl[d]<currentMa20?belowMa20+1:0;
      const exitSignal=belowBox>=3||belowMa20>=3;
      const finalDay=d===x+30;
      if(exitSignal||finalDay){
        const execute=exitSignal&&d<n-1?op[d+1]:cl[d];
        cash+=remaining*execute*(1-feeSell);
        remaining=0;holdingDays=d-x+(exitSignal&&d<n-1?1:0);
        break;
      }
      if(!soldThird&&cl[d]/entry>=1.2&&d<n-1){
        cash+=(1/3)*op[d+1]*(1-feeSell);
        remaining-=1/3;soldThird=true;
      }
    }
    if(remaining>0)continue;
    const net=(cash/(entry*(1+feeBuy))-1)*100;
    const date=String(rows[x].date||'');
    const g=date>='2026-01-01'?groups.holdout_2026:
      date>='2025-01-01'?groups.validation_2025:groups.calibration;
    g.n++;g.sum+=net;g.wins+=Number(net>0);g.losers+=Number(net<=0);
    g.mae+=minLow/entry*100-100;g.days+=holdingDays;
  }
  const pack=(g:any)=>({trades:g.n,
    win_pct:g.n?Math.round(g.wins/g.n*1000)/10:null,
    avg_net_pct:g.n?Math.round(g.sum/g.n*100)/100:null,
    avg_hold_days:g.n?Math.round(g.days/g.n*10)/10:null,
    avg_min_intratrade_pct:g.n?Math.round(g.mae/g.n*100)/100:null});
  return {version:'2026-10-16-box-eod-backtest-v1',
    calibration_2022_2024:pack(groups.calibration),
    validation_2025:pack(groups.validation_2025),
    holdout_2026:pack(groups.holdout_2026),
    observations:accepted,
    assumptions:'日K箱型突破訊號隔日開盤進場；連3日收盤跌破箱底或MA20次日開盤出場；30日到期收盤出場；+20%收盤達標次日開盤先賣1/3；不模擬加碼。',
    missing:'缺歷史籌碼逐日快照、滑價、實際成交限制；此為箱型量價子策略歷史測試，並非山川完整策略績效。',
    actionable:false,production_signal_enabled:false};
}

Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:H});if(req.method!=='GET')return resp({ok:false,error:'GET only'},405);const u=new URL(req.url);const symbol=(u.searchParams.get('symbol')||'').trim();if(!/^\d{4,6}$/.test(symbol))return resp({ok:false,error:'symbol required, e.g. 2330'},400);const end=u.searchParams.get('end')||new Date().toISOString().slice(0,10);const start=u.searchParams.get('start')||(()=>{const d=new Date(end);d.setUTCFullYear(d.getUTCFullYear()-4);return d.toISOString().slice(0,10)})();const q=new URL(FINMIND);q.searchParams.set('dataset','TaiwanStockPrice');q.searchParams.set('data_id',symbol);q.searchParams.set('start_date',start);q.searchParams.set('end_date',end);const r=await getJson(q.toString());if(!r.ok)return resp({ok:false,source:'FinMind',status:r.status,error:r.body},502);const rows=(r.body?.data||[]).filter((x:any)=>x.close!=null).sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date)));if(rows.length<260)return resp({ok:false,error:'not enough history',rows:rows.length},422);const entryCandleGuard=candleEntryMetrics(rows);if(u.searchParams.get('mode')==='entry_guard')return resp({ok:true,symbol,as_of:rows[rows.length-1].date,entry_candle_guard:entryCandleGuard});const o=rows.map((x:any)=>+x.open||+x.close),c=rows.map((x:any)=>+x.close),h=rows.map((x:any)=>+x.max),l=rows.map((x:any)=>+x.min),v=rows.map((x:any)=>+x.Trading_Volume||0);const i=c.length-1,last=c[i];const ma10=sma(c,10,i),ma20=sma(c,20,i),ma60=sma(c,60,i),ma120=sma(c,120,i),ma240=sma(c,240,i);const ma10p5=sma(c,10,Math.max(9,i-5)),ma20p5=sma(c,20,Math.max(19,i-5)),ma60p=sma(c,60,Math.max(59,i-5)),ma120p5=sma(c,120,Math.max(119,i-5)),ma240p5=sma(c,240,Math.max(239,i-5));const high252=maxN(h,252,i),low252=minN(l,252,i),high756=maxN(h,756,i),low756=minN(l,756,i);const pos252=(last-low252)/(high252-low252||1),pos756=(last-low756)/(high756-low756||1),dd252=last/high252-1;const dkd=kd(h,l,c);const w=aggregate(rows,'week'),m=aggregate(rows,'month');const wkd=kd(w.map(x=>x.high),w.map(x=>x.low),w.map(x=>x.close)),mkd=kd(m.map(x=>x.high),m.map(x=>x.low),m.map(x=>x.close));const dnow=dkd[i],dprev=dkd[i-1],wnow=wkd[wkd.length-1],wprev=wkd[Math.max(0,wkd.length-2)],mnow=mkd[mkd.length-1];const revStartDate=new Date(start+'T00:00:00Z');revStartDate.setUTCMonth(revStartDate.getUTCMonth()-14);const revenueRows=await revenueHistory(symbol,fmtDate(revStartDate),rows[i].date);const revenueNow=revenueAt(revenueRows,rows[i].date);
function coreBAt(x:number){if(x<260||x>=c.length)return {a:0,b:0,volRatio:0};const px=c[x],m20=sma(c,20,x),m60=sma(c,60,x),m60p5=sma(c,60,Math.max(59,x-5));const hi252=maxN(h,252,x),lo252=minN(l,252,x),hi756=maxN(h,756,x),lo756=minN(l,756,x);const p252=(px-lo252)/(hi252-lo252||1),p756=(px-lo756)/(hi756-lo756||1),dd=px/hi252-1,lo60=minN(l,60,x),hp=maxN(h,20,x-1);const vr=(sma(v,5,x)||0)/(sma(v,20,x)||1);let rg=0;for(let j=1;j<=5;j++){const idx=x-60+j;if(idx>=0&&px>c[idx])rg++}let a=0;if(dd<=-.25)a+=22;if(p252<=.35)a+=20;if(p756<=.45)a+=15;if(px>=lo60*1.05)a+=12;if(m60&&m60p5&&m60>=m60p5*.99)a+=12;if(rg>=3)a+=5;let b=Math.round(a*.45);const bo=px>hp;const cr=m60!=null&&px>m60&&c[x-1]<=(sma(c,60,x-1)||Infinity);if(bo)b+=22;if(cr)b+=18;if(vr>=1.05)b+=8;if(dkd[x].k>dkd[x].d&&dkd[x].k>dkd[x-1].k)b+=8;if(m20&&px>m20)b+=5;a=Math.min(100,Math.round(a));b=Math.min(100,Math.round(b));const rev=revenueAt(revenueRows,rows[x].date);if(rev.coverage)b=Math.min(100,Math.round(b*.82+rev.score*.18));return {a,b,volRatio:vr}}
const low60=minN(l,60,i),high20prev=maxN(h,20,i-1),recentHigh20=maxN(h,20,i),prevHigh20=maxN(h,20,i-2);const vol5=sma(v,5,i)||0,vol20=sma(v,20,i)||1;const volRatio=vol5/vol20;const currentVolumeLots=Math.round((v[i]||0)/1000);const avg20VolumeLots=Math.round(vol20/1000);const liquidityOk=currentVolumeLots>=1000&&avg20VolumeLots>=500;const liquidityLabel=liquidityOk?(currentVolumeLots<=5000?'流動性佳':'高流動性'):(currentVolumeLots<1000&&avg20VolumeLots<500?'流動性偏低':currentVolumeLots<1000?'當日量偏低':'20日均量偏低');let rollGood=0;for(let j=1;j<=5;j++){const idx=i-60+j;if(idx>=0&&last>c[idx])rollGood++}const breakout20=last>high20prev;const previousDayBreakout20=i>1&&c[i-1]>prevHigh20;const firstBreakout20=breakout20&&!previousDayBreakout20;const nearBreakout20Pct=recentHigh20>0?(last/recentHigh20-1)*100:null;
const maVals=[ma10,ma20,ma60].map(Number).filter((x:any)=>Number.isFinite(x)&&x>0),maMax=maVals.length===3?Math.max(...maVals):null,maMin=maVals.length===3?Math.min(...maVals):null;
const maClusterSpreadPct=maMax!=null&&maMin!=null&&maMin>0?(maMax/maMin-1)*100:null;
const maRising10=!!(ma10&&ma10p5&&ma10>ma10p5),maRising20=!!(ma20&&ma20p5&&ma20>ma20p5),maRising60=!!(ma60&&ma60p&&ma60>ma60p);
const chase=chaseRisk(symbol,last,Number(ma20));const maAllRising=maRising10&&maRising20&&maRising60,maClusterPass=maClusterSpreadPct!=null&&maClusterSpreadPct<=8,priceAboveAllMas=maMax!=null&&last>=maMax,ma20DistancePct=ma20&&ma20>0?(last/ma20-1)*100:null;
const dayVolumeRatio=avg20VolumeLots>0?currentVolumeLots/avg20VolumeLots:0,signalDayReturnPct=c[i-1]>0?(last/c[i-1]-1)*100:999,priceVolumeFollow=last>o[i]&&last>c[i-1]&&dayVolumeRatio>=1.0;
let belowMa20Days=0;
for(let x=i;x>=Math.max(19,i-10);x--){
  const mx=sma(c,20,x);
  if(mx!=null&&c[x]<mx) belowMa20Days++; else break;
}
const prevLow=Number(l[i-1]||0),prevPrevLow=Number(l[i-2]||0);
const prevLowBreakPct=prevLow>0?(last/prevLow-1)*100:null;
const effectivePrevLowBreak=prevLow>0&&last<prevLow*.996;
const prevDayEffectiveBreak=prevPrevLow>0&&c[i-1]<prevPrevLow*.996;
const recoveredPrevLow=prevDayEffectiveBreak&&last>=prevPrevLow;
// 2026-10-20 strict risk generation: S publishes TECHNICAL add setups only.
// Whether a saved holding can actually add requires owner-specific cost >=+3%,
// no loss, and max 50% of the first position; those checks remain in authenticated front end.
const HOLDING_RISK_POLICY_VERSION='2026-10-29-hard10-arm20-peaktrail5-v1';
const ma5ForHolding=Number(entryCandleGuard?.ma5);
const holdingMaBull=Number.isFinite(ma5ForHolding)&&ma5ForHolding>0&&ma10!=null&&ma20!=null&&ma60!=null
  &&ma5ForHolding>ma10&&ma10>ma20&&ma20>ma60&&last>=ma5ForHolding;
const touchedMa20=ma20!=null&&l[i]<=ma20*1.02&&l[i]>=ma20*.97;
const heldMa20=ma20!=null&&last>=ma20;
const holdingVolumeFollow=currentVolumeLots>=1000&&avg20VolumeLots>=500&&dayVolumeRatio>=1.2&&dayVolumeRatio<=2.2;
const holdingHeavyBreakVolume=dayVolumeRatio>=1.2;
const holdingPriceTurn=last>o[i]&&last>=c[i-1]&&dnow.k>=dprev.k;
const touchedMa10=ma10!=null&&l[i]<=ma10*1.01&&l[i]>=ma10*.985&&last>=ma5ForHolding&&last<=ma10*1.06;
const touchedMa5=Number.isFinite(ma5ForHolding)&&ma5ForHolding>0
  &&l[i]<=ma5ForHolding*1.01&&l[i]>=ma5ForHolding*.985
  &&last>=ma5ForHolding&&last<=ma5ForHolding*1.04;
const holdingMa5SetupReady=!!(chase.pass&&holdingMaBull&&touchedMa5&&holdingVolumeFollow&&holdingPriceTurn
  &&!effectivePrevLowBreak&&belowMa20Days===0&&entryCandleGuard?.weak_after_breakout!==true);
const holdingMa10SetupReady=!!(chase.pass&&holdingMaBull&&touchedMa10&&holdingVolumeFollow&&holdingPriceTurn
  &&!effectivePrevLowBreak&&belowMa20Days===0&&entryCandleGuard?.weak_after_breakout!==true);
const priorMa20=sma(c,20,i-1);
const ma20Reclaimed=priorMa20!=null&&c[i-1]<priorMa20&&ma20!=null&&last>=ma20;
// The old MA20-retest / reclaim signals MUST NEVER unlock an add.
const holdingAddSetupReady=holdingMa5SetupReady||holdingMa10SetupReady;
const holdingExitReady=belowMa20Days>=3;
const holdingLongBlack=o[i]>0&&((last/o[i]-1)*100)<=-2.5;
const holdingManagement:any={
  policy_version:HOLDING_RISK_POLICY_VERSION,
  below_ma20_days:belowMa20Days,
  touched_ma5:touchedMa5,
  touched_ma10:touchedMa10,
  held_ma10:ma10!=null&&last>=ma10,
  ma5_retest_setup_ready:holdingMa5SetupReady,
  ma10_retest_setup_ready:holdingMa10SetupReady,
  add_setup_ready:holdingAddSetupReady,
  // Cost is never available to this public all-market analyzer. No unconditional add signal.
  add_ready:false,add_requires_cost_validation:true,
  ma10_add_ready:false,ma20_retest_add_ready:false,ma20_reclaim_add_ready:false,
  ma20_reclaimed:ma20Reclaimed,
  touched_ma20:touchedMa20,
  held_ma20:heldMa20,
  distance_to_ma20_pct:ma20&&ma20>0?pct((last/ma20-1)*100,2):null,
  day_volume_ratio:pct(dayVolumeRatio,2),
  volume_follow:holdingVolumeFollow,
  price_turn:holdingPriceTurn,
  exit_ready:holdingExitReady,
  prev_low:pct(prevLow,2),
  prev_low_break_pct:pct(prevLowBreakPct,2),
  effective_prev_low_break:effectivePrevLowBreak,
  break_volume_heavy:holdingHeavyBreakVolume,
  recovered_prev_low:recoveredPrevLow,
  long_black:holdingLongBlack,
  chip_weak:false,
  strong_breakdown:false,
  stop_pct:-10,breakeven_arm_pct:null,take_profit_full_pct:null,trailing_arm_profit_pct:20,trailing_retrace_from_peak_pct:5,trailing_peak_source:'verified_post_buy_required',alert_only:true,
  profit_add_min_pct:3,max_add_fraction_first_position:.5,
  ma5_profit_exit_before_pct:10,
  priority:['-10% hard stop with owner cost','peak >=+20% arms 5% trailing from verified post-buy peak','MA20 three-close auxiliary review'],
  rule:'成本-10%硬停損；買入後已驗證最高價達成本+20%啟動最高價回撤5%移動停利提醒；不以+10%固定停利或+5%保本取代。MA20連3日收盤跌破另提示隔日檢視；虧損不得因技術訊號直接攤平，符合獨立例外條件仍須持股成本及量價驗證；S公用快照不含個人成本，不可提供實際出場價或加碼指令'
};
const maClusterWatchReady=maAllRising&&priceAboveAllMas&&avg20VolumeLots>=500&&currentVolumeLots>=1000&&high20prev>0&&last>=high20prev*.95&&last<=high20prev;
const maClusterRawBreakout=firstBreakout20&&maAllRising&&priceAboveAllMas&&liquidityOk&&priceVolumeFollow;
const maClusterFirstBreakout=maClusterRawBreakout&&signalDayReturnPct<=8;

// 起漲起點與「20日前高首突破」分開判斷。
// 起漲起點抓的是整理後第一次重新站上 MA10/20/60 的低延伸紅K，避免後面真正突破20日前高時誤標成「起漲第一根」。
function launchOriginAt(x:number){
  if(x<60||x>=c.length||x<1)return null;
  const px=c[x],prevPx=c[x-1];
  const m10=sma(c,10,x),m20=sma(c,20,x),m60=sma(c,60,x);
  const pm10=sma(c,10,x-1),pm20=sma(c,20,x-1),pm60=sma(c,60,x-1);
  if(!m10||!m20||!m60||!pm10||!pm20||!pm60)return null;
  const maxMa=Math.max(m10,m20,m60),minMa=Math.min(m10,m20,m60),prevMax=Math.max(pm10,pm20,pm60);
  const spread=minMa>0?(maxMa/minMa-1)*100:999;
  const curLots=Math.round((v[x]||0)/1000),avgLots=Math.round((sma(v,20,x)||0)/1000);
  const ext20=(px/m20-1)*100;
  const ret=prevPx>0?(px/prevPx-1)*100:999;
  const k=Number(dkd[x]?.k),d=Number(dkd[x]?.d);
  const crossedAll=px>=maxMa&&prevPx<prevMax;
  const healthyStart=crossedAll&&spread<=8&&px>o[x]&&px>prevPx&&curLots>=1000&&avgLots>=500&&ext20>=-1&&ext20<=3&&ret>0&&ret<=8&&Number.isFinite(k)&&Number.isFinite(d)&&k>=d&&k<=75;
  if(!healthyStart)return null;
  return {idx:x,date:String(rows[x].date),price:px,ma20:m20,ma_spread_pct:spread,ma20_extension_pct:ext20,return_pct:ret,k,d};
}
let recentLaunchOrigin:any=null;
for(let x=i;x>=Math.max(60,i-15);x--){const z=launchOriginAt(x);if(z){recentLaunchOrigin=z;break}}

function launchAt(x:number){
  if(x<245||x>=c.length)return null;
  const px=c[x],m10x=sma(c,10,x),m20x=sma(c,20,x),m60x=sma(c,60,x);
  const m10p=sma(c,10,Math.max(9,x-5)),m20p=sma(c,20,Math.max(19,x-5)),m60p=sma(c,60,Math.max(59,x-5));
  if(!m10x||!m20x||!m60x||!m10p||!m20p||!m60p)return null;
  const hp=maxN(h,20,x-1),hpp=maxN(h,20,x-2),first=px>hp&&c[x-1]<=hpp;
  const rising=m10x>m10p&&m20x>m20p&&m60x>m60p;
  const above=px>=Math.max(m10x,m20x,m60x);
  const av=sma(v,20,x)||0,curLots=Math.round((v[x]||0)/1000),avgLots=Math.round(av/1000),vr=av>0?(v[x]||0)/av:0;
  const ret=c[x-1]>0?(px/c[x-1]-1)*100:999,follow=px>o[x]&&px>c[x-1]&&vr>=1;
  const raw=first&&rising&&above&&curLots>=1000&&avgLots>=500&&follow;
  if(!raw)return null;
  return {idx:x,date:String(rows[x].date),breakout_price:hp,close:px,return_pct:ret,day_volume_ratio:vr,actionable:ret<=8,overheated:ret>8||vr>2.5};
}
let recentLaunch:any=null;
for(let x=i;x>=Math.max(245,i-8);x--){const z=launchAt(x);if(z){recentLaunch=z;break}}
const launchDays=recentLaunch?i-recentLaunch.idx:null;
const launchBreak=Number(recentLaunch?.breakout_price||0);
const nearBreakSupport=recentLaunch&&launchDays!=null&&launchDays>=1&&launchDays<=8&&launchBreak>0&&l[i]<=launchBreak*1.03&&last>=launchBreak*.99;
const nearMa20Support=recentLaunch&&launchDays!=null&&launchDays>=1&&launchDays<=8&&ma20&&l[i]<=ma20*1.03&&last>=ma20;
const launchSecondBuy=!!recentLaunch&&launchDays!=null&&launchDays>=1&&launchDays<=8&&(nearBreakSupport||nearMa20Support)&&last>c[i-1]&&dnow.k>=dprev.k&&dayVolumeRatio<=1.5;
const launchSequence=recentLaunch?{first_signal_date:recentLaunch.date,days_since_first:launchDays,first_breakout_price:pct(recentLaunch.breakout_price,2),first_close:pct(recentLaunch.close,2),first_return_pct:pct(recentLaunch.return_pct,2),first_volume_ratio:pct(recentLaunch.day_volume_ratio,2),first_actionable:recentLaunch.actionable,first_overheated:recentLaunch.overheated,distance_from_breakout_pct:launchBreak>0?pct((last/launchBreak-1)*100,2):null,continuation:launchDays!=null&&launchDays>=1&&launchDays<=3&&last>=launchBreak,second_buy_candidate:launchSecondBuy,support_type:launchSecondBuy?(nearBreakSupport?'breakout':'ma20'):null}:null;
const displayPriorBreakoutDate=entryCandleGuard?.breakout_date&&String(entryCandleGuard.breakout_date)<String(rows[i].date)?String(entryCandleGuard.breakout_date):null;
const displayPriorLaunchDate=recentLaunchOrigin&&String(recentLaunchOrigin.date)<String(rows[i].date)?String(recentLaunchOrigin.date):null;
const displayFirstBar=maClusterFirstBreakout&&displayPriorBreakoutDate==null&&displayPriorLaunchDate==null;
const maClusterSignal={name:'rising3_ma10_20_60_first_breakout',required_ma_set:['MA10','MA20','MA60'],cluster_spread_pct:pct(maClusterSpreadPct,2),cluster_max_pct:8,cluster_pass:maClusterPass,cluster_role:'bonus_not_gate',slope_days:5,all_rising:maAllRising,rising:{ma10:maRising10,ma20:maRising20,ma60:maRising60},above_all_mas:priceAboveAllMas,ma20_distance_pct:pct(ma20DistancePct,2),breakout_price:pct(high20prev,2),distance_to_breakout_pct:high20prev>0?pct((last/high20prev-1)*100,2):null,day_volume_ratio:pct(dayVolumeRatio,2),signal_day_return_pct:pct(signalDayReturnPct,2),volume_price_follow:priceVolumeFollow,watch_ready:maClusterWatchReady,breakout_detected_raw:maClusterRawBreakout,breakout_first_bar:maClusterFirstBreakout,display_first_bar:displayFirstBar,prior_breakout_date:displayPriorBreakoutDate,launch_origin_date:recentLaunchOrigin?.date??null,launch_origin_price:recentLaunchOrigin?pct(recentLaunchOrigin.price,2):null,launch_origin_ma20_extension_pct:recentLaunchOrigin?pct(recentLaunchOrigin.ma20_extension_pct,2):null,launch_origin_reason:recentLaunchOrigin?'整理後首次重新站上MA10/20/60，且仍貼近MA20':'',breakout_overheated:maClusterRawBreakout&&(signalDayReturnPct>8||dayVolumeRatio>2.5),launch_sequence:launchSequence,rules:{cluster_max_pct:8,cluster_is_bonus:true,ma_slope_days:5,required_ma_set:['MA10','MA20','MA60'],all_three_ma_rising_required:true,price_above_ma10_ma20_ma60_required:true,volume_ratio_min:1.0,signal_day_return_max_pct:8,daily_volume_min_lots:1000,avg20_volume_min_lots:500,breakout:'收盤首次突破前20日高點且前一日尚未突破',discovery_rule:'2026-10-06：MA10/20/60上揚＋股價站上三線；均線糾結<=8%只加分不淘汰；首破20日前高＋紅K量價跟上即抓，過熱只標記'}};
const cross60=ma60!=null&&last>ma60&&c[i-1]<=(sma(c,60,i-1)||Infinity);let v5PriorBreakout:any=null;for(let y=i-3;y>=Math.max(260,i-8);y--){const hp=maxN(h,20,y-1),hpp=maxN(h,20,y-2);if(c[y]>hp&&c[y-1]<=hpp){v5PriorBreakout={idx:y,date:rows[y].date,level:hp,price:c[y]};break}}let v5PullbackDays:number|null=null,v5PullbackDepth:number|null=null,v5RebreakTrigger:number|null=null,v5PendingBase=false,v5RebreakBase=false;if(v5PriorBreakout){let mn=Infinity;for(let z=v5PriorBreakout.idx+1;z<=i;z++)mn=Math.min(mn,l[z]);v5PullbackDays=i-v5PriorBreakout.idx;v5PullbackDepth=(mn/v5PriorBreakout.level-1)*100;v5RebreakTrigger=maxN(h,3,i-1);v5PendingBase=v5PullbackDays>=3&&v5PullbackDays<=8&&v5PullbackDepth>=-4&&v5PullbackDepth<=3&&avg20VolumeLots>=500&&wnow.k>=80&&mnow.k>=80;v5RebreakBase=v5PendingBase&&last>v5RebreakTrigger&&last>c[i-1]&&dnow.k>dprev.k&&currentVolumeLots>=1000}
const recentB:any[]=[];for(let x=Math.max(260,i-30);x<=i-3;x++){const s=coreBAt(x);if(s.b>=70)recentB.push({idx:x,price:c[x],date:rows[x].date,b:s.b})}const rb=recentB.length?recentB[recentB.length-1]:null;let pullback=false;if(rb){let minAfter=Infinity;for(let x=rb.idx+1;x<=i;x++)minAfter=Math.min(minAfter,l[x]);const support=Math.max(rb.price,ma20||0,ma60||0);pullback=minAfter<=support*1.04&&minAfter>=support*.94&&last>c[i-1]&&dnow.k>dprev.k}
let A=0;const reasonsA:string[]=[];if(dd252<=-.25){A+=22;reasonsA.push('近一年曾明顯跌深')}if(pos252<=.35){A+=20;reasonsA.push('一年位階偏低')}if(pos756<=.45){A+=15;reasonsA.push('長週期位階仍低')}if(last>=low60*1.05){A+=12;reasonsA.push('已脫離60日最低點')}if(ma60&&ma60p&&ma60>=ma60p*.99){A+=12;reasonsA.push('季線下彎已鈍化')}if(rollGood>=3){A+=5;reasonsA.push('未來季線扣抵改善')}
let B=Math.round(A*.45);const reasonsB=[...reasonsA.slice(0,3)];if(breakout20){B+=22;reasonsB.push('突破20日平台')}if(cross60){B+=18;reasonsB.push('站回季線')}if(volRatio>=1.05){B+=8;reasonsB.push('量能配合')}if(dnow.k>dnow.d&&dnow.k>dprev.k){B+=8;reasonsB.push('日KD轉強')}if(ma20&&last>ma20){B+=5;reasonsB.push('站上20日線')}
let C=Math.round(B*.55);const reasonsC=[...reasonsB.slice(-3)];if(rb){C+=15;reasonsC.push(`近30日曾B轉強(${rb.date}，${rb.b}分)`)}if(rb&&pullback){C+=22;reasonsC.push('B轉強後首次回測支撐再轉強')}if(rb&&volRatio<=1.2&&pullback){C+=5;reasonsC.push('回測量能未失控')}if(rb&&dnow.k>dprev.k&&dnow.k<70){C+=5;reasonsC.push('日KD重新向上且未過熱')}
A=Math.min(100,Math.round(A));B=Math.min(100,Math.round(B));C=Math.min(100,Math.round(C));const technicalScores={A,B,C};if(revenueNow.coverage){B=Math.min(100,Math.round(B*.82+revenueNow.score*.18));C=Math.min(100,Math.round(C*.82+revenueNow.score*.18))}let stage='WATCH';let score=A;let reasons=reasonsA;if(rb&&C>=70){stage='C';score=C;reasons=[...reasonsC,revenueNow.coverage?revenueNow.label:'營收資料不足，未納入加權']}else if(B>=70){stage='B';score=B;reasons=[...reasonsB,revenueNow.coverage?revenueNow.label:'營收資料不足，未納入加權']}else if(A>=65){stage='A';score=A;reasons=reasonsA}const stageBeforeChip=stage;const scoreBeforeChip=score
function historicalSetupAt(x:number){if(x<260||x>=c.length)return null;const px=c[x],m20=sma(c,20,x),m60=sma(c,60,x),m60p5=sma(c,60,Math.max(59,x-5));const hi252=maxN(h,252,x),lo252=minN(l,252,x),hi756=maxN(h,756,x),lo756=minN(l,756,x);const p252=(px-lo252)/(hi252-lo252||1),p756=(px-lo756)/(hi756-lo756||1),dd=px/hi252-1,lo60=minN(l,60,x),hp=maxN(h,20,x-1);const vr=(sma(v,5,x)||0)/(sma(v,20,x)||1);let rg=0;for(let j=1;j<=5;j++){const idx=x-60+j;if(idx>=0&&px>c[idx])rg++}let a=0;if(dd<=-.25)a+=22;if(p252<=.35)a+=20;if(p756<=.45)a+=15;if(px>=lo60*1.05)a+=12;if(m60&&m60p5&&m60>=m60p5*.99)a+=12;if(rg>=3)a+=5;let b=Math.round(a*.45);const bo=px>hp;const cr=m60!=null&&px>m60&&c[x-1]<=(sma(c,60,x-1)||Infinity);if(bo)b+=22;if(cr)b+=18;if(vr>=1.05)b+=8;if(dkd[x].k>dkd[x].d&&dkd[x].k>dkd[x-1].k)b+=8;if(m20&&px>m20)b+=5;let histRb:any=null;for(let y=Math.max(260,x-30);y<=x-3;y++){const prior=coreBAt(y);if(prior.b>=70)histRb={idx:y,price:c[y],b:prior.b}}let histPull=false;if(histRb){let minAfter=Infinity;for(let y=histRb.idx+1;y<=x;y++)minAfter=Math.min(minAfter,l[y]);const support=Math.max(histRb.price,m20||0,m60||0);histPull=minAfter<=support*1.04&&minAfter>=support*.94&&px>c[x-1]&&dkd[x].k>dkd[x-1].k}let cc=Math.round(b*.55);if(histRb)cc+=15;if(histRb&&histPull)cc+=22;if(histRb&&vr<=1.2&&histPull)cc+=5;if(histRb&&dkd[x].k>dkd[x-1].k&&dkd[x].k<70)cc+=5;a=Math.min(100,Math.round(a));b=Math.min(100,Math.round(b));cc=Math.min(100,Math.round(cc));const rev=revenueAt(revenueRows,rows[x].date);const rawB=b,rawC=cc;if(rev.coverage){b=Math.min(100,Math.round(b*.82+rev.score*.18));cc=Math.min(100,Math.round(cc*.82+rev.score*.18))}const st=histRb&&cc>=70?'C':b>=70?'B':a>=65?'A':'WATCH';return {stage:st,score:st==='C'?cc:st==='B'?b:a,technical_score:st==='C'?rawC:st==='B'?rawB:a,revenue_score:rev.score,revenue_coverage:rev.coverage,volRatio:vr,bucket:volumeBucket(vr)}}
let recentBC:any=null;for(let x=Math.max(260,i-30);x<=i;x++){const hs=x===i?{stage,score}:historicalSetupAt(x);if(hs&&(hs.stage==='B'||hs.stage==='C'))recentBC={date:String(rows[x].date),stage:hs.stage,score:Number(hs.score||0)}}
const launchMaLevels=[{label:'MA10',value:ma10},{label:'MA20',value:ma20},{label:'MA60',value:ma60}].filter((x:any)=>Number.isFinite(Number(x.value))&&Number(x.value)>0).map((x:any)=>({label:x.label,value:pct(Number(x.value),2),distance_pct:pct((Number(x.value)/last-1)*100,2)}));
const launchOverhead=launchMaLevels.filter((x:any)=>Number(x.value)>last).sort((a:any,b:any)=>Number(a.value)-Number(b.value));
const launchEligible=A>=80&&pos252<=.35;
const launchStructure=launchMaLevels.length===3&&launchOverhead.length===0?'all_above':launchOverhead.length===1?'one_overhead':'multi_overhead';
const launchCandidate={eligible:launchEligible,a_score:A,position_1y_pct:pct(pos252*100,2),structure:launchStructure,structure_rank:launchStructure==='all_above'?3:launchStructure==='one_overhead'?2:1,available_ma_count:launchMaLevels.length,overhead_count:launchOverhead.length,overhead:launchOverhead,recent_bc_date:recentBC?.date??rb?.date??null,recent_bc_stage:recentBC?.stage??(rb?'B':null),recent_bc_score:recentBC?.score??rb?.b??null,research_note:'發動候選只代表較容易出現短期波段的研究型態，不等於正式買點；正式進場仍以V5與風控為主'};

function bottomBaseAt(x:number){
  if(x<260||x>=c.length)return null;
  const px=c[x],m10x=sma(c,10,x),m20x=sma(c,20,x),m60x=sma(c,60,x),m60p5=sma(c,60,Math.max(59,x-5));
  if(!m10x||!m20x||!m60x)return null;
  const hi252=maxN(h,252,x),lo252=minN(l,252,x),hi756=maxN(h,756,x),lo756=minN(l,756,x);
  const p252=(px-lo252)/(hi252-lo252||1),p756=(px-lo756)/(hi756-lo756||1),dd=px/hi252-1,lo60x=minN(l,60,x);
  let rg=0;for(let j=1;j<=5;j++){const idx=x-60+j;if(idx>=0&&px>c[idx])rg++}
  let a=0;if(dd<=-.25)a+=22;if(p252<=.35)a+=20;if(p756<=.45)a+=15;if(px>=lo60x*1.05)a+=12;if(m60x&&m60p5&&m60x>=m60p5*.99)a+=12;if(rg>=3)a+=5;a=Math.min(100,Math.round(a));
  const ratio5=(sma(v,5,x)||0)/(sma(v,20,x)||1);
  const ext20=(px/m20x-1)*100;
  const eligible=a>=86&&p252<=.35&&px>=m10x&&px>=m20x&&px>=m60x&&dkd[x].k<=70&&ratio5>=.5&&ratio5<=1.5&&ext20>=0&&ext20<=8;
  return {eligible,a_score:a,position_1y_pct:p252*100,volume_5_20_ratio:ratio5,daily_k:dkd[x].k,ma10:m10x,ma20:m20x,ma60:m60x,ext20};
}
const currentBottomBase=bottomBaseAt(i);
let recentBottomBase:any=null;
for(let x=Math.max(260,i-3);x<=i-1;x++){
  const btm=bottomBaseAt(x);
  if(btm?.eligible)recentBottomBase={idx:x,date:String(rows[x].date),...btm};
}
const dayVolumeRatioExact=vol20>0?(v[i]||0)/vol20:null;
const currentExt20=ma20&&ma20>0?(last/ma20-1)*100:null;
const bottomWarmGreen=chase.pass&&!!recentBottomBase&&last>=o[i]&&dayVolumeRatioExact!=null&&dayVolumeRatioExact>=.8&&dayVolumeRatioExact<=1.8&&pos252<=.45&&currentExt20!=null&&currentExt20<=10;
const bottomBonusK=dnow.k>=dnow.d&&dnow.k>dprev.k;
const bottomBonusRecover=i>0&&c[i-1]<o[i-1]&&last>o[i-1];
const bottomStart={
  version:'2026-10-06-bottom-ma10-20-60-v2',required_ma_set:['MA10','MA20','MA60'],ma_rule:'price_above_ma10_ma20_ma60',
  current_base:currentBottomBase?.eligible===true,
  base_score:currentBottomBase?.eligible?currentBottomBase.a_score:null,
  recent_base_date:recentBottomBase?.date??null,
  recent_base_days:recentBottomBase?i-recentBottomBase.idx:null,
  confirmed:bottomWarmGreen,
  warm_green_pass:bottomWarmGreen,
  day_volume_ratio:pct(dayVolumeRatioExact,2),
  position_1y_pct:pct(pos252*100,2),
  ma20_extension_pct:pct(currentExt20,2),
  bonus_k_turn:bottomBonusK,
  bonus_recover_prev_open:bottomBonusRecover,
  live_window_eligible:currentBottomBase?.eligible===true||!!(recentBottomBase&&(i-recentBottomBase.idx)<=2),
  research:{validated_for_current_rule:false,sample_size:null,hit_3pct_10d_pct:null,hit_5pct_10d_pct:null,win_10d_pct:null,avg_return_10d_pct:null,avg_position_1y_pct:null,avg_days_after_base:null,note:'MA10/20/60新版；舊版統計不沿用，待重新驗證'}
};
let backtest:any=null;if(stage!=='WATCH'){const currentBucket=volumeBucket(volRatio);const all:any[]=[];let lastAccepted=-99;const buyFee=.001425,sellFeeTax=.004425;const netRet=(entry:number,exit:number)=>((exit*(1-sellFeeTax))/(entry*(1+buyFee))-1)*100;for(let x=260;x<=i-20;x++){const hs=historicalSetupAt(x);if(!hs||hs.stage!==stage)continue;if(x-lastAccepted<5)continue;const entryIdx=x+1;if(entryIdx>=c.length)continue;const entry=o[entryIdx];if(!Number.isFinite(entry)||entry<=0)continue;lastAccepted=x;const gross=(exitIdx:number)=>(c[exitIdx]/entry-1)*100;const excursion=(exitIdx:number)=>{let hi=-Infinity,lo=Infinity;for(let z=entryIdx;z<=exitIdx;z++){hi=Math.max(hi,h[z]);lo=Math.min(lo,l[z])}return {mfe:(hi/entry-1)*100,mae:(lo/entry-1)*100}};const e10=excursion(x+10);all.push({idx:x,signal_date:rows[x].date,bucket:hs.bucket,r5:netRet(entry,c[x+5]),r10:netRet(entry,c[x+10]),r20:netRet(entry,c[x+20]),g5:gross(x+5),g10:gross(x+10),g20:gross(x+20),mfe10:e10.mfe,mae10:e10.mae,period:rows[x].date>='2025-01-01'?'validation':'calibration'})}const same=all.filter(x=>x.bucket===currentBucket);const regime=same.length>=6?same:all;const validation=regime.filter(x=>x.period==='validation');const calibration=regime.filter(x=>x.period==='calibration'&&x.signal_date>='2022-01-01');const chosen=validation.length>=6?validation:regime;const stat=(arr:any[],key:string)=>{if(!arr.length)return {win:null,avg:null};const vals=arr.map(x=>Number(x[key])).filter(Number.isFinite);if(!vals.length)return {win:null,avg:null};return {win:pct(vals.filter(x=>x>0).length/vals.length*100,1),avg:pct(vals.reduce((a,b)=>a+b,0)/vals.length,2)}};const pack=(arr:any[])=>{const a5=stat(arr,'r5'),a10=stat(arr,'r10'),a20=stat(arr,'r20'),g10=stat(arr,'g10'),mfe=stat(arr,'mfe10'),mae=stat(arr,'mae10');return {sample_size:arr.length,win_rate_5d_pct:a5.win,avg_return_5d_pct:a5.avg,win_rate_10d_pct:a10.win,avg_return_10d_pct:a10.avg,win_rate_20d_pct:a20.win,avg_return_20d_pct:a20.avg,avg_gross_return_10d_pct:g10.avg,avg_mfe_10d_pct:mfe.avg,avg_mae_10d_pct:mae.avg}};const selectedStats=pack(chosen);backtest={method:validation.length>=6?'oos_2025plus_next_open_net':'all_history_next_open_net_fallback',stage,current_volume_regime:bucketLabel(currentBucket),regime_method:same.length>=6?'same_stage_same_volume_regime':'same_stage_fallback',entry_rule:'signal後下一交易日開盤價',exit_rule:'第5/10/20交易日收盤價',cost_assumption:{buy_commission_pct:.1425,sell_commission_pct:.1425,transaction_tax_pct:.3,round_trip_reference_pct:.585},sample_size:selectedStats.sample_size,win_rate_5d_pct:selectedStats.win_rate_5d_pct,avg_return_5d_pct:selectedStats.avg_return_5d_pct,win_rate_10d_pct:selectedStats.win_rate_10d_pct,avg_return_10d_pct:selectedStats.avg_return_10d_pct,win_rate_20d_pct:selectedStats.win_rate_20d_pct,avg_return_20d_pct:selectedStats.avg_return_20d_pct,avg_gross_return_10d_pct:selectedStats.avg_gross_return_10d_pct,avg_mfe_10d_pct:selectedStats.avg_mfe_10d_pct,avg_mae_10d_pct:selectedStats.avg_mae_10d_pct,min_reliable_sample:6,calibration_2022_2024:pack(calibration),validation_2025plus:pack(validation),all_regime_samples:regime.length,revenue_filter_applied:revenueRows.length>0,chip_in_backtest:false,period_years:4}}
const revenue3m20=revenueNow.coverage===true
  &&Number(revenueNow.comparison_months)===3
  &&Number(revenueNow.aggregate_3m_yoy_pct)>20;
const crossedMA20=ma20>0&&i>0&&sma(c,20,i-1)>0
  &&last>ma20&&c[i-1]<=sma(c,20,i-1)
  &&currentVolumeLots>=1000&&dayVolumeRatio>=1.2;
// Only eligible technical+revenue candidates receive two time-capped
// optional financial requests. Runs beside CHIP, no extra scan invocations.
const financialEligible=revenue3m20&&liquidityOk
  &&['A','B','C'].includes(stage)&&score>=65
  &&Number.isFinite(pos252)&&pos252>=0&&pos252<=.75
  &&Number.isFinite(ma20DistancePct)&&ma20DistancePct>=-2&&ma20DistancePct<=12;
const financePromise=financialEligible
  ?candidateQuarterFinancials(symbol,rows[i].date)
    .catch(()=>financialQualityFromRows([],[],rows[i].date)):null;
// One read-only 65-bar pre-breakout result is reused for the existing
// observation AND a bounded CHIP-data fetch, not a new stock scan.
const preattackScout=preBreakoutScoutMetrics(rows);
const preAttackChipNeeded=(stage==='A'&&A>=83&&liquidityOk&&recentHigh20>0&&last>=recentHigh20*.95)
  ||(stage==='WATCH'&&preattackScout.state==='ready'
    &&preattackScout.eligible===true&&liquidityOk
    &&Number.isFinite(pos252)&&pos252>=0&&pos252<=.60
    &&entryCandleGuard.weak_after_breakout!==true
    &&holdingManagement.strong_breakdown!==true);
const tdccFlow=await tdccHolderFlow(symbol,rows[i].date,ma20DistancePct);
let chip:any=null;if(stage==='B'||stage==='C'||preAttackChipNeeded||v5PendingBase){chip=await chipSnapshot(symbol,rows[i].date);if(chip){if(stage==='B'||stage==='C'){const cw=chip.coverage_modules>=2?.30:.18;score=Math.round(score*(1-cw)+chip.score*cw);chip.combined_score=score;chip.live_weight_pct=Math.round(cw*100)}else{chip.combined_score=score;chip.live_weight_pct=0}chip.backtest_included=false}}const holdingChipWeak=!!(chip&&(Number(chip.score||0)<45||(Number(chip?.institutional?.net_5d||0)<0&&Number(chip?.institutional?.positive_days_5d||0)<=1)));
holdingManagement.chip_weak=holdingChipWeak;
holdingManagement.strong_breakdown=!!(belowMa20Days>=1&&holdingLongBlack&&dayVolumeRatio>=1.5&&holdingChipWeak);const v5EntryConfirmed=!!(chase.pass&&v5RebreakBase&&chip&&chip.score>=60);const v5PendingReady=!!(chase.pass&&v5PendingBase&&chip&&chip.score>=60&&!v5EntryConfirmed);const v5CloseLocation=h[i]===l[i]?50:(last-l[i])/(h[i]-l[i])*100;const v5UpperWickPct=(h[i]-Math.max(o[i],last))/Math.max(.0001,last)*100;const v5PrecisionConfirmed=!!(v5EntryConfirmed&&chip&&chip.score>=65&&v5CloseLocation>=60&&v5UpperWickPct<=1&&dayVolumeRatioExact!=null&&dayVolumeRatioExact>=1.2&&dayVolumeRatioExact<=1.8);const v5Signal={name:'v5_verified_rebreak',entry_confirmed:v5EntryConfirmed,precision_confirmed:v5PrecisionConfirmed,pending_ready:v5PendingReady,pending_structure_pass:v5PendingBase,structure_pass:v5RebreakBase,prior_breakout_date:v5PriorBreakout?.date??null,breakout_level:v5PriorBreakout?pct(v5PriorBreakout.level,2):null,rebreak_trigger_price:pct(v5RebreakTrigger,2),pullback_days:v5PullbackDays,pullback_depth_pct:pct(v5PullbackDepth,2),weekly_k_pass:wnow.k>=80,monthly_k_pass:mnow.k>=80,liquidity_pass:liquidityOk,avg20_liquidity_pass:avg20VolumeLots>=500,chip_score:chip?.score??null,chip_pass:!!(chip&&chip.score>=60),precision:{chip_min:65,chip_pass:!!(chip&&chip.score>=65),close_location_pct:pct(v5CloseLocation,2),close_location_min_pct:60,close_location_pass:v5CloseLocation>=60,upper_wick_pct:pct(v5UpperWickPct,2),upper_wick_max_pct:1,upper_wick_pass:v5UpperWickPct<=1,day_volume_ratio:pct(dayVolumeRatioExact,2),day_volume_ratio_min:1.2,day_volume_ratio_max:1.8,day_volume_ratio_pass:dayVolumeRatioExact!=null&&dayVolumeRatioExact>=1.2&&dayVolumeRatioExact<=1.8,validation:{development_2022_2024:{n:103,win_rate_10d_pct:56.3,avg_return_10d_pct:2.763,median_return_10d_pct:1.073},selection_2025:{n:19,win_rate_10d_pct:63.2,avg_return_10d_pct:3.517,median_return_10d_pct:2.564},retrospective_2026:{n:17,win_rate_10d_pct:70.6,avg_return_10d_pct:11.645,median_return_10d_pct:5.233},entry:'next_open',costs_included:true},note:'V5正式確認後的研究型品質精選層；不取代原V5。2026僅作回顧一致性，不視為未碰過封存樣本'},rules:{weekly_k_min:80,monthly_k_min:80,chip_score_min:60,pullback_days_min:3,pullback_days_max:8,pullback_depth_min_pct:-4,pullback_depth_max_pct:3,rebreak_rule:'收盤突破前3日高點＋日K上升',daily_volume_min_lots:1000,avg20_volume_min_lots:500},validation:{development_2022_2024:{n:549,avg_return_10d_pct:1.311},selection_2025:{n:75,win_rate_10d_pct:62.7,avg_return_10d_pct:2.472},holdout_2026:{n:100,win_rate_10d_pct:55.0,avg_return_10d_pct:3.934,median_return_10d_pct:2.124},entry:'next_open',costs_included:true},note:'固定規則全市場驗證；V5正式規則維持不變'};
const holdingSecondPlatform=holdingSecondPlatformAt(rows,{
  ma5:ma5ForHolding,ma10,ma20,ma60,chasePass:chase.pass,avg20Lots:avg20VolumeLots,
  currentLots:currentVolumeLots,dailyK:dnow.k,noBreakdown:belowMa20Days===0
    &&!effectivePrevLowBreak&&entryCandleGuard?.weak_after_breakout!==true
});
holdingManagement.second_platform=holdingSecondPlatform;
holdingManagement.strong_add_trigger=holdingSecondPlatform?.trigger??null;
holdingManagement.strong_add_setup_ready=holdingSecondPlatform?.status==='confirmed';
holdingManagement.add_setup_ready=holdingAddSetupReady||holdingManagement.strong_add_setup_ready;
const strongAddReadyEod=false; // Public S never issues cost-blind add approvals.
holdingManagement.strong_add_ready=false;
holdingManagement.add_mode=null;
holdingManagement.add_rule=holdingManagement.rule;const eodStarter=!!(chase.pass&&maAllRising&&priceAboveAllMas&&avg20VolumeLots>=500&&currentVolumeLots>=1000&&ma20DistancePct!=null&&ma20DistancePct<=9&&Number.isFinite(dnow.k)&&dnow.k>=30&&dnow.k<=85&&last>=c[i-1]*.985);const eodFormalCandidate=!!(chase.pass&&(v5EntryConfirmed||(maClusterFirstBreakout&&!maClusterSignal.breakout_overheated)));let eodEntryState='observe';if(eodFormalCandidate)eodEntryState='formal_candidate';else if(eodStarter)eodEntryState='starter';else if(maClusterWatchReady||v5PendingReady||stage==='B'||stage==='C')eodEntryState='near';const holdingPlanState=holdingManagement.exit_ready===true?'exit':holdingManagement.strong_breakdown===true?'strong_warning':belowMa20Days>0?'ma20_warning':effectivePrevLowBreak?'short_warning':holdingManagement.add_setup_ready?'add_setup_watch':holdingSecondPlatform?.status==='watch'?'second_platform_watch':'hold';
const tradeLifecycle={version:'2026-10-20-holding-risk-v3',scope:'all_stocks',entry:{state:eodEntryState,formal_candidate:eodFormalCandidate,starter:eodStarter,near:eodEntryState==='near',live_confirmation_required:true,formal_survival_start:'12:50',formal_survival_minutes:12,soft_fail_grace_minutes:3,note:'收盤資料只做次日優先分析；盤中正式買點仍需即時量價與12分鐘存活確認'},holding:{state:holdingPlanState,policy_version:HOLDING_RISK_POLICY_VERSION,add_mode:null,strong_add_ready:false,pullback_add_ready:false,add_setup_ready:holdingManagement.add_setup_ready,second_platform:holdingSecondPlatform,add_requires_cost_validation:true,exit_ready:holdingManagement.exit_ready===true,strong_breakdown:holdingManagement.strong_breakdown===true,below_ma20_days:belowMa20Days,stop_pct:-10,breakeven_arm_pct:null,take_profit_full_pct:null,trailing_arm_profit_pct:20,trailing_retrace_from_peak_pct:5,trailing_peak_source:'verified_post_buy_required',alert_only:true,rule:holdingManagement.rule}};const quarterlyFinance=financePromise?await financePromise:null;
const fundamentalBlend={
  version:'2026-10-21-fundamental-chip-confluence-v1',
  revenue3m_yoy_gt20:revenueNow.coverage&&Number(revenueNow.comparison_months)===3
    ?revenue3m20:null,
  gross_margin_2q_up:quarterlyFinance?.gross_margin_2q_up??null,
  operating_cashflow_positive:quarterlyFinance?.operating_cashflow_positive??null,
  foreign_net_buy_10d:chip?.institutional?.foreign_10d_covered===true
    ?Number(chip.institutional.foreign_net_10d)>0:null,
  volume_break_ma20:crossedMA20,
  finance_covered:quarterlyFinance?.coverage_gross_margin===true
    ||quarterlyFinance?.coverage_cashflow===true,as_of:rows[i].date,trade_gate_unchanged:true
};
fundamentalBlend.all_five_confirmed=fundamentalBlend.revenue3m_yoy_gt20===true
  &&fundamentalBlend.gross_margin_2q_up===true
  &&fundamentalBlend.operating_cashflow_positive===true
  &&fundamentalBlend.foreign_net_buy_10d===true
  &&fundamentalBlend.volume_break_ma20===true;
const stageBeforeQualityGate=stage;const qualityReasons:string[]=[];let qualityPass=true;const btN=Number(backtest?.sample_size||0),btW10=Number(backtest?.win_rate_10d_pct),btR10=Number(backtest?.avg_return_10d_pct);
if(stage==='B'||stage==='C'){if(!liquidityOk){qualityPass=false;qualityReasons.push('流動性未達門檻')}if(revenueNow.coverage&&revenueNow.score<55){qualityPass=false;qualityReasons.push('營收趨勢偏弱')}if(chip&&chip.coverage_modules>=2&&chip.score<50){qualityPass=false;qualityReasons.push('籌碼確認偏弱')}if(btN>=6&&Number.isFinite(btW10)&&Number.isFinite(btR10)&&(btW10<50||btR10<=0)){qualityPass=false;qualityReasons.push('成本後10日歷史優勢不足')}if(score<70){qualityPass=false;qualityReasons.push('完整模型分數未達70')}}
const qualityConfidence=!(stageBeforeQualityGate==='B'||stageBeforeQualityGate==='C')?'not_applicable':!qualityPass?'rejected':(String(backtest?.method||'').startsWith('oos_2025plus')&&btN>=6&&revenueNow.coverage&&(!chip||chip.coverage_modules>=2)?'validated':'unverified');
const boxStrategy=boxStrategyMetrics(rows,{chase_limit:chase.limit,ma10,ma20,ma60,ma_all_rising:maAllRising,
  position_pct:pos252*100,entry_guard:entryCandleGuard,strong_breakdown:holdingManagement.strong_breakdown,
  ma20_at:(x)=>sma(c,20,x)});
boxStrategy.historical_audit=boxHistoricalAudit(rows,chase.limit);
const shanchuanV2=shanchuanMotherChildResearch(rows,chip,{chase_limit:chase.limit,ma10,ma20,ma60,position_pct:pos252*100,base_confirmed:bottomStart?.confirmed===true,low_base:bottomStart?.current_base===true,ma_all_rising:maAllRising,entry_guard:entryCandleGuard,strong_breakdown:holdingManagement.strong_breakdown});
const qualityGate={pass:qualityPass,mode:'warning_only_for_bc',original_stage:stageBeforeQualityGate,final_stage:stageBeforeQualityGate,confidence:qualityConfidence,reasons:qualityReasons,requirements:{liquidity_required_for_formal_confirmation:true,revenue_min_score_when_available:55,chip_min_score_when_available:50,full_model_min_score:70,history_gate_min_sample:6,history_min_win_rate_10d_pct:50,history_min_avg_return_10d_pct:0}};
const cautions:string[]=[];if(chase.over)cautions.push('MA20正乖離 +'+chase.bias20_pct+'%，超過'+chase.name+' +'+chase.limit+'%上限');if(!rb&&C>=70)cautions.push('C條件未通過：近30日無B≥70前置轉強');if(ma240&&last>ma240*1.25)cautions.push('MA240距離偏大（資訊）');if(dnow.k>80)cautions.push('日KD偏高');if(volRatio>2)cautions.push('短線爆量');if(ma60&&ma60p&&ma60<ma60p*.97)cautions.push('季線仍明顯下彎');if(currentVolumeLots<1000)cautions.push('當日成交量低於1000張');if(avg20VolumeLots<500)cautions.push('20日均量低於500張');if(!qualityPass&&qualityReasons.length)cautions.push(`${stageBeforeQualityGate}技術階段保留・品質待確認：${qualityReasons.join('、')}`);if(revenueNow.coverage&&revenueNow.score<55)cautions.push('近3月營收年增趨勢偏弱');if(chip&&chip.score<45)cautions.push('目前可取得籌碼確認偏弱');return resp({ok:true,chase_rule_version:CHASE_RULE_VERSION,selection_rule_version:'2026-10-06-ma10-20-60-v1',selection_rule_locked:true,launch_origin_rule_version:'2026-10-06-launch-origin-v1',launch_origin_rule_locked:true,symbol,as_of:rows[i].date,rows:rows.length,stage,score,scores:{A,B,C},metrics:{tdcc_holder_flow:tdccFlow,tdcc_holder_flow_rule_version:TDCC_RISK_VERSION,fundamental_blend:fundamentalBlend,quarter_financial:quarterlyFinance,prebreakout_scout:preattackScout,learning_prices:rows.slice(-135).map((r:any)=>[String(r.date),+(r.open||r.close),+r.close]),selection_rule_version:'2026-10-06-ma10-20-60-v1',launch_origin_rule_version:'2026-10-06-launch-origin-v1',launch_origin_rule_locked:true,chase_rule_version:CHASE_RULE_VERSION,verified_cap_tier:chase.tier==='large'?'large':null,chase_risk:chase,launch_origin_rule:{definition:'整理後第一次重新站上MA10/20/60的低延伸紅K才是起漲起點；後續突破20日前高一律視為再突破，不得重新標示起漲第一根',lookback_days:15,max_ma_spread_pct:8,max_ma20_extension_pct:3,max_signal_day_return_pct:8,require_cross_above_all_mas:true,require_red_candle:true,require_k_ge_d:true,max_daily_k:75,min_daily_volume_lots:1000,min_avg20_volume_lots:500},entry_candle_guard:entryCandleGuard,box_strategy:boxStrategy,shanchuan_v2:shanchuanV2,ma5:entryCandleGuard.ma5,ma10:entryCandleGuard.ma10,open:pct(o[i],2),close:last,prev_open:pct(o[i-1],2),prev_close:pct(c[i-1],2),prev_day_bearish:c[i-1]<o[i-1],drawdown_1y_pct:pct(dd252*100),position_1y_pct:pct(pos252*100),position_3y_pct:pct(pos756*100),ma20:pct(ma20,2),ma60:pct(ma60,2),ma120:pct(ma120,2),ma240:pct(ma240,2),daily_k:pct(dnow.k),daily_d:pct(dnow.d),weekly_k:pct(wnow.k),monthly_k:pct(mnow.k),volume_5_20_ratio:pct(volRatio,2),current_volume_lots:currentVolumeLots,avg_volume_20_lots:avg20VolumeLots,liquidity_ok:liquidityOk,liquidity_label:liquidityLabel,ma60_rolloff_good_days:rollGood,recent_high20:pct(recentHigh20,2),high20_prev:pct(high20prev,2),near_breakout20_pct:pct(nearBreakout20Pct,2),breakout20,first_breakout20:firstBreakout20,previous_day_breakout20:previousDayBreakout20,cross60,pullback_rebreak:pullback,prior_b_confirmed:!!rb,prior_b_score:rb?.b??null,prior_b_date:rb?.date??null,launch_candidate:launchCandidate,bottom_start:bottomStart,ma_cluster:maClusterSignal,launch_sequence:launchSequence,holding_management:holdingManagement,trade_lifecycle:tradeLifecycle,revenue:revenueNow,technical_scores:technicalScores,stage_before_chip:stageBeforeChip,score_before_chip:scoreBeforeChip,quality_gate:qualityGate,model:{version:'2026-09-21-v5',timing_weight_pct:revenueNow.coverage?82:100,revenue_weight_pct:revenueNow.coverage?18:0,live_chip_weight_pct:chip?.live_weight_pct??0,backtest_entry:'next_open',backtest_net_of_standard_fee_tax:true,validation_split:'2022-2024 calibration / 2025+ validation',advanced_data:{large_small_holder:tdccFlow.covered,broker_branch:false,warrant_branch:false},advanced_data_note:'免費資料源不假裝提供付費分點/權證大戶資料；若未來有合法資料源再納入'},backtest,chip,v5:v5Signal},reasons:maClusterFirstBreakout?[...reasons,maClusterPass?'MA10/20/60全數上揚，均線糾結加分，首根突破20日高點且量價同步':'MA10/20/60全數上揚，首根突破20日高點且量價同步']:v5EntryConfirmed?[...reasons,'v5全市場驗證回測再攻條件成立']:reasons,cautions,disclaimer:'研究型獨立量化模型；v5正式候選採全市場固定規則、2022-2024開發、2025選模、2026封存驗證；回測以訊號後下一交易日開盤進場並計入標準手續費與證交稅，不代表未來報酬，也不是投資建議。'});});
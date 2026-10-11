/**
 * 阿勝股票模型 C 搬遷：純技術基礎運算（尚非完整選股引擎）。
 * 由 S/授權流程提供完整日K輸入；本服務不讀寫 S、會員或持股。
 * 禁止將本端點輸出當成正式買點或取代現有選股訊號。
 */
const json=(body,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"Content-Type":"application/json; charset=utf-8",
                  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}
});
const avg=(v,n,i)=>{if(i<n-1)return null;let s=0;for(let j=i-n+1;j<=i;j++)s+=v[j];return s/n};
const maxN=(v,n,i)=>{let m=-Infinity;for(let j=Math.max(0,i-n+1);j<=i;j++)m=Math.max(m,v[j]);return m};
const minN=(v,n,i)=>{let m=Infinity;for(let j=Math.max(0,i-n+1);j<=i;j++)m=Math.min(m,v[j]);return m};
const rd=(v,d=1)=>v==null?null:+v.toFixed(d);
function kd(high,low,close,period=9){
  let K=50,D=50;const result=[];
  for(let i=0;i<close.length;i++){
    const hh=maxN(high,period,i),ll=minN(low,period,i);
    const rsv=hh===ll?50:(close[i]-ll)/(hh-ll)*100;
    K=(2*K+rsv)/3;D=(2*D+K)/3;
    result.push({k:K,d:D,j:3*K-2*D});
  }
  return result;
}
function technicalBasis(rows){
  const c=rows.map(r=>r.close),o=rows.map(r=>r.open),h=rows.map(r=>r.high),
        l=rows.map(r=>r.low),v=rows.map(r=>r.volume_shares),i=c.length-1;
  const dailyKD=kd(h,l,c),ma5=avg(c,5,i),ma10=avg(c,10,i),ma20=avg(c,20,i),ma60=avg(c,60,i);
  let e12=c[0],e26=c[0],dea=0;
  const hs=[];
  for(let z=0;z<=i;z++){
    if(z){e12+=(c[z]-e12)*2/13;e26+=(c[z]-e26)*2/27}
    const dif=e12-e26;
    dea+=(dif-dea)*2/10;
    hs.push((dif-dea)*2);
  }
  // Identical last-20-day breakout scanning semantics to S candleEntryMetrics.
  let b=-1;
  for(let z=Math.max(21,i-20);z<i;z++){
    const hp=maxN(h,20,z-1);
    if(c[z]>o[z]&&c[z]>hp&&c[z-1]<=maxN(h,20,z-2))b=z;
  }
  const two=c[i]<o[i]&&c[i-1]<o[i-1];
  const lower=c[i]<c[i-1]&&c[i-1]<c[i-2];
  const highKd=Math.max(...dailyKD.slice(Math.max(0,i-5),i+1).map(x=>Math.max(x.k,x.d)))>=80;
  const kw=highKd&&dailyKD[i].k<dailyKD[i].d;
  const hw=hs[i]<hs[i-1]&&hs[i-1]<hs[i-2]&&((hs[i-2]>0&&hs[i]<=hs[i-2]*.8)||hs[i]<0);
  const support=b>=0?maxN(h,20,b-1):null;
  const avgPre=avg(v,5,Math.max(4,i-1))||0;
  const contraction=v[i]<v[i-1]&&v[i]<avgPre;
  const allRising=[10,20,60].every(n=>{
    const a=avg(c,n,i),p=avg(c,n,i-5);
    return a!=null&&p!=null&&a>=p;
  });
  const mainBull=allRising&&c[i]>=(ma10||Infinity)&&c[i]>=(ma20||Infinity)&&c[i]>=(ma60||Infinity);
  const holdShort=c[i]>=(ma5||Infinity)||c[i]>=(ma10||Infinity)||(support!=null&&c[i]>=support);
  const guard={
    version:"2026-10-06-kbar-ma10-20-60-v3",as_of:rows[i].date,close:c[i],
    ma5:rd(ma5,4),ma10:rd(ma10,4),ma20:rd(ma20,4),
    two_black:two,lower_closes:lower,post_breakout:b>=0,
    breakout_date:b>=0?rows[b].date:null,breakout_support:support,
    kd_high_weak:kw,macd_weak:hw,macd_hist:rd(hs[i],6),
    macd_prev_hist:rd(hs[i-1],6),volume_contract:contraction,
    main_bull:mainBull,held_support:holdShort,below_ma5:ma5!=null&&c[i]<ma5,
    ma20_pullback:ma20!=null&&c[i]>=ma20*.97&&c[i]<=ma20*1.03&&ma5!=null&&c[i]<ma5,
    weak_after_breakout:two&&lower&&ma5!=null&&c[i]<ma5&&(kw||hw),
    consolidation:b>=0&&contraction&&holdShort&&mainBull,recent_breakout:b>=0
  };
  return {guard,technical:{ma10:rd(ma10,4),ma20:rd(ma20,4),ma60:rd(ma60,4),
    kd_k:rd(dailyKD[i].k,4),kd_d:rd(dailyKD[i].d,4),
    macd_hist:rd(hs[i],6),volume_lots:Math.floor(v[i]/1000),source_date:rows[i].date}};
}
function validate(data){
  if(!data||typeof data!=="object"||!Array.isArray(data.candles))return null;
  const symbol=String(data.stock_id||"");
  if(!/^[0-9]{4,6}$/.test(symbol))return null;
  if(data.candles.length<260||data.candles.length>1200)return null;
  let prev="",out=[];
  for(const raw of data.candles){
    if(!raw||typeof raw!=="object")return null;
    const date=String(raw.date||"");
    if(!/^20\d\d-\d\d-\d\d$/.test(date)||date<=prev)return null;
    let o=Number(raw.open),c=Number(raw.close),
        h=Number(raw.high??raw.max),l=Number(raw.low??raw.min),
        v=Number(raw.volume_shares??raw.Trading_Volume);
    if(![o,c,h,l,v].every(Number.isFinite)||o<=0||c<=0||h<Math.max(o,c)||l>Math.min(o,c)||l<=0||v<0)return null;
    prev=date;out.push({date,open:o,close:c,high:h,low:l,volume_shares:v});
  }
  return {symbol,rows:out};
}
export default {
  async fetch(request,env){
    const url=new URL(request.url);
    if(request.method==="GET"&&url.pathname==="/health")
      return json({ok:true,service:"asheng-c-technical-basis",engine_status:"INCOMPLETE_NOT_FOR_TRADING",
        full_stock_model:false,models_switched_to_c:false,supabase_writes:0});
    if(request.method!=="POST"||url.pathname!=="/technical-basis")
      return json({ok:false,error:"not_found"},404);
    // No default key, no unauthenticated fallback; never send this key to the browser.
    if(typeof env?.MODEL_INPUT_KEY!=="string"||env.MODEL_INPUT_KEY.length<32
       ||request.headers.get("Authorization")!=="Bearer "+env.MODEL_INPUT_KEY)
      return json({ok:false,error:"unauthorized"},401);
    try{
      if(Number(request.headers.get("Content-Length")||0)>350000)return json({ok:false,error:"input_too_large"},413);
      const raw=await request.json();
      const d=validate(raw);
      if(!d)return json({ok:false,error:"invalid_historical_candles"},400);
      const {guard,technical}=technicalBasis(d.rows);
      return json({ok:true,stock_id:d.symbol,as_of:guard.as_of,
        technical_basis:technical,entry_candle_guard:guard,
        model_complete:false,ma10_20_60_basis_only:true,
        missing_modules:["complete_stock_scoring","fundamentals","revenue","chips","historical_backtest","holding_management"],
        actionable:false,supabase_writes:0});
    }catch{
      return json({ok:false,error:"technical_basis_calculation_failed"},422);
    }
  }
};

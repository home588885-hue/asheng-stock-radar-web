// Pure quote-to-evidence validator. No network, persistence or trading.
const isoDay = (time) => new Intl.DateTimeFormat('en-CA', {
  timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
}).format(new Date(time)).replace(/[^0-9]/g,'');
const finitePositive=(x)=>x!==null && x!==undefined && x!=='' && Number.isFinite(Number(x)) && Number(x)>0;
/**
 * Accept only server-retrieved Taiwan exchange MIS trades.
 * A session high may occur before a same-day purchase, so same-day input
 * can contribute ONLY the last actual trade after the recorded buy time.
 * Every result describes OBSERVED high, never all-time complete high.
 */
export function verifiedTwsePeak(quote,position,now=new Date()) {
  const fail=(reason)=>({ok:false,reason});
  if(!position || !Number.isFinite(Date.parse(position.bought_at||'')) ||
     !finitePositive(position.avg_cost) || position.active!==true)
    return fail('invalid_holding');
  const nowTime=now instanceof Date?now:new Date(now);
  if(!Number.isFinite(nowTime.getTime())) return fail('invalid_server_time');
  const today=isoDay(nowTime);
  const date=String(quote?.quote_date||'').replace(/[^0-9]/g,'');
  if(!/^20\d{6}$/.test(date) || date!==today) return fail('stale_or_future_quote');
  if(quote.has_today_trade!==true || !['mis_last_trade','mis_trade_last'].includes(quote.price_source))
    return fail('unconfirmed_trade');
  if(!finitePositive(quote.price)||!finitePositive(quote.volume_lots))
    return fail('non_trade_or_bad_price');
  const time=String(quote.quote_time||'');
  if(!/^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(time)) return fail('invalid_quote_time');
  const stamp=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6,8)+'T'+time+(time.length===5?':00':'')+'+08:00';
  const observed=new Date(stamp);
  const bought=new Date(position.bought_at);
  if(!Number.isFinite(observed.getTime()) || observed.getTime()>nowTime.getTime()+120000)
    return fail('future_quote');
  if(observed.getTime()<bought.getTime()) return fail('quote_pre_purchase');
  const sameDay=isoDay(bought)===date;
  const dayHigh=finitePositive(quote.high)?Number(quote.high):null;
  const useHigh=!sameDay && dayHigh!=null && dayHigh>=Number(quote.price);
  return {ok:true,reason:useHigh?'verified_post_buy_market_day_high':'verified_last_trade_after_purchase',
    high:useHigh?dayHigh:Number(quote.price),
    observedAt:stamp,
    source:useHigh?'twse_mis_daily_high_postbuy':'twse_mis_last_trade',
    completeHistory:false,marketDate:date};
}

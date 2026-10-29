/**
 * Official EOD historical source READ-ONLY probe. No Supabase access, persistence,
 * paid quotas, web scraping of ToAlpha, trade execution or scheduled monitoring.
 * All turnover MUST be a published official trade-value field, never close*volume.
 * Only summary diagnostics are printed. Full responses stay in process memory.
 */
const price = (x) => {
  const s=String(x??'').replace(/,/g,'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(s))return null;
  const n=Number(s);return Number.isFinite(n)&&n>0?n:null;
};
const strictStock=x=>/^[1-9]\d{3}$/.test(String(x??'').trim());
const day=/^\d{4}-\d{2}-\d{2}$/;
const fmt=x=>String(x||'').replace(/<[^>]+>/g,'').replace(/[\s　]/g,'').replace(/（/g,'(').replace(/）/g,')');
const normDate=x=>{
 const s=String(x??'').replace(/[^0-9]/g,'');
 if(s.length===8&&/^20\d{6}$/.test(s))return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8);
 if(s.length===7){const roc=Number(s.slice(0,3));if(roc>=100&&roc<200)
   return (roc+1911)+'-'+s.slice(3,5)+'-'+s.slice(5,7);}
 return null;
};
const row=(market,date,id,close,tradeValue)=>{
 if(!strictStock(id)||!price(close)||!price(tradeValue))return null;
 return {market,date,stock_id:String(id).trim(),
    close:price(close),trade_value_twd:price(tradeValue)};
};
const distinct=(rows)=>{
 const map=new Map(),duplicates=new Set();
 for(const r of rows){if(!r)continue;
  const k=r.market+':'+r.stock_id;
  if(map.has(k)){duplicates.add(k);continue;}map.set(k,r);
 }
 for(const k of duplicates)map.delete(k);
 return [...map.values()];
};
export function parseTWSEHistorical(input,wanted){
 if(!day.test(wanted)||!input||!Array.isArray(input.tables)
    ||!['OK','ok'].includes(String(input.stat||'')))return {ok:false,reason:'twse_status_or_format'};
 const tables=input.tables.filter(t=>Array.isArray(t.fields)&&Array.isArray(t.data));
 const relevant=tables.filter(t=>{
   const f=t.fields.map(fmt);
   return f.some(x=>x.includes('證券代號'))&&f.some(x=>x==='收盤價')
      &&f.some(x=>x.includes('成交金額'));
 });
 if(relevant.length!==1)return {ok:false,reason:'twse_ambiguous_or_missing_table',
   schema_tables:tables.map(t=>({title:String(t.title||'').slice(0,60),fields:t.fields.map(fmt).slice(0,16)})).slice(0,15)};
 const t=relevant[0],f=t.fields.map(fmt);
 const id=f.findIndex(x=>x.includes('證券代號')),
   close=f.findIndex(x=>x==='收盤價'), cash=f.findIndex(x=>x.includes('成交金額'));
 const rows=distinct(t.data.filter(Array.isArray).map(x=>row('twse',wanted,x[id],x[close],x[cash])));
 if(rows.length<100)return {ok:false,reason:'twse_too_few_valid_stocks',rows_count:rows.length,
    fields:f};
 return {ok:true,source:'TWSE_MI_INDEX_historical',date:wanted,rows};
}
export function parseTPExHistorical(input,wanted){
 if(!day.test(wanted)||!input||!Array.isArray(input.tables))return {ok:false,reason:'tpex_status_or_format'};
 const tables=input.tables.filter(t=>Array.isArray(t.fields)&&Array.isArray(t.data));
 const matching=tables.filter(t=>{
  const f=t.fields.map(fmt);
  return f.some(x=>x==='代號'||x.includes('證券代號'))&&f.some(x=>x==='收盤'||x==='收盤價')
   &&f.some(x=>x.includes('成交金額'));
 });
 if(matching.length!==1)return {ok:false,reason:'tpex_ambiguous_or_missing_table',
   schema_tables:tables.map(t=>({title:String(t.title||'').slice(0,60),fields:t.fields.map(fmt).slice(0,22)})).slice(0,12),
   source_keys:Object.keys(input).slice(0,15)};
 const t=matching[0],f=t.fields.map(fmt);
 const id=f.findIndex(x=>x==='代號'||x.includes('證券代號')),
  close=f.findIndex(x=>x==='收盤'||x==='收盤價'), cash=f.findIndex(x=>x.includes('成交金額'));
 const rows=distinct(t.data.filter(Array.isArray).map(x=>row('tpex',wanted,x[id],x[close],x[cash])));
 if(rows.length<100)return {ok:false,reason:'tpex_too_few_valid_stocks',rows_count:rows.length,fields:f};
 return {ok:true,source:'TPEx_OTC_HIST',date:wanted,rows};
}
export function parseTWSELatest(input){
 if(!Array.isArray(input))return {ok:false,reason:'twse_openapi_not_array'};
 const dates=[...new Set(input.map(x=>normDate(x.Date)).filter(Boolean))];
 if(dates.length!==1)return {ok:false,reason:'twse_date_not_unique',dates:dates.slice(0,4)};
 const date=dates[0];
 const rows=distinct(input.map(x=>row('twse',date,x.Code,x.ClosingPrice,x.TradeValue)));
 if(rows.length<100)return {ok:false,reason:'twse_missing_official_tradevalue',rows_count:rows.length,fields:Object.keys(input[0]||{})};
 return {ok:true,source:'TWSE_STOCK_DAY_ALL',date,rows};
}
export function parseTPExLatest(input){
 if(!Array.isArray(input))return {ok:false,reason:'tpex_openapi_not_array'};
 const dates=[...new Set(input.map(x=>normDate(x.Date)).filter(Boolean))];
 if(dates.length!==1)return {ok:false,reason:'tpex_date_not_unique',dates:dates.slice(0,4)};
 const date=dates[0];
 const rows=distinct(input.map(x=>row('tpex',date,x.SecuritiesCompanyCode,x.Close,x.TransactionAmount)));
 if(rows.length<100)return {ok:false,reason:'tpex_missing_official_transaction_amount',rows_count:rows.length,fields:Object.keys(input[0]||{})};
 return {ok:true,source:'TPEx_MAINBOARD_CLOSE',date,rows};
}
export const historicalUrls=(date)=>{
 if(!day.test(date))throw Error('bad_date');
 const roc=String(Number(date.slice(0,4))-1911).padStart(3,'0');
 return {
 twse:'https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date='+date.replace(/-/g,'')+'&type=ALLBUT0999',
 tpex:'https://www.tpex.org.tw/web/stock/aftertrading/otc_quotes_no1430/stk_wn1430_result.php?l=zh-tw&d='+roc+'/'+date.slice(5,7)+'/'+date.slice(8,10)+'&se=EW'
 };
};
export function intersectionCoverage(a,b){
 if(!a.ok||!b.ok||!Array.isArray(a.rows)||!Array.isArray(b.rows))return {ok:false,reason:'source_unverified'};
 const xs=new Set(a.rows.map(r=>r.market+':'+r.stock_id));
 const ys=new Set(b.rows.map(r=>r.market+':'+r.stock_id));
 let pairs=0;for(const x of xs)if(ys.has(x))pairs++;
 const total=new Set([...xs,...ys]).size;
 return {ok:pairs>=100,previous_count:xs.size,current_count:ys.size,
   pair_count:pairs,coverage_pct:total?Math.round(pairs/total*1000)/10:0};
}
async function download(url){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
 try{const r=await fetch(url,{signal:controller.signal,headers:{Accept:'application/json',
   'User-Agent':'asheng-research-readonly/1.0 (noncommercial; low rate)'}});
   if(!r.ok)throw Error('http_'+r.status);
   const ctype=r.headers.get('content-type')||'';
   if(!ctype.includes('json')&&!ctype.includes('text/plain'))throw Error('unexpected_content_type');
   const bytes=await r.text();if(bytes.length>5000000)throw Error('response_too_large');
   return JSON.parse(bytes);
 }finally{clearTimeout(timer);}
}
async function run(){
 const requested=process.argv.slice(2);
 const dates=requested.length?requested:['2026-10-27','2026-10-28'];
 if(dates.length!==2||!dates.every(x=>day.test(x)))throw Error('specify_exactly_two_dates');
 const results=new Map();
 for(const date of dates){
  const urls=historicalUrls(date);
  for(const market of ['twse','tpex']){
   try{
    const payload=await download(urls[market]);
    const parse=market==='twse'?parseTWSEHistorical:parseTPExHistorical;
    const out=parse(payload,date);
    results.set(market+date,out);
    const report={date,market,ok:out.ok,reason:out.reason||null,
      valid_stocks:out.rows?.length??0,
      total_official_trade_value_twd:out.ok?Math.round(out.rows.reduce((v,r)=>v+r.trade_value_twd,0)):null,
      schema_preview:out.schema_tables??null,source_keys:out.source_keys??null,
      fields:out.fields??null};
    console.log('OFFICIAL_HISTORY_PROBE',JSON.stringify(report));
   }catch(e){results.set(market+date,{ok:false});console.log('OFFICIAL_HISTORY_PROBE',JSON.stringify(
     {date,market,ok:false,error:String(e).slice(0,160)}));}
   await new Promise(r=>setTimeout(r,1200));
  }
 }
 for(const market of ['twse','tpex']){
  const a=results.get(market+dates[0]),b=results.get(market+dates[1]);
  console.log('OFFICIAL_MATCHED_COVERAGE',JSON.stringify({market,
    ...intersectionCoverage(a,b)}));
 }
 // A successful probe is not permission to run any production scanner or change entries.
}
if(import.meta.url===new URL('file://'+process.argv[1]).href){
 run().catch(err=>{console.error('PROBE_FAILED',String(err));process.exitCode=1;});
}

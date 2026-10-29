import test from 'node:test';
import assert from 'node:assert/strict';
import {
 parseTWSEHistorical,parseTPExHistorical,parseTWSELatest,parseTPExLatest,
 historicalUrls,intersectionCoverage
} from './official-eod-history-probe.mjs';
const d1='2026-10-27',d2='2026-10-28';
const stock=i=>String(1000+i);
function officialTwse(date){
 const fields=['證券代號','成交股數','成交金額','開盤價','最高價','最低價','收盤價'];
 return {stat:'OK',tables:[
  {title:'大盤統計',fields:['類型','數值'],data:[['股票','100']]},
  {title:'個股每日收盤',fields,data:Array.from({length:102},(_,i)=>
    [stock(i),'1,000','10,000,000','99','101','98','100'])}]};
}
function officialTpex(date){
 const fields=['代號','名稱','收盤','開盤','最高','最低','成交金額(元)'];
 return {stat:'ok',tables:[{title:'上櫃收盤行情',fields,data:Array.from({length:102},(_,i)=>
  [stock(i),'測試', '100','99','101','98','11,000,000'])}]};
}
test('TWSE historical explicitly locates official amount field by name not table number',()=>{
 const r=parseTWSEHistorical(officialTwse(d1),d1);
 assert.equal(r.ok,true);assert.equal(r.rows.length,102);
 assert.equal(r.rows[0].trade_value_twd,10000000);
 assert.equal(r.rows[0].market,'twse');
});
test('TPEx historical official trade value and 4-digit common stocks',()=>{
 const r=parseTPExHistorical(officialTpex(d1),d1);
 assert.equal(r.ok,true);assert.equal(r.rows.length,102);
 assert.equal(r.rows[0].trade_value_twd,11000000);
});
test('missing real TradeValue is never backfilled using close times volume',()=>{
 const bad=officialTwse(d1);
 bad.tables[1].fields[2]='估算金額';
 assert.equal(parseTWSEHistorical(bad,d1).ok,false);
 const missing=officialTpex(d1);
 missing.tables[0].fields[6]='成交張數';
 assert.equal(parseTPExHistorical(missing,d1).ok,false);
});
test('reject duplicated, ETF or warrants, missing close or missing amounts',()=>{
 const d=officialTwse(d1);
 d.tables[1].data.push(d.tables[1].data[0]);
 d.tables[1].data.push(['0050','100','2000','45','45','44','45']);
 d.tables[1].data.push(['2330','200','-', '100','101','99','100']);
 const r=parseTWSEHistorical(d,d1);
 assert.equal(r.ok,true);
 assert.equal(r.rows.length,101);
});
test('live TWSE/TPEx feeds have ROC dates and true transaction amounts',()=>{
 const twse=Array.from({length:102},(_,i)=>({
   Date:'1151028',Code:stock(i),ClosingPrice:'100',TradeValue:'10,000,000',
   TradeVolume:'100000',Name:'TEST'
 }));
 const tpex=Array.from({length:102},(_,i)=>({
   Date:'1151028',SecuritiesCompanyCode:stock(i),
   Close:'100',TransactionAmount:'8,000,000',TradingShares:'100000'
 }));
 assert.equal(parseTWSELatest(twse).rows[0].trade_value_twd,10000000);
 assert.equal(parseTWSELatest(twse).date,d2);
 assert.equal(parseTPExLatest(tpex).rows[0].trade_value_twd,8000000);
 assert.equal(parseTPExLatest(tpex).date,d2);
 assert.equal(parseTPExLatest(tpex.map(x=>({...x,TransactionAmount:undefined}))).ok,false);
});
test('dates are explicit and exchange-specific; overlap requires both verified',()=>{
 const urls=historicalUrls(d2);
 assert.ok(urls.twse.includes('date=20261028'));
 assert.ok(urls.tpex.includes('115/10/28'));
 const a=parseTWSEHistorical(officialTwse(d1),d1);
 const b=parseTWSEHistorical(officialTwse(d2),d2);
 assert.equal(intersectionCoverage(a,b).pair_count,102);
 assert.equal(intersectionCoverage(a,{ok:false}).ok,false);
});

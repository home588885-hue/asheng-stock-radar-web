/**
 * Real two-day official TWSE + TPEx turnover SHARE diagnostic.
 * No database writes, scan quotas, ToAlpha usage, or live trade permissions.
 * This is only a one-time 2026-10-27/28 research snapshot.
 * A current mapping of industries is not valid for long historical walk-forward.
 */
import {readFileSync} from 'node:fs';
import {download,historicalUrls,parseTWSEHistorical,parseTPExHistorical,intersectionCoverage}
 from './official-eod-history-probe.mjs';
import {comparableTurnoverShift} from './sector-rotation-independent-research.mjs';
const before='2026-10-27',after='2026-10-28';
const mapFile=new URL('./sector-industry-map-20261029.json',import.meta.url);
const mappings=JSON.parse(readFileSync(mapFile,'utf8'));
const membership=new Map(mappings.members.map(x=>[x.market+':'+x.stock_id,x.industry]));
function withSectors(parsed){
 return parsed.rows.map(x=>{
  const industry=membership.get(x.market+':'+x.stock_id);
  return industry?{...x,industry}:null;
 }).filter(Boolean);
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function execute(){
 const byDay=new Map();
 for(const day of [before,after]){
  const url=historicalUrls(day),byMarket=[];
  for(const market of ['twse','tpex']){
   const raw=await download(url[market]);
   const parsed=(market==='twse'?parseTWSEHistorical:parseTPExHistorical)(raw,day);
   if(!parsed.ok)throw Error(day+' '+market+': '+JSON.stringify({
      reason:parsed.reason,keys:parsed.source_keys,schema:parsed.schema_tables?.slice(0,2)}));
   const rows=withSectors(parsed);byMarket.push(...rows);
   console.log('MARKET_VALIDATION',JSON.stringify({date:day,market,
     source:parsed.source,raw_common_stock_count:parsed.rows.length,
     mapped_stock_count:rows.length,
     mapped_pct:Math.round(rows.length/parsed.rows.length*1000)/10}));
   await wait(1200);
  }
  byDay.set(day,byMarket.map(x=>({...x,date:day})));
 }
 // TWSE broad "電子工業" and TPEx fine-grained electronics industries
 // are not historically harmonized. Never interpret a combined denominator
 // as actual fund migration across differently classified industries.
 for(const market of ['twse','tpex']){
   const a=byDay.get(before).filter(r=>r.market===market);
   const b=byDay.get(after).filter(r=>r.market===market);
   const r=comparableTurnoverShift(a,b,before,after,
     {minOverall:350,minGroup:8,minCoverage:.85});
   if(!r.ok)throw Error(market+': noncomparable_cohort '+JSON.stringify(r));
   const sectorPairs=r.groups.filter(x=>x.status!=='insufficient');
   const gainers=sectorPairs.filter(x=>x.turnover_share_shift_pp>0)
     .sort((a,b)=>b.turnover_share_shift_pp-a.turnover_share_shift_pp).slice(0,7);
   const losers=sectorPairs.filter(x=>x.turnover_share_shift_pp<0)
     .sort((a,b)=>a.turnover_share_shift_pp-b.turnover_share_shift_pp).slice(0,7);
   const out={
     method:'official_exchange_internal_matched_two_day_turnover_share',
     market,market_only_denominator:true,
     cannot_compare_raw_twse_electronics_to_tpex_subindustries:true,
     mapping_as_of:mappings.mapped_as_of,classification_is_historical:false,
     scope:'matched_covered_stock_cohort_within_one_exchange_only',
     not_institutional_or_net_flow:true,
     pair_count:r.comparable_count,coverage_pct:r.coverage_pct,
     sector_count:sectorPairs.length,previous_date:before,today_date:after,
     gainers:gainers.map(x=>({industry:x.industry,matched_stocks:x.n,
       share_previous_pct:x.share_previous_pct,share_today_pct:x.share_today_pct,
       shift_pp:x.turnover_share_shift_pp})),
     decliners:losers.map(x=>({industry:x.industry,matched_stocks:x.n,
       shift_pp:x.turnover_share_shift_pp}))
   };
   console.log('MARKET_SPECIFIC_SECTOR_PP',JSON.stringify(out));
 }

}
execute().catch(err=>{console.error('REAL_RESEARCH_BLOCKED',String(err));process.exitCode=1});

/**
 * Manual-only TDCC public-data fetcher.
 * Source: TDCC official CSV 1-5 (latest), or licensed historical archival copy.
 * Never writes holdings, Supabase, trading decisions or GitHub Actions schedule.
 */
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseCSV} from './tdcc-holder-flow.mjs';

const OFFICIAL='https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5';
const ARCHIVE_API='https://api.github.com/repos/wirelessr/tdcc-opendata-archive/contents/snapshots/';
export function validateTDCC(csv){
  const rows=parseCSV(csv);
  const needed=['資料日期','證券代號','持股分級','股數'];
  if(rows.length<1000||needed.some(key=>!Object.hasOwn(rows[0]||{},key)))
    throw Error('Not a valid full TDCC 1-5 CSV; possibly an HTML/error response');
  const dates=new Set(),symbols=new Set();
  for(const r of rows){
    const d=String(r['資料日期']||'').trim();
    if(!/^\d{8}$/.test(d))throw Error('Invalid TDCC data date '+d);
    dates.add(d);
    const code=String(r['證券代號']||'').trim();
    if(/^[0-9A-Za-z]{4,6}$/.test(code))symbols.add(code);
  }
  if(dates.size!==1||symbols.size<100)
    throw Error('TDCC CSV has conflicting dates or too few symbols');
  const date=[...dates][0];
  return {date:date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6),
    rows:rows.length,symbols:symbols.size};
}
async function readUrl(url){
  const res=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(60000),
    headers:{'User-Agent':'AshengRadar-TDCC-independent-research/1.0','Accept':'text/csv,application/json,text/plain,*/*'}});
  if(!res.ok)throw Error('Source HTTP '+res.status+' '+new URL(url).hostname);
  const data=await res.text();
  if(data.length<50000||data.length>20000000)throw Error('Suspicious TDCC response length '+data.length);
  return data;
}
async function saveVerified(dir,raw,expected=null){
  const sample=validateTDCC(raw);
  if(expected&&sample.date!==expected)
    throw Error('TDCC archive file date mismatch: expected '+expected+', observed '+sample.date);
  await mkdir(dir,{recursive:true});
  const path=join(dir,sample.date+'.csv');
  await writeFile(path,raw,{encoding:'utf8',flag:'w'});
  return {file:path,...sample};
}
export async function downloadLatest(dest){
  return saveVerified(dest,await readUrl(OFFICIAL));
}
export async function downloadArchive(dest,{year='2026',since='2026-04-30',limit=52}={}){
  if(!/^\d{4}$/.test(String(year))||!/^\d{4}-\d{2}-\d{2}$/.test(since))
    throw Error('Invalid year/since');
  const url=ARCHIVE_API+year;
  const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'Accept':'application/vnd.github+json'}});
  if(!response.ok)throw Error('Archive listing HTTP '+response.status);
  const listing=await response.json();
  if(!Array.isArray(listing))throw Error('Archive listing unexpected shape');
  const files=listing.filter(f=>/^\d{4}-\d{2}-\d{2}\.csv$/.test(String(f.name||''))
    &&f.name.slice(0,10)>=since&&f.size>100000&&f.size<15000000
    &&String(f.download_url||'').startsWith('https://raw.githubusercontent.com/wirelessr/tdcc-opendata-archive/'))
    .sort((a,b)=>a.name.localeCompare(b.name)).slice(0,Math.min(Math.max(1,limit),52));
  const results=[];await mkdir(dest,{recursive:true});
  for(const f of files){
    const expected=f.name.slice(0,10),destFile=join(dest,f.name);
    let existsValid=false;
    try{const v=validateTDCC(await readFile(destFile,'utf8'));existsValid=v.date===expected;}
    catch{}
    if(existsValid){results.push({date:expected,status:'verified-local'});continue;}
    const out=await saveVerified(dest,await readUrl(f.download_url),expected);
    results.push({date:out.date,status:'downloaded',rows:out.rows,symbols:out.symbols});
  }
  return results;
}
export async function main(args){
  const get=k=>{const i=args.indexOf(k);return i<0?null:args[i+1]};
  const output=resolve(get('--dest')||'research-data/tdcc');
  if(args.includes('--help')||!(args.includes('--latest')||args.includes('--archive'))){
    console.log('Usage: node research/tdcc-fetch-weekly.mjs --latest|--archive [--since YYYY-MM-DD] [--dest DIR] [--limit N]');
    return args.includes('--help')?0:2;
  }
  const data=args.includes('--latest')
    ?[await downloadLatest(output)]
    :await downloadArchive(output,{since:get('--since')||'2026-04-30',
       limit:Number(get('--limit')||52)});
  console.log(JSON.stringify({research_only:true,source:'TDCC open dataset 11452',files:data},null,2));
  return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main(process.argv.slice(2)).then(x=>process.exitCode=x).catch(e=>{console.error(e.message);process.exitCode=1});
}

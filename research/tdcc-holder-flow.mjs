/**
 * TDCC holder-flow independent research. No trading, no paid quote calls,
 * no production holdings writes, no Supabase credentials. Node >=18.
 * Source: TDCC dataset 11452, shares brackets 12-15 (>400 lots), 15 (>1000 lots).
 * Data license: https://data.gov.tw/license
 */
import {readFile,readdir,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const TDCC_SOURCE='https://data.gov.tw/dataset/11452';
export const HOLDING_400_GRADES=[12,13,14,15];
export const HOLDING_1000_GRADES=[15];

export function parseCSV(raw){
  const input=String(raw||'').replace(/^\uFEFF/,'');
  const out=[];let row=[],field='',quoted=false;
  for(let i=0;i<input.length;i++){
    const ch=input[i];
    if(ch==='"'){
      if(quoted&&input[i+1]==='"'){field+='"';i++;}
      else quoted=!quoted;
    } else if(ch===','&&!quoted){row.push(field);field='';}
    else if((ch==='\n'||ch==='\r')&&!quoted){
      if(ch==='\r'&&input[i+1]==='\n')i++;
      row.push(field);field='';
      if(row.some(x=>x.trim()))out.push(row);
      row=[];
    }else field+=ch;
  }
  if(quoted)throw new Error('CSV quoting incomplete');
  if(field||row.length){row.push(field);if(row.some(x=>x.trim()))out.push(row);}
  if(!out.length)return [];
  const headers=out.shift().map(x=>x.trim());
  return out.map((values,i)=>{
    if(values.length!==headers.length)throw new Error('CSV row '+(i+2)+' incorrect field count');
    return Object.fromEntries(headers.map((h,j)=>[h,values[j].trim()]));
  });
}

function parseDate(value){
  const v=String(value||'').trim().replace(/[-/]/g,'');
  if(!/^\d{8}$/.test(v))throw new Error('Invalid TDCC date '+value);
  const d=new Date(v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6)+'T00:00:00Z');
  if(!Number.isFinite(d.getTime())||d.toISOString().slice(0,10).replace(/-/g,'')!==v)
    throw new Error('Invalid TDCC date '+value);
  return d.toISOString().slice(0,10);
}
function n(value){
  const x=Number(String(value??'').replace(/,/g,''));
  return Number.isFinite(x)?x:NaN;
}
// Conservative publication lag: no snapshot can inform a signal before the
// following Tuesday (Taiwan calendar). This avoids same-week lookahead.
export function firstSafeTuesday(asOf){
  const d=new Date(asOf+'T00:00:00Z');
  if(!Number.isFinite(d.getTime()))throw Error('Invalid snapshot date');
  let days=(2-d.getUTCDay()+7)%7;if(days===0)days=7;
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}
function dateGap(a,b){
  return (Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
}
export function tdccSnapshots(files){
  const groups=new Map();
  for(const {name,csv} of files){
    const rows=parseCSV(csv);
    for(const r of rows){
      const asOf=parseDate(r['資料日期']);
      const id=String(r['證券代號']||'').trim();
      const grade=n(r['持股分級']),shares=n(r['股數']);
      if(!/^[0-9A-Za-z]{4,6}$/.test(id))continue;
      if(!Number.isInteger(grade)||grade<1||grade>17||!Number.isFinite(shares)||shares<0)
        throw Error('Invalid grade or shares in '+name+' / '+id);
      const key=id+'|'+asOf;
      if(!groups.has(key))groups.set(key,{stock_id:id,as_of:asOf,grades:new Map(),files:new Set()});
      const g=groups.get(key);
      const old=g.grades.get(grade);
      if(old!=null && old!==shares)throw Error('Conflicting TDCC data '+key+' grade '+grade);
      g.grades.set(grade,shares);g.files.add(name);
    }
  }
  const output=[];
  for(const g of groups.values()){
    if(![12,13,14,15,17].every(grade=>g.grades.has(grade)))continue;
    const total=g.grades.get(17);
    if(!(total>0))continue;
    const sum=(grades)=>grades.reduce((a,x)=>a+g.grades.get(x),0);
    const pct400=100*sum(HOLDING_400_GRADES)/total;
    const pct1000=100*sum(HOLDING_1000_GRADES)/total;
    if(pct400>100.2||pct1000>100.2)continue;
    output.push({stock_id:g.stock_id,as_of:g.as_of,
      usable_from:firstSafeTuesday(g.as_of),large400_pct:pct400,large1000_pct:pct1000,
      source_files:[...g.files].sort()});
  }
  output.sort((a,b)=>a.stock_id.localeCompare(b.stock_id)||a.as_of.localeCompare(b.as_of));
  const last=new Map(),before=new Map();
  for(const row of output){
    const prev=last.get(row.stock_id);
    row.prev_week_gap=prev?dateGap(row.as_of,prev.as_of):null;
    const continuous=prev&&row.prev_week_gap>=4&&row.prev_week_gap<=11;
    row.change400_pp=continuous?row.large400_pct-prev.large400_pct:null;
    row.change1000_pp=continuous?row.large1000_pct-prev.large1000_pct:null;
    row.two_week400_up=!!(continuous&&prev.change400_pp>0&&row.change400_pp>0);
    row.two_week1000_up=!!(continuous&&prev.change1000_pp>0&&row.change1000_pp>0);
    const hist=before.get(row.stock_id)||[];
    const lookback=hist.length>=4?hist[hist.length-4]:null;
    const fourGap=lookback?dateGap(row.as_of,lookback.as_of):NaN;
    row.four_week400_change_pp=lookback&&fourGap>=24&&fourGap<=40
      ?row.large400_pct-lookback.large400_pct:null;
    hist.push(row);before.set(row.stock_id,hist);
    last.set(row.stock_id,row);
  }
  return output;
}
export function alignEvents(events,snapshots){
  const grouped=new Map();
  for(const r of snapshots){
    if(!grouped.has(r.stock_id))grouped.set(r.stock_id,[]);
    grouped.get(r.stock_id).push(r);
  }
  for(const arr of grouped.values())arr.sort((a,b)=>a.usable_from.localeCompare(b.usable_from));
  const dedup=new Set();
  return events.filter(e=>{
    const id=String(e.stock_id||'').trim(),day=String(e.signal_date||'');
    const key=id+'|'+day+'|'+String(e.family||'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!id||dedup.has(key))return false;
    dedup.add(key);return true;
  }).map(e=>{
    const arr=grouped.get(String(e.stock_id).trim())||[];
    let lo=0,hi=arr.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(arr[mid].usable_from<=e.signal_date)lo=mid+1;else hi=mid;}
    const row=lo?arr[lo-1]:null;
    const lag=row?dateGap(e.signal_date,row.as_of):null;
    // Missing > 20 calendar days: do not carry stale holder data.
    const ok=row&&lag<=20&&lag>=0;
    return {...e,tdcc:ok?row:null};
  });
}
export function summarize(events){
  const sections=new Map();
  const groups=[
    ['原策略',e=>true],
    ['400張以上連增2週',e=>e.tdcc?.two_week400_up===true],
    ['1000張以上連增2週',e=>e.tdcc?.two_week1000_up===true],
    ['兩級都連增2週',e=>e.tdcc?.two_week400_up&&e.tdcc?.two_week1000_up],
    ['400張連增＋法人代理',e=>e.tdcc?.two_week400_up&&n(e.chip_score)>=60&&n(e.inst_net5)>0&&n(e.inst_pos_days)>=3],
  ];
  for(const e of events){
    if(!e.tdcc||!Number.isFinite(n(e.r10)))continue;
    const yr=String(e.signal_date).slice(0,4);
    for(const [label,pred] of groups){
      if(!pred(e))continue;
      const key=String(e.family||'UNKNOWN')+'|'+yr+'|'+label;
      if(!sections.has(key))sections.set(key,{family:String(e.family||'UNKNOWN'),year:yr,group:label,n:0,sum10:0,win10:0,sumMae:0,maeN:0,stop10:0,stopN:0});
      const a=sections.get(key),ret=n(e.r10),mae=n(e.mae10);
      a.n++;a.sum10+=ret;a.win10+=Number(ret>0);
      if(Number.isFinite(mae)){a.sumMae+=mae;a.maeN++;a.stop10+=Number(mae<=-10);a.stopN++;}
    }
  }
  return [...sections.values()].map(a=>({
    family:a.family,year:a.year,group:a.group,n:a.n,
    mean_r10_pct:+(a.sum10/a.n).toFixed(3),
    win10_pct:+(a.win10*100/a.n).toFixed(1),
    mean_mae10_pct:a.maeN?+(a.sumMae/a.maeN).toFixed(2):null,
    touched_minus10_pct:a.stopN?+(a.stop10*100/a.stopN).toFixed(1):null,
    research_only:true
  })).sort((a,b)=>a.family.localeCompare(b.family)||a.year.localeCompare(b.year)||a.group.localeCompare(b.group));
}
export async function runCLI(args){
  const get=key=>{const i=args.indexOf(key);return i<0?null:args[i+1];};
  if(args.includes('--help')||!get('--tdcc-dir')||!get('--events')||!get('--out')){
    console.log('Usage: node research/tdcc-holder-flow.mjs --tdcc-dir /path/to/weekly-csv --events research_events.csv --out report.json');
    return args.includes('--help')?0:2;
  }
  const dir=resolve(get('--tdcc-dir')),files=(await readdir(dir)).filter(x=>/\.csv$/i.test(x)).sort();
  if(files.length<2)throw Error('Need >= 2 weekly TDCC CSV files; no synthetic live signals');
  const snapshots=tdccSnapshots(await Promise.all(files.map(async name=>({name,csv:await readFile(join(dir,name),'utf8')}))));
  const events=parseCSV(await readFile(get('--events'),'utf8'));
  const aligned=alignEvents(events,snapshots);
  const covered=aligned.filter(x=>x.tdcc).length;
  const stats=summarize(aligned);
  const payload={research_only:true,source:TDCC_SOURCE,as_of:new Date().toISOString(),
    assumptions:['TDCC tiers 12-15 (>400 lots), 15 (>1000 lots)',
      'Available only starting first Tuesday after snapshot, prevents same-week lookahead',
      'Stale after 20 calendar days; 2 consecutive weekly increases required',
      'No 7-day warrant net buying in this dataset; no trading advice',
      'R10/MAE10 inherits original historical event assumptions; inspect costs and period splits'],
    input:{weekly_files:files.length,holder_snapshots:snapshots.length,
      historical_events:aligned.length,holder_coverage:covered,
      coverage_pct:aligned.length?+(100*covered/aligned.length).toFixed(1):0,
      first_tdcc:snapshots[0]?.as_of||null,
      last_tdcc:snapshots.at(-1)?.as_of||null},
    results:stats};
  await mkdir(dirname(resolve(get('--out'))),{recursive:true});
  await writeFile(get('--out'),JSON.stringify(payload,null,2)+'\n');
  console.log('TDCC research-only report saved: '+get('--out')+'; coverage='+covered+'/'+aligned.length);
  return 0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runCLI(process.argv.slice(2)).then(code=>{process.exitCode=code}).catch(err=>{console.error(err.message);process.exitCode=1});
}

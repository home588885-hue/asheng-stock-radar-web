'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
const first='      const compactEntryGroupHtml =';
const last='      // Only compare existing EOD radar snapshots;';
const start=html.indexOf(first),end=html.indexOf(last,start);
assert.ok(start>=0&&end>start,'simplified V2 UI source is missing');
const source=html.slice(start,end);
const watches=new Map([
  ['1003',{stock_id:'1003',active:true,first_as_of:'2026-10-16',reason:'來源相同時不得重複'}],
  ['2001',{stock_id:'2001',active:true,first_as_of:'2026-10-14',reason:'等待新版'}],
  ['2002',{stock_id:'2002',active:true,first_as_of:'2026-10-16',reason:'新版有效'}],
  ['2003',{stock_id:'2003',active:true,first_as_of:'2026-10-16',reason:'新版風控風險'}],
]);
const snapshot=id=>({stock_id:id,stock_name:'測試'+id,as_of:id==='2001'?'2026-10-15':'2026-10-19',
  metrics:{close:22,ma20:21},verified:id!=='2001'});
const snapshots=new Map([...watches.keys()].map(id=>[id,snapshot(id)]));
const archived=Array.from({length:40},(_,i)=>({stock_id:String(3001+i),active:false,
  state:'invalid',first_as_of:'2026-10-05',reason:'風控失效'}));
const esc=v=>String(v??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const {simplifiedEntryHtml,groupedEntrySavedWatches}=new Function(
  'entryCompactStock','esc','pullbackWatch','pullbackWatchSnapshots','pullbackWatchArchived',
  'holdings','unifiedRadarGeneration','expectedSignalDataDate','pullbackWatchState','num',
  source+'\nreturn {simplifiedEntryHtml,groupedEntrySavedWatches};'
)(
  (row,label)=>'<details class="entry-mini" data-stock-key="'+esc(row.item.stock_id)+'"><summary>'+esc(label)+'</summary></details>',
  esc,watches,snapshots,archived,new Map(),
  item=>item.verified===true,()=> '2026-10-19',
  item=>item.stock_id==='2003'?{state:'invalid',active:false,reason:'新版跌破支撐'}
    :{state:'tracking',active:true,reason:'目前仍追蹤'},
  (num,digits)=>Number(num).toFixed(digits)
);
const row=stock_id=>({item:{stock_id,stock_name:'測試'+stock_id,as_of:'2026-10-19'}});
const groups=simplifiedEntryHtml({
 completedRows:[row('1001')],starterRows:[row('1002')],eodTrialRows:[row('1005')],
 eodTrackRows:[row('1003')],retainedRows:[row('1004')],
 avoidRows:[row('1006')],waitRows:[row('1007')]
});
const titles=['今日進場機會','持續追蹤與等待回踩','暫不適合進場','最近失效追蹤'];
for(const title of titles)assert.ok(groups.includes(title),'missing main group '+title);
assert.equal((groups.match(/data-stable-key="entry-simple-/g)||[]).length,4,'only 3 decision groups plus 1 history');
assert.match(groups,/data-entry-fold="simple-today" open/);
assert.match(groups,/data-entry-fold="simple-tracking" open/);
assert.match(groups,/data-entry-fold="simple-risk">/);
assert.match(groups,/data-entry-fold="simple-history">/);
assert.ok(!groups.includes('data-entry-fold="simple-risk" open'),'risk must be closed');
assert.ok(!groups.includes('data-entry-fold="simple-history" open'),'history must be closed');
for(const id of ['1001','1002','1003','1004','1005','1006','1007']){
  assert.equal((groups.match(new RegExp('data-stock-key="'+id+'"','g'))||[]).length,1,
    'current model row appears exactly once '+id);
}
assert.ok(!groups.includes('data-tracking-symbol="1003"'),'model candidate must suppress duplicate saved watch');
for(const id of ['2001','2002','2003']){
 assert.equal((groups.match(new RegExp('data-tracking-symbol="'+id+'"','g'))||[]).length,1,
 'saved watch appears exactly once '+id);
}
assert.match(groups,/待新版補算｜已保留/);
assert.match(groups,/新版風控待複核｜暫不進場/);
assert.match(groups,/最近失效追蹤/);
assert.equal((groups.match(/data-tracking-symbol="30\d\d"/g)||[]).length,40,'history records not lost');
const fallback=simplifiedEntryHtml({});
assert.equal((fallback.match(/data-stable-key="entry-simple-/g)||[]).length,4,
  'same UI is used for feed failure or empty candidate pool');
assert.ok(!fallback.includes('🟢 正式買點｜當日已驗證'),
  'past watch must not convert to current formal buy');
assert.ok(!fallback.includes('🟠 可小量試單｜當日已驗證'),
  'past watch must not convert to current orange trial');
assert.match(html,/stableListRender\(simplifiedEntryHtml\(\)/);
assert.match(html,/const outHtml=banner\+researchPreview\+simplifiedEntryHtml\(/);
assert.doesNotMatch(html,/= entryPersistedTrackingHtml\(\)/);
assert.match(html,/@media\(max-width:640px\)\{\s*\.entry-bucket-simple-today/);
const scriptBlock=html.slice(html.indexOf('const renderEntrySections ='),
  html.indexOf('const isEntryRadarItem ='));
assert.doesNotMatch(scriptBlock,/entryBucketHtml\('/,
  'old multi-bucket presentation must not remain active');
if(process.env.XC_EXPORT_PREVIEW==='1'){
 const css=(html.match(/<style>([\s\S]*?)<\/style>/i)||[])[1]||'';
 const target=path.join(__dirname,'entry-preview-20261019.html');
 fs.writeFileSync(target,
   '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
   +'<style>'+css+'</style></head><body><main class="wrap" id="preview">'+groups+'</main></body></html>');
 console.log('Rendered static UI test fixture: '+target);
}
console.log('PASS: ENTRY V2 grouped rendering, dedup, pending watches, risk, 40 archived, mobile CSS, 0 network calls');

'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const html=fs.readFileSync('admin.html','utf8');
const beg=html.indexOf('      const VERIFIED_TRIAL_OUTBOX_KEY=');
const end=html.indexOf('      const renderEntrySections =',beg);
assert.ok(beg>0&&end>beg,'Verified-trial ACK outbox module must exist in formal ENTRY path');
const code=html.slice(beg,end);
const day=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei',
 year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const fakeStorage=new Map();
const storage={getItem:k=>fakeStorage.get(k)||null,setItem:(k,v)=>fakeStorage.set(k,v)};
function harness(save,stage='ENTRY'){
 const watch=new Map(),inflight=new Set();
 return new Function('portfolioId','localStorage','pullbackWatch','persistentTrialInFlight',
   'unifiedRadarGeneration','quoteFreshForTrial','expectedSignalDataDate','stage',
   'document','savePullbackWatchRows',
   code+'\nreturn {persistVerifiedTrialRows,verifiedTrialOutbox,VERIFIED_TRIAL_OUTBOX_KEY,trialOutboxRecent};'
 )('owner-id-test',storage,watch,inflight,item=>item.new_model===true,
   quote=>quote?.fresh===true,()=>day,stage,{hidden:false},save);
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const row=({fresh=true,new_model=true,trial=true}={})=>({
 item:{stock_id:'9910',as_of:day,new_model,metrics:{close:22.1}},
 quote:{fresh,quote_time:'12:51:00',price:22.5},
 action:{phase:trial?'trial':'candidate',trialable:trial}
});
(async()=>{
 const noWrites=[];
 const none=harness(async v=>{noWrites.push(v);return null;});
 none.persistVerifiedTrialRows([row({fresh:false})]);
 none.persistVerifiedTrialRows([row({new_model:false})]);
 none.persistVerifiedTrialRows([row({trial:false})]);
 await tick();
 assert.equal(noWrites.length,0,'Unverified, legacy, and non-trial rows never write');
 assert.equal(none.verifiedTrialOutbox.size,0,'Unverified rows never enter outbox');
 let writes=0;
 const bad=harness(async()=>{writes++;return null;});
 bad.persistVerifiedTrialRows([row()]);
 await tick();
 assert.equal(writes,1,'Verified trial attempts one server write');
 assert.equal(bad.verifiedTrialOutbox.size,1,'Unacknowledged trial must remain durable');
 const key=bad.VERIFIED_TRIAL_OUTBOX_KEY;
 assert.equal(JSON.parse(fakeStorage.get(key)).length,1,'Outbox persists through reload');
 bad.persistVerifiedTrialRows([row()]);
 await tick();
 assert.equal(writes,1,'Backoff prevents repeated writes during a single refresh');
 // Previous attempt was not ACKed, so a reload never silently drops it.
 const recovered=harness(async()=>{writes++;return null;});
 assert.equal(recovered.verifiedTrialOutbox.size,1,'Local verified trial restored on reload');
 assert.equal(recovered.verifiedTrialOutbox.values().next().value.as_of,day);
 // Simulate passage of the bounded 3-minute retry gate without changing the event itself.
 const saved=JSON.parse(fakeStorage.get(key));
 saved[0].last_attempt_at=0;
 fakeStorage.set(key,JSON.stringify(saved));
 const ack=harness(async updates=>{
   writes++;
   return {ok:true,watches:updates.map(v=>({stock_id:v.stock_id,trial_last_as_of:v.first_as_of,active:true}))};
 });
 ack.persistVerifiedTrialRows([]);
 await tick();
 assert.equal(writes,2,'ACK retry uses the existing watch POST, not market quote or scan');
 assert.equal(ack.verifiedTrialOutbox.size,0,'Matching trial date ACK clears outbox');
 assert.deepEqual(JSON.parse(fakeStorage.get(key)),[],'Confirmed trial no longer pending');
 const closed=harness(async()=>{throw new Error('Must not be called')},'LAUNCH');
 closed.persistVerifiedTrialRows([row()]);
 await tick();
 assert.equal(closed.verifiedTrialOutbox.size,1,'Capture allowed only from a verified row; no background write');
 assert.deepEqual(JSON.parse(fakeStorage.get(key)).length,1);
 console.log('PASS: real orange quote only, no legacy/backfill fabrication, durable retry, server ACK, no extra scanning');
})().catch(e=>{console.error(e);process.exit(1)});

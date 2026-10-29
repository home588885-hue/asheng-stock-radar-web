import { createClient } from 'npm:@supabase/supabase-js@2.117.3';
import { buildSectorRotation } from './rotation-score.mjs';

const headers={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Methods':'GET,OPTIONS',
  'Access-Control-Allow-Headers':'authorization,apikey,content-type',
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'public,max-age=90,s-maxage=90'
};
const respond=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
Deno.serve(async (req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='GET')return respond({ok:false,error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||!key)return respond({ok:false,error:'config_missing'},503);
  try{
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:latest,error:le}=await db.from('spring_swallow_scan_results')
      .select('as_of').order('as_of',{ascending:false}).limit(1);
    if(le||!latest?.[0]?.as_of)throw new Error('no_valid_snapshot_date');
    const asOf=String(latest[0].as_of);
    // Only the most recent EOD model date. Never mix scans from other days.
    const {data,error}=await db.from('spring_swallow_scan_results')
      .select('stock_id,industry,as_of,close:metrics->>close,prev_close:metrics->>prev_close,current_volume_lots:metrics->>current_volume_lots,avg_volume_20_lots:metrics->>avg_volume_20_lots')
      .eq('as_of',asOf).order('stock_id',{ascending:true}).limit(1000);
    if(error||!Array.isArray(data))throw new Error('snapshot_read_failed');
    const result=buildSectorRotation(data,asOf,new Date(),data.length>=1000);
    return respond({...result,generated_at:new Date().toISOString(),
      caveat:'量價僅為最新完整日K掃描樣本，不是全市場或法人資金淨流入，也不是即時成交。'});
  }catch(e){
    console.error('asheng_sector_rotation_failed',String(e));
    return respond({ok:false,error:'sector_rotation_unavailable',live:false},503);
  }
});

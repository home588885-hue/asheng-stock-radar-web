/* 阿勝雷達 C 盤中族群量價估算。只有讀取既有 C 行情，沒有任何新 API 請求。
   C 的「成交量增量 × 當次成交價」只代表估算成交金額，絕非資金淨流入或買點。 */
(function(root){
  'use strict';
  const numeric=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x))?Number(x):null;
  const positive=x=>{const n=numeric(x);return n!==null&&n>0?n:null;};
  const marketName=m=>{
    const s=String(m||'').toLowerCase();
    return s.includes('otc')||s.includes('tpex')||s.includes('櫃')?'otc':
      s==='tse'||s==='twse'||s.includes('上市')?'tse':null;
  };
  const dayNow=(at)=>{
    const parts=new Intl.DateTimeFormat('en-CA',{
      timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'
    }).formatToParts(at);
    const v=Object.fromEntries(parts.map(p=>[p.type,p.value]));
    return v.year+v.month+v.day;
  };
  const dateTime=(day,time)=>{
    if(!/^20\d{6}$/.test(String(day||'')))return null;
    const m=/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?$/.exec(String(time||''));
    if(!m)return null;
    const hour=Number(m[1]),min=Number(m[2]);
    if(hour<9||hour>13||(hour===13&&min>30))return null;
    const iso=day.slice(0,4)+'-'+day.slice(4,6)+'-'+day.slice(6,8)+'T'
      +String(hour).padStart(2,'0')+':'+m[2]+':'+(m[3]||'00')+'+08:00';
    const at=Date.parse(iso);
    return Number.isFinite(at)?at:null;
  };
  const limit=280;
  function createCSectorActivity(){
    let session='';
    const names=new Map(),quotes=new Map();
    const track=(stock)=>{
      const id=String(stock?.stock_id||'');
      const market=marketName(stock?.market);
      const industry=String(stock?.industry||'').trim();
      if(!/^[0-9A-Z.-]{2,12}$/.test(id)||!market||!industry||industry==='其他')return false;
      const avg=positive(stock?.avg_volume_20_lots);
      const stage=String(stock?.stage||'');
      const asOf=String(stock?.as_of||'').slice(0,10);
      names.set(id,{industry,market,avg,stage,asOf});
      if(names.size>limit)names.delete(names.keys().next().value);
      return true;
    };
    const observe=(items,{now=new Date(),marketOpen=false,stage=''}={})=>{
      if(!marketOpen||!(now instanceof Date)||!Number.isFinite(now.getTime()))return 0;
      const today=dayNow(now);
      if(session!==today){session=today;quotes.clear();}
      let updated=0;
      for(const q of Array.isArray(items)?items:[]){
        if(q?.cached_last_trade===true||q?.has_today_trade!==true)continue;
        const id=String(q.stock_id||''),meta=names.get(id);
        if(!meta||marketName(q.market)!==meta.market
          ||(stage&&meta.stage!==stage))continue;
        const day=String(q.quote_date||'').replace(/[^0-9]/g,'');
        if(day!==today)continue;
        if(!['mis_last_trade','mis_trade_last'].includes(String(q.price_source||'')))continue;
        const price=positive(q.price),cumulative=positive(q.volume_lots);
        const at=dateTime(day,q.quote_time);
        if(price===null||cumulative===null||at===null)continue;
        const age=now.getTime()-at;
        if(age < -120000||age>300000)continue;
        const old=quotes.get(id);
        if(old && at<=old.newer.at)continue; // same cached trade is not a new sample
        const newer={at,price,cumulative,day};
        const prev=old?.newer||null;
        const elapsed=prev?(at-prev.at)/60000:null;
        const delta=prev?cumulative-prev.cumulative:null;
        const pair=prev&&elapsed>=1&&elapsed<=10&&delta>0
          ?{elapsed,delta,at,estimatedTwdPerMinute:delta*price*1000/elapsed,
            volumePace:meta.avg?delta/elapsed/(meta.avg/270):null}
          :null;
        quotes.set(id,{newer,pair});
        if(quotes.size>limit)quotes.delete(quotes.keys().next().value);
        updated++;
      }
      return updated;
    };
    const summarize=(industry,market,{now=new Date(),marketOpen=false,stage=''}={})=>{
      if(!marketOpen||dayNow(now)!==session)return {ready:false,reason:'market_closed_or_no_today_sample'};
      const m=marketName(market),sector=String(industry||'');
      const members=[...names].filter(([,v])=>v.market===m&&v.industry===sector
        &&(!stage||v.stage===stage));
      if(!sector||!m||!members.length)return {ready:false,reason:'not_tracked'};
      const usable=[];
      for(const [id,meta] of members){
        const sample=quotes.get(id);
        if(!sample?.pair||!sample?.newer||sample.newer.day!==session)continue;
        if(now.getTime()-sample.newer.at>300000||now.getTime()-sample.newer.at< -120000)continue;
        const baseline=Date.parse(meta.asOf+'T00:00:00+08:00');
        const ageDays=(now.getTime()-baseline)/86400000;
        const pace=Number.isFinite(ageDays)&&ageDays>=0&&ageDays<=6
          ?sample.pair.volumePace:null;
        usable.push({id,...sample.pair,volumePace:pace});
      }
      const covered=usable.length,total=members.length,coverage=total?covered/total:0;
      if(covered<3||coverage<0.6)return {ready:false,reason:'insufficient_paired_C_quotes',
        covered,total,coverage_pct:Math.round(coverage*100)};
      const pacing=usable.map(x=>x.volumePace).filter(x=>Number.isFinite(x)&&x>0&&x<30)
        .sort((a,b)=>a-b);
      if(pacing.length<Math.ceil(covered*.6))return {
        ready:false,reason:'missing_verified_S_avg_volume',covered,total
      };
      const pace=pacing[Math.floor((pacing.length-1)/2)];
      const value=usable.reduce((sum,x)=>sum+x.estimatedTwdPerMinute,0);
      return {ready:true,scope:'tracked_C_quote_subset_not_whole_market',
        is_net_inflow:false,is_exact_trade_value:false,
        market:m,industry:sector,covered,total,
        median_volume_pace:Math.round(pace*100)/100,
        estimated_twd_per_minute:Math.round(value),
        as_of:Math.max(...usable.map(x=>x.at)),
        date:session};
    };
    const label=(industry,market,opts={})=>{
      const v=summarize(industry,market,opts);
      if(!v.ready)return '｜C盤中族群：'+(v.reason==='market_closed_or_no_today_sample'
        ?'非即時':'有效連續樣本不足');
      const time=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',
        hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v.as_of));
      const perMinute=v.estimated_twd_per_minute/10000;
      const cash=perMinute>=10000?(perMinute/10000).toFixed(2)+'億':perMinute.toFixed(0)+'萬';
      return '｜C追蹤族群 '+v.covered+'/'+v.total+'檔｜量能'
        +v.median_volume_pace.toFixed(1)+'x｜估每分鐘成交額 '+cash
        +'（'+time+'，非淨買超）';
    };
    return {track,observe,summarize,label};
  }
  root.AshengCSectorActivity=Object.freeze({createCSectorActivity});
})(typeof window!=='undefined'?window:globalThis);

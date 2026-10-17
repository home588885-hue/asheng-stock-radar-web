// Isolated one-time Cloudflare egress diagnostic.
// Never touches stock quotes, scanners, portfolio, Supabase, or other Workers.
function out(body,status=200){return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json","cache-control":"no-store","x-content-type-options":"nosniff"}})}
export default {
  async fetch(request,env){
    if(request.method!=="POST")return out({error:"method-not-allowed"},405);
    if(!env.PROBE_TOKEN)return out({error:"probe-not-configured"},503);
    const token=request.headers.get("x-probe-token")||"";
    if(!token||token!==env.PROBE_TOKEN)return out({error:"unauthorized"},401);
    try{
      const raw=await request.text();
      if(raw.length>1800)return out({error:"request-too-large"},413);
      const data=JSON.parse(raw);
      const photo=String(data.url||"").replaceAll("{0}","1024").replaceAll("{1}","768");
      const url=new URL(photo);
      if(url.protocol!=="https:"||url.hostname!=="yccdn.yungching.com.tw"||url.pathname!=="/v1/image/"||url.port||url.username||url.password||!url.searchParams.has("key"))return out({error:"unexpected-source"},400);
      const upstream=await fetch(url.toString(),{
        method:"GET",
        redirect:"manual",
        headers:{"accept":"image/avif,image/webp,image/*,*/*;q=0.8"},
        signal:AbortSignal.timeout(12000)
      });
      const contentType=(upstream.headers.get("content-type")||"").split(";")[0].toLowerCase();
      const length=Number(upstream.headers.get("content-length")||"0");
      if(length>5000000)return out({upstream_status:upstream.status,content_type:contentType,too_large:true,image_verified:false});
      const bytes=new Uint8Array(await upstream.arrayBuffer());
      const magic=(bytes.length>3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)?"jpeg":
                  (bytes.length>8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78)?"png":
                  (bytes.length>12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP")?"webp":"not-image";
      return out({
        upstream_status:upstream.status,content_type:contentType,bytes:bytes.length,magic,
        image_verified:upstream.status===200&&magic!=="not-image"&&bytes.length>3000
      });
    }catch(e){return out({error_type:e instanceof Error?e.name:"unknown"},502)}
  }
};

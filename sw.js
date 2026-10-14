// Stock radar PWA: NEVER serve a stale HTML strategy or holding dashboard.
// Only same-origin top-level document navigations are intercepted.
// S/C APIs, authentication and quotes are deliberately NOT intercepted or cached.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.mode!=='navigate'||req.method!=='GET')return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(fetch(req,{cache:'no-store'}));
});

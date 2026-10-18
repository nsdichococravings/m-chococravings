const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('supabase-net.js','utf8');

function harness(responder){
  const calls=[];const timers=[];
  const ctx={AbortController,Promise,Object,String,Math,Error,
    setTimeout(fn,ms){const t={fn,ms,cleared:false};timers.push(t);return t;},
    clearTimeout(t){if(t)t.cleared=true;},
    fetch(input,init){calls.push({input,init});return responder(calls.length,init);}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(code,ctx);
  const fire=ms=>{const t=timers.find(x=>!x.cleared&&!x.fired&&x.ms===ms);assert.ok(t,'timer '+ms+' scheduled');t.fired=true;t.fn();};
  return {ctx,calls,timers,fire};
}
function hanging(init){return new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'}))));}
const tick=()=>new Promise(r=>setImmediate(r));

(async()=>{
  // Options helper keeps existing settings and adds the fetch.
  {const h=harness(()=>Promise.resolve({ok:true}));
   const opts=h.ctx.ccClientOptions({auth:{persistSession:false},global:{headers:{a:'1'}}});
   assert.equal(opts.auth.persistSession,false);assert.equal(opts.global.headers.a,'1');assert.equal(opts.global.fetch,h.ctx.ccFetch);}

  // A hung read gives up after 30s with a clear error, marked so the
  // Supabase library does not resend it to a struggling server.
  {const h=harness((n,init)=>hanging(init));
   const p=h.ctx.ccFetch('https://x.supabase.co/rest/v1/menu',{method:'GET'});
   h.fire(30000);
   await assert.rejects(p,e=>e.name==='AbortError'&&e.ccTimeout===true&&/slow/.test(e.message));await tick();assert.equal(h.calls.length,1,'not resent');}

  // A write is never repeated: it may already have reached the server.
  {const h=harness((n,init)=>hanging(init));
   const p=h.ctx.ccFetch('https://x.supabase.co/rest/v1/store_orders',{method:'POST',body:'{}'});
   h.fire(30000);await assert.rejects(p,e=>e.ccTimeout===true);await tick();assert.equal(h.calls.length,1,'no duplicate order');}

  // Login refresh has its own limit so it can't block other calls for long.
  {const h=harness((n,init)=>hanging(init));
   const p=h.ctx.ccFetch('https://x.supabase.co/auth/v1/token?grant_type=refresh_token',{method:'POST'});
   h.fire(20000);await assert.rejects(p,e=>e.ccTimeout===true);}

  // Photo uploads get a long limit.
  {const h=harness(()=>new Promise(()=>{}));
   h.ctx.ccFetch('https://x.supabase.co/storage/v1/object/photos/a.jpg',{method:'POST'});
   assert.ok(h.timers.some(t=>t.ms===120000));}

  // A cancel from the caller is passed through and not retried.
  {const h=harness((n,init)=>hanging(init));const c=new AbortController();
   const p=h.ctx.ccFetch('https://x.supabase.co/rest/v1/menu',{signal:c.signal});
   c.abort();await assert.rejects(p,e=>e.name==='AbortError');await tick();assert.equal(h.calls.length,1);
   assert.ok(h.timers.every(t=>t.cleared||t.fired),'timer cleared after cancel');}

  // A normal response clears its timer.
  {const h=harness(()=>Promise.resolve({ok:true,status:200}));
   await h.ctx.ccFetch('https://x.supabase.co/rest/v1/menu');assert.ok(h.timers.every(t=>t.cleared));}

  // Pages load the helper right after the Supabase library.
  for(const page of ['store.html','admin-dashboard.html','index.html','stall.html','attendance.html']){
    const html=fs.readFileSync(page,'utf8');
    const lib=html.indexOf('supabase-js@2'),net=html.indexOf('supabase-net.js');
    assert.ok(lib>0&&net>lib,page+' loads supabase-net.js after the library');
    assert.match(html,/ccClientOptions/,page+' uses ccClientOptions');
  }
  console.log('PASS: timeouts not resent, writes never repeated, auth limit, long upload limit, caller cancel respected, timers cleared, pages wired.');
})().catch(e=>{console.error(e);process.exitCode=1;});

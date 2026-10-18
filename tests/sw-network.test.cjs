const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('sw.js','utf8');
function harness({cached,network,html}){
  const timers=[],put=[],listeners={},posted=[],waits=[];
  const ctx={URL,Promise,console,
    setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},
    caches:{match:async()=>cached,open:async()=>({put:async(r,res)=>put.push(res)})},
    fetch:()=>network,
    self:{location:{origin:'https://shop.test'},addEventListener(n,fn){listeners[n]=fn;},skipWaiting(){},
      clients:{claim(){},matchAll:async()=>[{id:'c1',url:'https://shop.test/',postMessage(m){posted.push(m);}}]}}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  let responded;const event={resultingClientId:'c1',request:{url:html?'https://shop.test/':'https://shop.test/store-patch.js',method:'GET',headers:{get:()=>html?'text/html':''}},
    respondWith(p){responded=p;},waitUntil(p){waits.push(p);}};
  listeners.fetch(event);
  return {timers,put,posted,settle:()=>Promise.all(waits),get response(){return responded;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
const fresh={ok:true,clone(){return this;},tag:'fresh'},old={tag:'cached'};
(async()=>{
  // Fast network wins.
  let h=harness({cached:old,network:Promise.resolve(fresh)});
  assert.equal((await h.response).tag,'fresh');await tick();assert.equal(h.put.length,1,'fresh copy saved');
  // Slow network: saved copy after 4s; network keeps going and refreshes the cache.
  let finish;h=harness({cached:old,network:new Promise(r=>finish=r)});
  const t=h.timers.find(x=>x.ms===4000);assert.ok(t,'4s wait');t.fn();
  assert.equal((await h.response).tag,'cached');finish(fresh);await tick();await tick();assert.equal(h.put.length,1,'cache refreshed in background');
  // Slow network and nothing saved: keep waiting for the network.
  h=harness({cached:undefined,network:new Promise(r=>finish=r)});
  h.timers.find(x=>x.ms===4000).fn();await tick();finish(fresh);assert.equal((await h.response).tag,'fresh');
  // Network fails: saved copy.
  h=harness({cached:old,network:Promise.reject(new TypeError('offline'))});
  assert.equal((await h.response).tag,'cached');
  // Pages open from the saved copy at once and are refreshed in the background.
  const page=t=>({ok:true,redirected:false,clone(){return page(t);},text:async()=>t,tag:t});
  h=harness({html:true,cached:page('v1'),network:new Promise(()=>{})});
  assert.equal((await h.response).tag,'v1','saved page shown without waiting for the network');
  h=harness({html:true,cached:page('v1'),network:Promise.resolve(page('v2'))});
  assert.equal((await h.response).tag,'v1');await h.settle();await tick();
  assert.equal(h.put.length,1,'new version saved');assert.equal(JSON.stringify(h.posted),'[{"type":"cc-page-updated"}]','page told about new version');
  h=harness({html:true,cached:page('v1'),network:Promise.resolve(page('v1'))});
  await h.response;await h.settle();await tick();assert.equal(h.posted.length,0,'no banner when nothing changed');
  h=harness({html:true,cached:undefined,network:Promise.resolve(page('v1'))});
  assert.equal((await h.response).tag,'v1','first visit uses the network');
  console.log('PASS: saved page first, background refresh, update notice only on change, first visit from network.');
  console.log('PASS: fast network used, slow network falls back to saved copy after 4s and refreshes it, no saved copy waits, offline uses saved copy.');
})().catch(e=>{console.error(e);process.exitCode=1;});

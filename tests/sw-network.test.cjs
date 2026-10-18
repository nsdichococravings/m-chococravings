const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('sw.js','utf8');
function harness({cached,network}){
  const timers=[],put=[],listeners={};
  const ctx={URL,Promise,console,
    setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},
    caches:{match:async()=>cached,open:async()=>({put:async(r,res)=>put.push(res)})},
    fetch:()=>network,
    self:{addEventListener(n,fn){listeners[n]=fn;},skipWaiting(){},clients:{claim(){}}}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  let responded;const event={request:{url:'https://shop.test/store-patch.js',method:'GET',headers:{get:()=>''}},
    respondWith(p){responded=p;},waitUntil(){}};
  listeners.fetch(event);
  return {timers,put,get response(){return responded;}};
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
  console.log('PASS: fast network used, slow network falls back to saved copy after 4s and refreshes it, no saved copy waits, offline uses saved copy.');
})().catch(e=>{console.error(e);process.exitCode=1;});

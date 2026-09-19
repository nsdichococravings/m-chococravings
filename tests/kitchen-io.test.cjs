const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('table-service-patch.js', 'utf8');
const code = source.slice(source.indexOf('var _kRefreshPending = null;'), source.indexOf('// Starts once, early,'));
let active = true, now = 10000, reads = 0, resolve, renders = 0, interval;
const timers = new Map(), listeners = {};
let nextId = 0;
const ctx = {
  Promise, Date: class extends Date { static now() { return now; } },
  document: {hidden:false, getElementById(id) { return id === 'pg-kitchen' ? {classList:{contains:()=>active}} : null; },
    addEventListener(name,fn) { listeners[name] = fn; }},
  setTimeout(fn) { timers.set(++nextId,fn); return nextId; }, clearTimeout(id) { timers.delete(id); },
  setInterval(fn,ms) { interval={fn,ms}; return 1; }, clearInterval(){},
  db:{from() { reads++; return {select(){return this;},gte(){return this;},in(){return this;},
    order(){return new Promise(r=>{resolve=r;});}};}},
  renderKitchen(){renders++;},showStoreToast(){},
};
vm.createContext(ctx); vm.runInContext(code,ctx);
ctx.kitchenSilentRefresh=()=>ctx.kitchenRefresh(false);
(async()=>{
  ctx.document.hidden=true; await ctx.kitchenRefresh(false); assert.equal(reads,0);
  ctx.document.hidden=false; active=false; await ctx.kitchenRefresh(false); assert.equal(reads,0);
  active=true;
  const first=ctx.kitchenRefresh(false);
  for(let i=0;i<20;i++) ctx.kitchenRefresh(false);
  assert.equal(reads,1,'burst must not overlap queries'); assert.equal(timers.size,1);
  resolve({data:[]}); await first; assert.equal(renders,1);
  now+=3000;
  const timer=[...timers.values()][0]; timers.clear(); timer();
  assert.equal(reads,2,'events during a read must trigger a trailing fresh read');
  const second=ctx._kRefreshPending; resolve({data:[]}); await second;
  ctx.kStartPolling(); assert.equal(interval.ms,60000);
  ctx.document.hidden=true; interval.fn(); assert.equal(reads,2);
  now+=60000; ctx.document.hidden=false; listeners.visibilitychange();
  assert.equal(reads,3,'returning to Kitchen catches up');
  const third=ctx._kRefreshPending; resolve({error:new Error('unavailable')}); await third;
  assert.equal(ctx._kRefreshPending,null,'failed reads must release guard');
  const manual=ctx.kitchenRefresh(true); assert.equal(reads,4,'manual retry bypasses cooldown');
  resolve({data:[]}); await manual;
  console.log('Kitchen IO tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('table-service-patch.js','utf8');
const code=source.slice(source.indexOf('var _kRefreshPending = null;'),source.indexOf('// Starts once, early,'));
const store={},renders=[];let lookupResolve;
const ctx={Promise,JSON,Object,Date,
  sessionStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>{store[k]=v;}},
  document:{hidden:false,getElementById:id=>id==='pg-kitchen'?{classList:{contains:()=>true}}:null,addEventListener(){}},
  setTimeout(){},clearTimeout(){},setInterval(){},clearInterval(){},
  db:{from(){return {select(){return this;},gte(){return this;},in(){return this;},order:async()=>({data:[{id:'k1',customer_phone:'+919876543210'}]})};}},
  renderKitchen:(o,m)=>renders.push({n:o.length,pending:!!m._pending,card:m['9876543210']}),showStoreToast(){},
  lcLoyaltyMapFor:()=>new Promise(r=>lookupResolve=r)};
vm.createContext(ctx);vm.runInContext(code,ctx);
(async()=>{
  const p=ctx.kitchenFetchOrders(false);await new Promise(r=>setImmediate(r));
  assert.equal(renders.length,1,'tickets drawn before the card lookup returns');assert.equal(renders[0].pending,true,'shows "Checking card…" meanwhile');
  lookupResolve({'9876543210':{card_code:'LC1'}});await p;
  assert.equal(renders.length,2);assert.equal(renders[1].card.card_code,'LC1','cards filled in after lookup');
  // Next refresh shows the known card at once.
  const p2=ctx.kitchenFetchOrders(false);await new Promise(r=>setImmediate(r));
  assert.equal(renders[2].card.card_code,'LC1','known card shown immediately on next refresh');lookupResolve({_unavailable:true});await p2;
  // Today's tickets are kept for the tab; another day's are ignored.
  assert.equal(ctx.kSavedOrders().length,1);
  store.cc_kitchen_orders_v1=JSON.stringify({day:'2000-01-01',orders:[{id:'old'}]});assert.equal(ctx.kSavedOrders(),null);
  console.log('PASS: tickets before card lookup, placeholder then cards, known cards reused, saved tickets only for today.');
})().catch(e=>{console.error(e);process.exitCode=1;});

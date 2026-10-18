const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('store.html','utf8');
const code=html.slice(html.indexOf('var storeMenuLoading = false;'),html.indexOf('// ── STATE',html.indexOf('var storeMenuLoading = false;')));
function harness(store){
  const el={'items-list':{innerHTML:''},'cart-empty':{style:{}},'store-loading-overlay':{style:{}}};
  let resolveReq,renders=0,skeleton=0;
  const ctx={AbortController,Promise,JSON,Object,console:{error(){}},MENU:{Coffee:{items:[]}},SUPABASE_URL:'x',SUPABASE_KEY:'k',
    localStorage:{getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=v;}},
    document:{getElementById:id=>el[id]||null},setTimeout:()=>0,clearTimeout(){},
    showSkeleton(){skeleton++;},renderItems(){renders++;},loadMenuStats(){},
    supabase:{createClient:()=>({from:()=>({select(){return this;},eq(){return this;},order(){return this;},abortSignal(){return new Promise(r=>resolveReq=r);}})})}};
  vm.createContext(ctx);vm.runInContext(code,ctx);
  return {ctx,el,resolve:v=>resolveReq(v),get renders(){return renders;},get skeleton(){return skeleton;}};
}
(async()=>{
  const store={};
  let h=harness(store);let p=h.ctx.loadMenu();assert.equal(h.skeleton,1,'first visit shows the loader');
  h.resolve({data:[{id:'a',name:'Latte',price:120,category:'Coffee'}]});await p;
  assert.equal(h.renders,1);assert.ok(store.cc_store_menu_v1,'menu saved');
  // Next open: saved menu drawn before the network replies, no loader.
  h=harness(store);p=h.ctx.loadMenu();
  assert.equal(h.renders,1,'saved menu drawn at once');assert.equal(h.skeleton,0,'no loader');assert.equal(h.ctx.MENU.Coffee.items[0].name,'Latte');
  h.resolve({data:[{id:'a',name:'Latte',price:120,category:'Coffee'}]});await p;assert.equal(h.renders,1,'unchanged menu not redrawn');
  // Changed menu replaces the saved one.
  h=harness(store);p=h.ctx.loadMenu();h.resolve({data:[{id:'a',name:'Latte',price:140,category:'Coffee'}]});await p;
  assert.equal(h.renders,2);assert.equal(h.ctx.MENU.Coffee.items[0].price,140);
  // Connection error keeps the saved menu instead of the error screen.
  h=harness(store);p=h.ctx.loadMenu();h.resolve({error:new Error('offline')});await p;
  assert.doesNotMatch(h.el['items-list'].innerHTML,/Retry loading menu/);assert.equal(h.ctx.MENU.Coffee.items[0].price,140);
  console.log('PASS: loader on first visit, saved menu shown at once, unchanged not redrawn, changes applied, error keeps saved menu.');
})().catch(e=>{console.error(e);process.exitCode=1;});

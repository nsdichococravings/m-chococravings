const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const html=fs.readFileSync('store.html','utf8');
const code=html.slice(html.indexOf('var storeMenuLoading = false;'),html.indexOf('// ── STATE',html.indexOf('var storeMenuLoading = false;')));
function harness(){
  const elements={'store-loading-overlay':{style:{}},'items-list':{innerHTML:''},'cart-empty':{style:{}}};
  const timers=new Map();let id=0,resolveRequest,requests=0,renders=0,signal;
  const context={AbortController,console:{error(){}},Promise,MENU:{Coffee:{items:[]}},
    SUPABASE_URL:'https://example.test',SUPABASE_KEY:'public-test-key',
    document:{getElementById:id=>elements[id]},setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
    showSkeleton(){elements['store-loading-overlay'].style.display='flex';},renderItems(){renders++;},
    db:{from(){requests++;return{select(){return this;},eq(){return this;},order(){return this;},abortSignal(s){signal=s;return new Promise(r=>{resolveRequest=r;});}}}}
  };
  context.supabase={createClient(url,key,options){
    assert.equal(options.auth.persistSession,false);assert.equal(options.auth.autoRefreshToken,false);
    return context.db;
  }};
  vm.createContext(context);vm.runInContext(code,context);
  return {context,elements,timers,resolve:value=>resolveRequest(value),get requests(){return requests;},get renders(){return renders;},get signal(){return signal;}};
}
(async()=>{
  const test=harness(),pending=test.context.loadMenu();
  await test.context.loadMenu();assert.equal(test.requests,1,'avoid overlapping menu requests');
  [...test.timers.values()].find(t=>t.ms===2500).fn();
  assert.equal(test.elements['store-loading-overlay'].style.display,'none','slow request must release fullscreen loader');
  [...test.timers.values()].find(t=>t.ms===12000).fn();await pending;
  assert.equal(test.signal.aborted,true);assert.match(test.elements['items-list'].innerHTML,/Retry loading menu/);
  assert.equal(test.context.storeMenuLoading,false);assert.equal(test.timers.size,0);
  test.resolve({data:[{id:'stale',category:'Coffee'}]});await Promise.resolve();
  assert.equal(test.renders,0,'late timed-out response must not replace error UI');
  const retry=test.context.loadMenu();test.resolve({data:[{id:'fresh',name:'Coffee',price:30,category:'Coffee'}]});await retry;
  assert.equal(test.context.MENU.Coffee.items[0].id,'fresh');assert.equal(test.renders,1);assert.equal(test.timers.size,0);
  const missing=harness();missing.context.db=null;missing.context.supabase=undefined;await missing.context.loadMenu();
  assert.match(missing.elements['items-list'].innerHTML,/Retry loading menu/);assert.equal(missing.elements['store-loading-overlay'].style.display,'none');
  const auth=harness();let authResolve,authCalls=0;
  auth.context.db.auth={getUser(){authCalls++;return new Promise(resolve=>{authResolve=resolve;});}};
  const first=auth.context.getStoreVerifiedUser(),second=auth.context.getStoreVerifiedUser();
  assert.equal(authCalls,1,'concurrent startup checks share one server verification');
  authResolve({data:{user:{id:'verified'}}});await Promise.all([first,second]);
  assert.equal(auth.context.storeVerifiedUserPending,null);
  const publicOnly=harness();const publicDb=publicOnly.context.db;
  publicOnly.context.db={from(){throw new Error('Authenticated client must not load public menu');}};
  publicOnly.context.supabase.createClient=()=>publicDb;
  const menu=publicOnly.context.loadMenu();publicOnly.resolve({data:[]});await menu;
  assert.equal(publicOnly.renders,1,'public menu loads independently of authenticated client');
  console.log('PASS: loader release, timeout/abort, duplicate request guard, late response isolation, retry success, unavailable client recovery.');
})().catch(error=>{console.error(error);process.exitCode=1;});

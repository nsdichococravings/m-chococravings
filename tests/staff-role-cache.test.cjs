const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('../.production-test-runtime/node_modules/linkedom');
function setup(store){
  const {document}=parseHTML('<html><body><div id="admin-quick-actions"></div><div id="kitchen-fab"></div></body></html>');
  let role={is_admin:true,is_employee:false},hold=null,authHandler;const loads=[];
  const localStorage={getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];}};
  const ctx={document,localStorage,console:{warn(){}},isAdmin:false,_storeIsOpen:true,setInterval(){},clearInterval(){},setTimeout(){},clearTimeout(){},
    db:{auth:{async getSession(){return {data:{session:{user:{id:'u1'}}}};},getUser(){return hold?new Promise(r=>hold.resolve=r):Promise.resolve({data:{user:{id:'u1',email:'a@test'}}});},onAuthStateChange(fn){authHandler=fn;return {};}},
      from(){return {select(){return this;},eq(){return this;},async single(){return {data:role};}};}}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('admin-command-center.js','utf8'),ctx);
  vm.runInContext(fs.readFileSync('checkadminbadge-override.js','utf8'),ctx);ctx.loadScriptsSequentially=l=>loads.push(...l);
  return {ctx,loads,setRole:r=>role=r,hold:()=>hold={},release:u=>hold.resolve(u),signOut:()=>authHandler('SIGNED_OUT')};
}
const tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
  const store={};
  // First visit: nothing saved, access only after the server confirms; role is then saved.
  let t=setup(store);await t.ctx.checkAdminBadge();assert.equal(t.ctx._ccAccessGranted,true);
  assert.equal(JSON.parse(store.cc_staff_role_v1).admin,true,'role saved');
  // Next visit: tools shown and loading before the server answers.
  t=setup(store);t.hold();const p=t.ctx.checkAdminBadge();await tick();
  assert.equal(t.ctx._ccAccessGranted,true,'saved admin sees Command Center at once');assert.ok(t.loads.length>0,'admin tools start loading at once');
  t.release({data:{user:{id:'u1',email:'a@test'}}});await p;assert.equal(t.ctx._ccAccessGranted,true);
  // Role removed on the server: the check takes access away and forgets the role.
  t=setup(store);t.setRole({is_admin:false,is_employee:false});t.hold();const q=t.ctx.checkAdminBadge();await tick();
  assert.equal(t.ctx._ccAccessGranted,true);t.release({data:{user:{id:'u1',email:'a@test'}}});await q;
  assert.equal(t.ctx._ccAccessGranted,false,'server check revokes access');assert.equal(store.cc_staff_role_v1,undefined,'saved role cleared');
  // A saved role for another account is ignored.
  store.cc_staff_role_v1=JSON.stringify({uid:'someone-else',admin:true,employee:false});
  t=setup(store);t.setRole({is_admin:false,is_employee:false});t.hold();t.ctx.checkAdminBadge();await tick();
  assert.equal(t.ctx._ccAccessGranted,false,'other account role not used');
  // Sign out forgets the role.
  store.cc_staff_role_v1=JSON.stringify({uid:'u1',admin:true,employee:false});
  t=setup(store);await t.ctx.checkAdminBadge();t.signOut();assert.equal(store.cc_staff_role_v1,undefined);assert.equal(t.ctx._ccAccessGranted,false);
  console.log('PASS: role saved after check, saved admin shown at once, server check revokes, other account ignored, sign-out clears.');
})().catch(e=>{console.error(e);process.exit(1);});

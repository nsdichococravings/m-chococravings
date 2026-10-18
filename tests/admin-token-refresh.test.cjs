const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('../.production-test-runtime/node_modules/linkedom');
const {document}=parseHTML('<html><body><div id="admin-quick-actions"></div><div id="kitchen-fab"></div></body></html>');
let user={id:'admin',email:'admin@test'},roleCalls=0,fail=false,authHandler;const timers=[];
const ctx={document,console:{warn(){}},isAdmin:false,_storeIsOpen:true,setInterval(){},clearInterval(){},
  setTimeout(fn,ms){const t={fn,ms};timers.push(t);return t;},clearTimeout(t){const i=timers.indexOf(t);if(i>=0)timers.splice(i,1);},
  db:{auth:{async getUser(){return {data:{user}};},onAuthStateChange(fn){authHandler=fn;return {};}},
    from(){return {select(){return this;},eq(){return this;},async single(){roleCalls++;return fail?{error:{message:'Failed to fetch'}}:{data:{is_admin:true,is_employee:false}};}};}}};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('admin-command-center.js','utf8'),ctx);
vm.runInContext(fs.readFileSync('checkadminbadge-override.js','utf8'),ctx);ctx.loadScriptsSequentially=()=>{};
(async()=>{
  await ctx.checkAdminBadge();assert.equal(ctx.isAdmin,true);assert.equal(roleCalls,1);
  timers.length=0;
  authHandler('TOKEN_REFRESHED',{user:{id:'admin'}});
  assert.equal(ctx.isAdmin,true,'token refresh keeps tools visible');assert.equal(timers.length,0,'no re-check on token refresh');
  authHandler('SIGNED_IN',{user:{id:'admin'}});
  assert.equal(ctx.isAdmin,true,'same user signing in again keeps tools');assert.equal(timers.length,0);
  authHandler('SIGNED_IN',{user:{id:'other'}});
  assert.equal(ctx.isAdmin,false,'a different user is checked again');assert.equal(timers.length,1);
  timers.length=0;fail=true;await ctx.checkAdminBadge();
  const retry=timers.find(t=>t.ms===3000);assert.ok(retry,'failed check retries after 3s');
  fail=false;timers.length=0;await retry.fn();await new Promise(r=>setImmediate(r));
  assert.equal(ctx.isAdmin,true,'retry restores access once the connection is back');
  authHandler('SIGNED_OUT');assert.equal(ctx.isAdmin,false);
  console.log('PASS: token refresh keeps access, same-user sign-in ignored, new user re-checked, failed check retried, sign-out clears.');
})().catch(e=>{console.error(e);process.exit(1);});

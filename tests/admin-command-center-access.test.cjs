const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('../.production-test-runtime/node_modules/linkedom');
const {document}=parseHTML('<html><body><div id="admin-fab-pill"></div><div id="admin-quick-actions"></div><div id="kitchen-fab"></div><div id="print-invoice-btn"></div></body></html>');
let role={is_admin:false,is_employee:false},user={id:'customer',email:'customer@test'},authHandler,roleError=null,hold=null,loads=0;
const ctx={document,console,isAdmin:false,_storeIsOpen:true,setInterval(){},clearInterval(){},setTimeout(){},db:{auth:{async getUser(){return {data:{user}};},onAuthStateChange(fn){authHandler=fn;return {}; }},from(){return {select(){return this;},eq(){return this;},single(){return hold?new Promise(r=>hold.resolve=r):Promise.resolve({data:role,error:roleError});}};}}};ctx.window=ctx;vm.createContext(ctx);vm.runInContext(fs.readFileSync('admin-command-center.js','utf8'),ctx);if(!document.getElementById('acc-tab'))ctx.buildCommandCenterUI();vm.runInContext(fs.readFileSync('checkadminbadge-override.js','utf8'),ctx);ctx.loadScriptsSequentially=()=>loads++;
(async()=>{
ctx.ccSetAccess(false);assert.equal(document.getElementById('acc-tab').style.display,'none');ctx.ccSlideOpen();assert.equal(ctx._ccOpen,false);
await ctx.checkAdminBadge();assert.equal(ctx._ccAccessGranted,false);assert.equal(loads,0);
user=null;await ctx.checkAdminBadge();assert.equal(ctx._ccAccessGranted,false);
user={id:'staff',email:'staff@test'};role={is_admin:false,is_employee:true};await ctx.checkAdminBadge();assert.equal(ctx._ccAccessGranted,false);assert.equal(loads,1,'staff modules still load');
user={id:'admin',email:'admin@test'};role={is_admin:true,is_employee:false};await ctx.checkAdminBadge();assert.equal(ctx._ccAccessGranted,true);ctx.ccSlideOpen();assert.equal(ctx._ccOpen,true);assert.equal(document.getElementById('acc-tab').style.display,'flex');
let hit=0;ctx.registerAdminTool('Daily Operations',{title:'test',onClick(){hit++;}});ctx.renderCommandCenter();const ref=ctx._ccCallbacks.length-1;authHandler('SIGNED_OUT');assert.equal(ctx._ccOpen,false);assert.equal(document.getElementById('acc-sheet').style.display,'none');assert.equal(document.getElementById('acc-body').innerHTML,'');ctx.ccInvoke({getAttribute(){return String(ref);}});assert.equal(hit,0);
roleError={message:'denied'};await ctx.checkAdminBadge();assert.equal(ctx._ccAccessGranted,false);roleError=null;
hold={};const pending=ctx.checkAdminBadge();await new Promise(r=>setImmediate(r));authHandler('SIGNED_OUT');hold.resolve({data:{is_admin:true,is_employee:false}});await pending;assert.equal(ctx._ccAccessGranted,false,'late role response cannot reopen after logout');
const html=fs.readFileSync('store.html','utf8');const store=parseHTML(html).document;assert.equal(store.getElementById('admin-fab-pill').style.display,'none');
console.log('PASS: default hidden, customer/guest/staff denied, admin allowed, logout clears content, stale callbacks blocked, role errors denied, late response rejected, initial HTML hidden.');
})().catch(e=>{console.error(e);process.exit(1);});


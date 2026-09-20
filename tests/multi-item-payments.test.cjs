const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {parseHTML}=require('../.production-test-runtime/node_modules/linkedom');
const {document}=parseHTML('<html><body></body></html>').window;
const source=fs.readFileSync('table-service-patch.js','utf8');
let row,updates=0,casConflict=false,fail=false,cash=[];
const copy=x=>JSON.parse(JSON.stringify(x));
const db={from(table){
  if(table==='cash_counter_entries')return {insert:async data=>{cash.push(...data);return {error:null};}};
  let patch,filters=[],jsonFilters=[];
  const q={select(fields){assert.ok(!fields.includes('collected_amount'),'must not require missing collected_amount column');return q;},filter(k,op,v){jsonFilters.push([k,v]);return q;},eq(k,v){filters.push([k,v]);return q;},is(k,v){filters.push([k,v]);return q;},single:async()=>({data:copy(row)}),update(v){patch=v;return q;},then(resolve,reject){return Promise.resolve().then(()=>{
    if(fail)return {error:{message:'Offline'}};
    if(casConflict||jsonFilters.some(([k,v])=>JSON.stringify(row[k])!==v)||filters.some(([k,v])=>row[k]!==v))return {data:[]};
    Object.assign(row,patch);updates++;return {data:[{id:row.id}]};
  }).then(resolve,reject);}};return q;
}};
let messages=[];
const ctx={document,db,SP_METHOD_META:{cash:{label:'Cash'},upi:{label:'UPI'},card:{label:'Card'}},showStoreToast:m=>messages.push(m),kitchenManualRefresh(){},sendTableBillWhatsApp:async()=>{}};
ctx.tsCollectedAmount=items=>Math.round(items.reduce((sum,i)=>sum+(i.complimentary?0:(i.paidQty||0)*i.price),0)*100)/100;
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('var _icOrderId = null;'),source.indexOf('// Kitchen Order History')),ctx);
function reset(){row={id:'test',table_code:'T1',status:'pending',payment_status:'pending',total:194,collected_amount:75,payment_split:{cash:75},items:[{name:'Instant Coffee',qty:2,price:30,paidQty:1},{name:'Espresso',qty:1,price:45,paidQty:1},{name:'Cold Coffee',qty:1,price:89}]};cash=[];updates=0;messages=[];casConflict=false;fail=false;}
(async()=>{
 reset();await ctx.openItemCollectPicker('test',0);
 assert.equal(ctx.icAmount(),30);assert.equal(document.querySelector('#ic-qty'),null);assert.match(document.getElementById('ic-items').textContent,/Cold Coffee/);ctx.icStepQty(2,1);assert.equal(ctx.icAmount(),119);
 assert.match(document.getElementById('ic-after').textContent,/0.00/);
 ctx.icSelectMethod('upi');assert.equal(updates,0,'method selection does not submit');
 assert.match(document.getElementById('ic-method-body').textContent,/Confirm collected/);
 await ctx.icFinalize('upi',null,null);assert.equal(updates,1);assert.equal(ctx.tsCollectedAmount(JSON.parse(row.items)),194);assert.equal(row.status,'collected');assert.equal(JSON.parse(row.items)[0].paidQty,2);assert.equal(JSON.parse(row.items)[2].paidQty,1);
 reset();row.items[2].qty=3;row.total=372;await ctx.openItemCollectPicker('test',0);ctx.icStepQty(2,1);
 assert.equal(ctx.icAmount(),119);await ctx.icFinalize('card',null,null);assert.equal(row.status,'pending');assert.equal(JSON.parse(row.items)[2].paidQty,1);assert.equal(ctx.tsCollectedAmount(JSON.parse(row.items)),194);
 reset();await ctx.openItemCollectPicker('test',0);ctx.icStepQty(0,-1);await ctx.icFinalize('upi',null,null);assert.equal(updates,0);
 ctx.icStepQty(0,1);ctx.icSelectMethod('cash');document.getElementById('ic-cash-received').value='20';await ctx.icConfirmCash();assert.equal(updates,0);
 document.getElementById('ic-cash-received').value='50';await Promise.all([ctx.icConfirmCash(),ctx.icConfirmCash()]);assert.equal(updates,1);assert.equal(cash.length,1);assert.equal(cash[0].amount,30);
 reset();await ctx.openItemCollectPicker('test',0);row.items[0].paidQty=2;await ctx.icFinalize('upi',null,null);assert.equal(updates,0);assert.match(messages.at(-1),/changed/);
 reset();await ctx.openItemCollectPicker('test',0);casConflict=true;await ctx.icFinalize('upi',null,null);assert.equal(updates,0);assert.match(messages.at(-1),/not saved/);
 reset();row.items[0].name='<img src=x onerror=alert(1)>';row.items=JSON.stringify(row.items);await ctx.openItemCollectPicker('test',0);assert.equal(document.querySelector('#ic-items img'),null);fail=true;await ctx.icFinalize('upi',null,null);assert.equal(updates,0);assert.equal(ctx._icBusy,false);
 console.log('PASS: multi-item totals, partial quantities, final closure, cash validation, duplicate clicks, stale balance, save conflict, failure, legacy JSON, escaped names.');
})().catch(e=>{console.error(e);process.exitCode=1;});

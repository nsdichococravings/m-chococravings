const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const {parseHTML}=require('../.production-test-runtime/node_modules/linkedom');
const {window}=parseHTML('<html><body></body></html>');
window.HTMLElement.prototype.showModal=function(){this.open=true;};
window.HTMLElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
let calls=[],resolvePayment,refreshes=0;
const order={id:randomUUID(),table_code:'T2',total:90,paid_amount:30,paid_item_quantities:{0:1},status:'pending',payment_status:'pending',items:[{name:'Coffee',price:30,qty:3}]};
const ctx={window,document:window.document,crypto:{randomUUID},console,showStoreToast(){},async kitchenManualRefresh(){refreshes++;},
 db:{from(){return {select(){return this;},eq(){return this;},async single(){return {data:order};}};},rpc(name,args){calls.push({name,args});return new Promise(r=>{resolvePayment=r;});}}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('table-item-payments.js','utf8'),ctx);
(async()=>{
 assert.match(ctx.tableItemPaymentControl(order,order.items[0],0),/Paid 1\/3/);
 assert.match(ctx.tablePaymentSummary(order),/Balance due ₹60.00/);
 await ctx.openTableItemPayment(order.id,0);
 const form=window.document.querySelector('form');assert.match(form.textContent,/2 unpaid/);
 const qty=form.querySelector('[name=quantity]');qty.value='2';qty.dispatchEvent(new window.Event('input'));
 assert.match(form.querySelector('[data-amount]').textContent,/₹60.00/);
 form.querySelector('[name=method] option[value="cash"]').selected=true;
 form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));
 assert.equal(calls.length,1);assert.equal(calls[0].args.p_payload.quantity,2);
 assert.equal(calls[0].args.p_payload.split.cash,60);
 resolvePayment({data:{closed:true,balance:0}});await new Promise(r=>setImmediate(r));
 assert.equal(window.document.getElementById('tip-dialog'),null);assert.equal(refreshes,1);
 order.paid_item_quantities={0:3};assert.doesNotMatch(ctx.tableItemPaymentControl(order,order.items[0],0),/>Collect</);
 console.log('PASS: paid quantity display, remaining balance, calculated collection, duplicate-submit guard, final close refresh.');
})().catch(e=>{console.error(e);process.exitCode=1;});

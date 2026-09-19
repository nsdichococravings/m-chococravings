const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('store-patch.js','utf8');
let handler,refreshes=0,subscriptions=0,active=true,removed=0;
const context={kitchenCh:null,document:{hidden:false,getElementById(id){
  if(id==='pg-kitchen')return {classList:{contains:()=>active}};
  if(id==='kt-deleted')return {remove(){removed++;}};
  return null;
}},kitchenSilentRefresh(){refreshes++;},kitchenLoad(){throw Error('must not reload auth or recreate subscription');},
db:{channel(){subscriptions++;return {on(event,filter,fn){handler=fn;return this;},subscribe(){return this;}};},removeChannel(){}}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function subscribeKitchen()')),context);
context.subscribeKitchen();
handler({new:{id:'new-order'}});assert.equal(refreshes,1);assert.equal(subscriptions,1);
context.document.hidden=true;handler({new:{id:'new-order'}});assert.equal(refreshes,1);
context.document.hidden=false;active=false;handler({new:{id:'new-order'}});assert.equal(refreshes,1);
active=true;handler({eventType:'DELETE',old:{id:'deleted'},new:{}});assert.equal(removed,1);
handler({new:{}});assert.equal(refreshes,1);
console.log('Kitchen realtime tests passed');

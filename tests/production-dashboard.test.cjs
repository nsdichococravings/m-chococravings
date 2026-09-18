const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseHTML } = require('../.production-test-runtime/node_modules/linkedom');
const source = fs.readFileSync(path.join(__dirname, '../production-dashboard.js'), 'utf8');
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(authorized = true) {
  const { window } = parseHTML('<html><body><button id="kitchen-fab">Kitchen</button><section id="pg-kitchen"></section></body></html>');
  window.HTMLElement.prototype.focus = function () {};
  window.HTMLElement.prototype.showModal = function () { this.open = true; };
  window.HTMLElement.prototype.close = function () { this.open = false; };
  const calls = [], reads = [], tools = [];
  const data = {
    inventory_items: [{ id:'i',name:'<img src=x onerror=alert(1)>',unit:'kg',current_stock:2,cost_per_unit:50,low_stock_threshold:3 }],
    packaging_materials: [{id:'p',name:'Sleeve',unit:'pcs',current_stock:20,cost_per_unit:1,category:'Brownie'}],
    material_purchases: [], store_menu: [{ id:'m',name:'Brownie',category:'Brownie' }],
    display_stock: [{id:'d',item_name:'Brownie',current_stock:10,low_stock_threshold:5}],
    cc_production_requests: [{id:'r',product_name:'Brownie',quantity:20,status:'approved',outlet_name:'Main outlet'}],
    cc_production_recipes: [{id:'recipe',product_name:'Brownie',yield_qty:20,yield_kg:1,created_at:'2026-09-18',ingredients:[],packaging:[]}],
    cc_production_batches: [{id:'b',product_name:'Brownie',outlet_name:'Main outlet',status:'completed',planned_qty:20,planned_kg:1,actual_qty:20,collected_qty:0,total_cost:400,material_cost:300,packaging_cost:20,labor_cost:40,overhead_cost:40,unit_cost:20,completed_at:'2026-09-18'}],
    store_orders: [{id:'o',status:'collected',payment_status:'paid',items:[{name:'Brownie',qty:5,price:40}]}]
  };
  window.db = {
    auth: { getUser: async () => ({data:{user:{id:'admin'}}}) },
    from(name) { reads.push(name); return { select(){return this;}, order(){return this;}, gte(){return this;}, eq(){return this;}, limit(){return this;}, async range(a,b){return {data:(data[name]||[]).slice(a,b+1),error:null};} }; },
    async rpc(name,args) {
      if(name==='cc_production_access') return authorized ? {data:true,error:null} : {data:null,error:{message:'Migration not installed'}};
      calls.push({name,args});
      if(args.p_action==='collect') {data.cc_production_batches[0].collected_qty+=Number(args.p_payload.quantity);data.display_stock[0].current_stock+=Number(args.p_payload.quantity);}
      return {data:{id:'saved'},error:null};
    },
    channel(){return {on(){return this;},subscribe(){return this;}}}
  };
  window.registerAdminTool = (category, tool) => tools.push(tool);
  const context = {window,document:window.document,navigator:{onLine:true},crypto:{randomUUID},console,setTimeout,clearTimeout,URL,Blob,Intl,Date,Map,
    FormData: class {constructor(form){this.pairs=[...form.querySelectorAll('input,select')].map(e=>[e.name,e.value]);} [Symbol.iterator](){return this.pairs[Symbol.iterator]();}}
  };
  vm.runInNewContext(source,context);
  return {window,document:window.document,calls,reads,tools,data};
}

(async () => {
  const env=setup();
  assert.equal(env.tools[0].title,'Production Dashboard');
  await env.window.openProductionDashboard();
  const root=env.document.getElementById('production-workspace');
  assert.equal(root.hidden,false);
  assert.match(root.textContent,/20 pcs/);
  assert.equal(env.reads.includes('store_orders'),false,'dashboard must not load sales history');
  assert.equal(env.reads.includes('material_purchases'),false,'dashboard must not load purchase history');
  assert.equal(root.querySelector('img'),null,'database labels must be escaped');
  const click=async selector=>{root.querySelector(selector).dispatchEvent(new env.window.Event('click',{bubbles:true}));await tick();};
  await click('[data-tab="Materials"]');
  assert.match(root.textContent,/Raw materials/); assert.match(root.textContent,/Sleeve/);
  await click('[data-tab="Production"]');
  await click('[data-action="collect"]');
  const dialog=root.querySelector('dialog');
  assert.equal(dialog.open,true);
  dialog.querySelector('[name=quantity]').value='8';
  const form=dialog.querySelector('form');
  form.dispatchEvent(new env.window.Event('submit',{bubbles:true,cancelable:true}));
  form.dispatchEvent(new env.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  assert.equal(env.calls.length,1,'double submit cannot post twice');
  assert.equal(env.calls[0].args.p_action,'collect');
  assert.match(env.calls[0].args.p_key,/^[0-9a-f-]{36}$/);
  assert.equal(env.data.display_stock[0].current_stock,18);
  assert.equal(dialog.open,false);
  await click('[data-tab="Profit report"]');
  assert.equal(env.reads.includes('store_orders'),true,'sales history loads on report demand');
  assert.match(root.textContent,/₹200/);
  assert.match(root.textContent,/Cost allocation unavailable/);
  assert.match(root.textContent,/₹20/);
  await click('[data-action="close"]');assert.equal(root.hidden,true);
  const missing=setup(false);await missing.window.openProductionDashboard();
  assert.equal(missing.reads.length,0,'no production reads before authorization');
  assert.match(missing.document.getElementById('production-workspace').textContent,/Migration not installed/);
  const login=setup();await login.window.initializeProductionAccess();
  assert.equal(login.reads.length,0,'login must not load production datasets');
  console.log('PASS: dashboard navigation, escaped labels, collection form, duplicate-submit prevention, refreshed stock, honest profit state and migration/access blocking.');
})().catch(error=>{console.error(error);process.exitCode=1;});

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
  const calls = [], reads = [], tools = [], intervals = [];
  const data = {
    cc_recipe_delete_requests: [],
    inventory_items: [{ id:'i',name:'<img src=x onerror=alert(1)>',unit:'kg',current_stock:2,cost_per_unit:50,low_stock_threshold:3 }],
    packaging_materials: [{id:'p',name:'Sleeve',unit:'pcs',current_stock:20,cost_per_unit:1,category:'Brownie'}],
    material_purchases: [], store_menu: [{ id:'m',name:'Brownie',category:'Brownie' }],
    display_stock: [{id:'d',item_name:'Brownie',current_stock:10,low_stock_threshold:5}],
    cc_production_requests: [{id:'r',product_name:'Brownie',quantity:20,status:'approved',outlet_name:'Main outlet',approved_by:'admin',approved_at:'2026-09-18'}],
    cc_production_recipes: [{id:'recipe',product_name:'Brownie',yield_qty:20,yield_kg:1,created_at:'2026-09-18',ingredients:[],packaging:[]}],
    cc_production_batches: [{id:'b',product_name:'Brownie',outlet_name:'Main outlet',status:'completed',planned_qty:20,planned_kg:1,actual_qty:20,collected_qty:0,total_cost:400,material_cost:300,packaging_cost:20,labor_cost:40,overhead_cost:40,unit_cost:20,completed_at:'2026-09-18'}],
    store_orders: [{id:'o',status:'collected',payment_status:'paid',created_at:'2026-09-19',items:[{name:'Brownie',qty:5,price:40}]}]
  };
  window.db = {
    auth: { getUser: async () => ({data:{user:{id:'admin'}}}) },
    from(name) { reads.push(name); return { select(){return this;}, order(){return this;}, gte(){return this;}, eq(){return this;}, limit(){return this;}, async range(a,b){return {data:(data[name]||[]).slice(a,b+1),error:null};} }; },
    async rpc(name,args) {
      if(name==='cc_production_role') return {data:'admin'};
      if(name==='cc_recipe_delete') { calls.push({name,args}); return {data:null}; }
      if(name==='cc_production_access') return authorized ? {data:true,error:null} : {data:null,error:{message:'Migration not installed'}};
      if(name==='cc_production_approver_names') return {data:[{user_id:'admin',display_name:'Sales Manager'}]};
      if(name==='cc_production_add_material') {data.inventory_items.push({id:'new',name:args.p_payload.name,unit:args.p_payload.unit,current_stock:0});return {data:args.p_payload};}
      calls.push({name,args});
      if(args.p_action==='collect') {data.cc_production_batches[0].collected_qty+=Number(args.p_payload.quantity);data.display_stock[0].current_stock+=Number(args.p_payload.quantity);}
      return {data:{id:'saved'},error:null};
    },
    channel(){return {on(){return this;},subscribe(){return this;}}}
  };
  window.registerAdminTool = (category, tool) => tools.push(tool);
  const context = {window,document:window.document,navigator:{onLine:true},crypto:{randomUUID},console,setTimeout,clearTimeout,setInterval:(fn,ms)=>{intervals.push(ms);return setInterval(fn,ms);},clearInterval,URL,Blob,Intl,Date,Map,
    FormData: class {constructor(form){this.pairs=[...form.querySelectorAll('input,select')].map(e=>[e.name,e.value]);} [Symbol.iterator](){return this.pairs[Symbol.iterator]();}}
  };
  vm.runInNewContext(source,context);
  return {window,document:window.document,calls,reads,tools,data,intervals};
}

(async () => {
  const env=setup();
  assert.equal(env.tools[0].title,'Production Dashboard');
  await env.window.openProductionDashboard();
  const root=env.document.getElementById('production-workspace');
  assert.equal(root.hidden,false);
  assert.ok(env.intervals.includes(10800000),'stock interval is three hours');
  assert.match(root.textContent,/every 3 hours/);
  assert.match(root.textContent,/20 pcs/);
  assert.equal(env.reads.includes('store_orders'),false,'dashboard must not load sales history');
  assert.equal(env.reads.includes('material_purchases'),false,'dashboard must not load purchase history');
  assert.equal(root.querySelector('img'),null,'database labels must be escaped');
  const click=async selector=>{root.querySelector(selector).dispatchEvent(new env.window.Event('click',{bubbles:true}));await tick();};
  const readsBeforeTabs=env.reads.length;
  await click('[data-tab="Outlet"]');
  await click('[data-tab="Dashboard"]');
  assert.equal(env.reads.length,readsBeforeTabs,'recent shared data should not be fetched again when switching tabs');
  await click('[data-action="refresh"]');
  assert.ok(env.reads.length>readsBeforeTabs,'manual Refresh must bypass the cache');
  await click('[data-tab="Materials"]');
  assert.match(root.textContent,/Raw materials/); assert.match(root.textContent,/Sleeve/);
  await click('[data-tab="Production"]');
  assert.match(root.textContent,/Sales Manager/);
  await click('[data-action="start"]');
  assert.equal(Number(root.querySelector('[name=planned_kg]').value),1,'recipe auto-scales planned kg');
  assert.match(root.querySelector('[name=recipe_id]').textContent,/Version 1/);
  await click('[data-action="cancel"]');
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
  assert.match(root.textContent,/Estimated gross profit/);
  assert.match(root.textContent,/Latest batch before sale/);
  assert.match(root.textContent,/₹100/);
  assert.match(root.textContent,/₹20/);
  await click('[data-tab="Recipes"]');
  env.data.cc_recipe_delete_requests=[{id:'del',recipe_id:'recipe',reason:'Duplicate',status:'pending'}];
  await click('[data-action="refresh"]');
  assert.match(root.textContent,/Pending admin approval/);
  assert.ok(root.querySelector('.pd-delete-pending'));
  assert.ok(root.querySelector('[data-action="approve-delete"]'));
  await click('[data-action="approve-delete"]');
  root.querySelector('dialog form').dispatchEvent(new env.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  assert.equal(env.calls.at(-1).name,'cc_recipe_delete');
  assert.equal(env.calls.at(-1).args.p_action,'approve');
  env.data.cc_recipe_delete_requests=[];
  await click('[data-action="refresh"]');
  await click('[data-action="recipe"]');
  const line=root.querySelector('.pd-ingredient');
  line.querySelector('[name=ingredient_name]').querySelector('option[value]').nextElementSibling.selected=true;
  line.querySelector('[name=ingredient_name]').dispatchEvent(new env.window.Event('change',{bubbles:true}));
  line.querySelector('[name=ingredient_unit]').querySelector('option[value="g"]').selected=true;
  line.querySelector('[name=ingredient_quantity]').value='170';
  root.querySelector('dialog form').dispatchEvent(new env.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  const recipeCall=env.calls.find(c=>c.args.p_action==='recipe');
  assert.equal(recipeCall.args.p_payload.ingredients[0].quantity,0.17,'170g must store as 0.17kg');
  assert.equal(recipeCall.args.p_payload.ingredients[0].display_unit,'g');
  const existingRecipe = env.data.cc_production_recipes[0];
  existingRecipe.ingredients = [{name:env.data.inventory_items[0].name,quantity:170,unit:'kg'}];
  existingRecipe.packaging = [{name:'Sleeve',quantity:20,unit:'pcs'}];
  const originalRecipe = JSON.stringify(existingRecipe);
  await click('[data-tab="Recipes"]');
  await click('[data-action="edit-recipe"]');
  assert.equal(root.querySelector('[data-action="edit-recipe"]').closest('td').cellIndex === 0 || root.querySelector('[data-action="edit-recipe"]').closest('td').previousElementSibling === null,true,'edit must be in the first column');
  assert.match(root.querySelector('dialog').textContent,/Edit recipe: Brownie/);
  assert.equal(root.querySelector('[name=yield_qty]').value,'20');
  assert.equal(root.querySelector('[name=yield_kg]').value,'1');
  assert.equal(root.querySelector('[name=product_name]').disabled,true);
  const editLines=root.querySelectorAll('.pd-ingredient');
  assert.equal(editLines.length,2,'edit must preserve ingredient and packaging lines');
  assert.equal(editLines[0].querySelector('[name=ingredient_quantity]').value,'170');
  assert.equal(editLines[0].querySelector('[name=ingredient_unit]').value,'kg','do not silently reinterpret old quantities');
  editLines[0].querySelector('[name=ingredient_unit] option[value="g"]').selected=true;
  root.querySelector('dialog form').dispatchEvent(new env.window.Event('submit',{bubbles:true,cancelable:true}));
  await tick();await tick();
  const editedCall=env.calls.filter(c=>c.args.p_action==='recipe').at(-1);
  assert.equal(editedCall.args.p_payload.ingredients[0].quantity,0.17);
  assert.equal(editedCall.args.p_payload.packaging[0].quantity,20);
  assert.equal(editedCall.args.p_payload.product_name,'Brownie');
  assert.equal(JSON.stringify(existingRecipe),originalRecipe,'save must not mutate the old recipe version');
  await click('[data-action="edit-recipe"]');
  const callsBeforeCancel=env.calls.length;
  await click('[data-action="cancel"]');
  assert.equal(env.calls.length,callsBeforeCancel,'cancel must not save a recipe');
  env.data.cc_production_recipes=[];
  await click('[data-tab="Production"]');await click('[data-action="start"]');
  assert.match(root.querySelector('dialog').textContent,/No production recipe/);
  assert.equal(root.querySelector('dialog [type=submit]'),null,'no baking action without recipe');
  await click('[data-action="create-missing-recipe"]');
  assert.match(root.querySelector('dialog').textContent,/Add approved recipe/);
  await click('[data-action="new-material"]');
  root.querySelector('[name=new_name]').value='New flour';
  root.querySelector('[name=new_kind] option[value="raw"]').selected=true;
  root.querySelector('[name=new_unit] option').selected=true;
  await click('[data-action="save-material"]');
  assert.match(root.querySelector('[name=ingredient_name]').textContent,/New flour/);
  await click('[data-action="cancel"]');
  await click('[data-action="close"]');assert.equal(root.hidden,true);
  const missing=setup(false);await missing.window.openProductionDashboard();
  assert.equal(missing.reads.length,0,'no production reads before authorization');
  assert.match(missing.document.getElementById('production-workspace').textContent,/Migration not installed/);
  const login=setup();await login.window.initializeProductionAccess();
  assert.equal(login.reads.filter(name=>name!=='cc_production_movements').length,0,'login must not load bulk production datasets');
  const delayed=setup();
  const realRpc=delayed.window.db.rpc;
  let resolveNames;
  delayed.window.db.rpc=(name,args)=>name==='cc_production_approver_names' ? new Promise(resolve=>{resolveNames=resolve;}) : realRpc(name,args);
  await delayed.window.openProductionDashboard();
  assert.match(delayed.document.querySelector('#production-workspace main').textContent,/Production requests/,'main data renders without waiting for approval names');
  resolveNames({data:[{user_id:'admin',display_name:'Sales Manager'}]});await tick();
  assert.match(delayed.document.querySelector('#production-workspace main').textContent,/Sales Manager/);
  console.log('PASS: dashboard navigation, escaped labels, collection form, duplicate-submit prevention, refreshed stock, honest profit state and migration/access blocking.');
})().catch(error=>{console.error(error);process.exitCode=1;});

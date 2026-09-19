/* Run: node tests/production-database.test.cjs (see PRODUCTION-INTEGRATION.md). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const admin = randomUUID(), sales = randomUUID(), production = randomUUID(), stranger = randomUUID();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id uuid primary key default gen_random_uuid(),email text,is_admin boolean);
    create table public.store_menu(id uuid primary key default gen_random_uuid(),name text unique,category text,price numeric);
    create table public.store_orders(id uuid primary key default gen_random_uuid(),item_name text,quantity integer,status text);
    create function public.existing_order_stock() returns trigger language plpgsql security definer as $$
    begin
      if TG_OP='INSERT' then update public.display_stock set current_stock=current_stock-new.quantity where item_name=new.item_name;
      elsif new.status='cancelled' and old.status<>'cancelled' then update public.display_stock set current_stock=current_stock+old.quantity where item_name=old.item_name;
      end if;
      return new;
    end $$;
    create trigger legacy_order_stock after insert or update on public.store_orders for each row execute function public.existing_order_stock();
    insert into auth.users values ('${admin}','owner@example.test',now()),('${sales}','sales@example.test',now()),('${production}','baker@example.test',now()),('${stranger}','visitor@example.test',now());
    insert into customers(email,is_admin) values('owner@example.test',true);
    insert into store_menu(name,category,price) values('Brownie','Brownies',40);
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20260918_production_workspace.sql'), 'utf8'));
  await db.exec("alter table auth.users add column raw_user_meta_data jsonb default '{}';");
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20260918_production_fixes.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20260918_production_fixes.sql'), 'utf8'));
  await db.query('insert into cc_production_members(user_id,role) values($1,$2),($3,$4)', [sales,'sales',production,'production']);
  async function actor(id) { await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]); }
  async function command(action, payload, key = randomUUID()) {
    return (await db.query('select cc_production_command($1,$2::jsonb,$3) result',[action,JSON.stringify(payload),key])).rows[0].result;
  }
  async function scalar(sql) { return Object.values((await db.query(sql)).rows[0])[0]; }
  async function rejects(fn, pattern) { await assert.rejects(fn,pattern); }
  await actor(stranger);
  assert.equal(await scalar('select cc_production_access()'),false);
  await rejects(()=>command('purchase',{}),/access denied/);
  await actor(admin);
  assert.equal(await scalar('select cc_production_access()'),true);
  const materialKey=randomUUID();
  await db.query('select cc_production_add_material($1::jsonb,$2)',[JSON.stringify({name:'New flour',unit:'g',kind:'raw'}),materialKey]);
  await db.query('select cc_production_add_material($1::jsonb,$2)',[JSON.stringify({name:'New flour',unit:'g',kind:'raw'}),materialKey]);
  assert.equal(Number(await scalar("select count(*) from inventory_items where name='New flour'")),1);
  assert.equal(Number(await scalar("select current_stock from inventory_items where name='New flour'")),0);
  const receipt = {kind:'raw',name:'Chocolate',unit:'kg',category:'Baking',quantity:10,total_cost:5000,purchase_date:'2026-01-01'};
  const receiptKey = randomUUID();
  await command('purchase',receipt,receiptKey);
  await command('purchase',receipt,receiptKey);
  assert.equal(Number(await scalar("select current_stock from inventory_items where name='Chocolate'")),10,'receipt retry must not duplicate stock');
  await rejects(()=>command('purchase',{...receipt,quantity:20},receiptKey),/different input/);
  await command('purchase',{...receipt,quantity:10,total_cost:7000});
  assert.equal(Number(await scalar("select cost_per_unit from inventory_items where name='Chocolate'")),600,'weighted receipt cost');
  await rejects(()=>command('purchase',{...receipt,unit:'g'}),/existing material unit/);
  await command('purchase',{kind:'packaging',name:'Sleeve',unit:'pcs',category:'Brownies',quantity:100,total_cost:100,purchase_date:'2026-01-01'});
  const recipe = (await command('recipe',{product_name:'Brownie',yield_qty:20,yield_kg:1,ingredients:[{name:'Chocolate',unit:'kg',quantity:0.4}],packaging:[{name:'Sleeve',unit:'pcs',quantity:20}]})).id;
  await rejects(()=>command('recipe',{product_name:'Brownie',yield_qty:20,yield_kg:1,ingredients:[],packaging:[]}),/At least one ingredient/);
  const req = (await command('request',{product_name:'Brownie',quantity:100,due_date:'2026-09-18'})).id;
  await rejects(()=>command('start',{id:req,recipe_id:recipe,planned_qty:100,planned_kg:5}),/must be approved/);
  await actor(production);
  await rejects(()=>command('approve',{id:req}),/sales-authorized/);
  await actor(sales); await command('approve',{id:req});
  await db.query("update auth.users set raw_user_meta_data=$1::jsonb where id=$2",[JSON.stringify({full_name:'Sales Manager'}),sales]);
  assert.equal((await db.query('select * from cc_production_approver_names($1::uuid[])',[[sales]])).rows[0].display_name,'Sales Manager');
  await rejects(()=>command('start',{id:req,recipe_id:recipe,planned_qty:100,planned_kg:5}),/production-authorized/);
  await actor(production);
  await rejects(()=>command('start',{id:req,recipe_id:recipe,planned_qty:100,planned_kg:4}),/recipe-scaled/);
  const startPayload={id:req,recipe_id:recipe,planned_qty:100,planned_kg:5}, startKey=randomUUID();
  const batch = (await command('start',startPayload,startKey)).id;
  assert.equal((await command('start',startPayload,startKey)).id,batch);
  assert.equal(Number(await scalar("select current_stock from inventory_items where name='Chocolate'")),18);
  assert.equal(Number(await scalar('select count(*) from display_stock')),0,'baking must not add outlet stock');
  await rejects(()=>command('start',startPayload),/must be approved/);
  const complete={id:batch,actual_qty:92,actual_kg:4.6,labor_cost:200,overhead_cost:200};
  const completeKey=randomUUID(); await command('complete',complete,completeKey); await command('complete',complete,completeKey);
  assert.equal(Number(await scalar("select current_stock from packaging_materials where name='Sleeve'")),8);
  assert.equal(Number(await scalar('select total_cost from cc_production_batches')),1692);
  assert.equal(Number(await scalar('select count(*) from display_stock')),0,'completion must not add outlet stock');
  await actor(sales);
  const collectKey=randomUUID(); await command('collect',{id:batch,quantity:60,collected_by:'Sales Manager'},collectKey); await command('collect',{id:batch,quantity:60,collected_by:'Sales Manager'},collectKey);
  assert.equal(Number(await scalar("select current_stock from display_stock where item_name='Brownie'")),60);
  assert.equal(Number(await scalar('select collected_qty from cc_production_batches')),60);
  await rejects(()=>command('collect',{id:batch,quantity:33,collected_by:'Sales Manager'}),/exceeds available/);
  await command('collect',{id:batch,quantity:32,collected_by:'Sales Manager'});
  assert.equal(await scalar('select status from cc_production_requests'), 'partial','short yield must not mark original request fulfilled');
  assert.equal(Number(await scalar("select sum(quantity) from cc_production_movements where kind in ('collection_in','collection_out')")),0,'transfer quantities balance');
  await db.exec("insert into store_orders(item_name,quantity,status) values('Brownie',5,'pending')");
  assert.equal(Number(await scalar("select current_stock from display_stock where item_name='Brownie'")),87,'existing order trigger remains the only deduction');
  await db.exec("update store_orders set status='cancelled'");
  assert.equal(Number(await scalar("select current_stock from display_stock where item_name='Brownie'")),92,'existing cancellation restore is preserved');
  await actor(admin); await command('purchase',{...receipt,quantity:10,total_cost:9000});
  assert.equal(Number(await scalar('select total_cost from cc_production_batches')),1692,'later prices cannot rewrite batch cost');

  // A later material failing must roll back earlier deductions within the same batch.
  await command('purchase',{...receipt,name:'Flour',quantity:1,total_cost:50});
  const badRecipe=(await command('recipe',{product_name:'Brownie',yield_qty:10,yield_kg:1,ingredients:[{name:'Chocolate',unit:'kg',quantity:1},{name:'Flour',unit:'kg',quantity:2}],packaging:[]})).id;
  const req2=(await command('request',{product_name:'Brownie',quantity:10,due_date:'2026-09-18'})).id; await command('approve',{id:req2});
  const before=Number(await scalar("select current_stock from inventory_items where name='Chocolate'"));
  await rejects(()=>command('start',{id:req2,recipe_id:badRecipe,planned_qty:10,planned_kg:1}),/Insufficient/);
  assert.equal(Number(await scalar("select current_stock from inventory_items where name='Chocolate'")),before,'failed batch rolls back every material issue');
  assert.equal(await scalar(`select status from cc_production_requests where id='${req2}'`),'approved');
  const deletionMigration=fs.readFileSync(path.join(__dirname,'../migrations/20260920_approvals.sql'),'utf8');
  await db.exec(deletionMigration); await db.exec(deletionMigration);
  async function deletion(action,id,reason='Old version') { return db.query('select cc_recipe_delete($1,$2,$3)',[action,id,reason]); }
  await actor(production);
  await deletion('request',recipe); await deletion('request',recipe);
  assert.equal(Number(await scalar('select count(*) from cc_recipe_delete_requests')),1);
  assert.equal(await scalar('select deleted_at from cc_production_recipes where id=\''+recipe+'\''),null);
  const deleteId=await scalar('select id from cc_recipe_delete_requests');
  await rejects(()=>deletion('approve',deleteId),/Only an admin/);
  await actor(admin); await deletion('reject',deleteId);
  await deletion('request',recipe);
  const pendingId=await scalar("select id from cc_recipe_delete_requests where status='pending'");
  await deletion('approve',pendingId); await deletion('approve',pendingId);
  assert.ok(await scalar('select deleted_at from cc_production_recipes where id=\''+recipe+'\''));
  assert.equal(Number(await scalar('select total_cost from cc_production_batches')),1692,'deletion preserves batch costs');
  const deleteStock=await scalar("select current_stock from inventory_items where name='Chocolate'");
  await rejects(()=>command('start',{id:req2,recipe_id:recipe,planned_qty:10,planned_kg:0.5}),/deleted/);
  assert.equal(await scalar("select current_stock from inventory_items where name='Chocolate'"),deleteStock,'deleted recipe start rolls back stock');
  const costPayload={product_name:'Brownie',effective_from:'2026-09-01',effective_to:'2026-09-30',material_cost:10,packaging_cost:2,labor_cost:3,overhead_cost:1,reason:'Correct making cost'};
  async function costRequest(payload,key=randomUUID()) {return (await db.query('select cc_request_cost_correction($1::jsonb,$2) id',[JSON.stringify(payload),key])).rows[0].id;}
  async function costReview(id,approved) {return db.query('select cc_review_cost_correction($1,$2,$3)',[id,approved,'Reviewed']);}
  await actor(sales);
  const costKey=randomUUID(), costId=await costRequest(costPayload,costKey);
  assert.equal(await costRequest(costPayload,costKey),costId,'submission retry returns same request');
  await rejects(()=>costRequest({...costPayload,labor_cost:9},costKey),/different input/);
  assert.equal(Number(await scalar("select count(*) from cc_cost_corrections where status='approved'")),0,'submission does not apply costs');
  await rejects(()=>costReview(costId,true),/Only admin/);
  await rejects(()=>costRequest(costPayload),/already awaiting/);
  await actor(admin);await costReview(costId,true);await costReview(costId,true);
  assert.equal(await scalar("select status from cc_cost_corrections where id='"+costId+"'"),'approved');
  await rejects(()=>costReview(costId,false),/already reviewed/);
  const rejectedCost=await costRequest({...costPayload,material_cost:100});await costReview(rejectedCost,false);
  assert.equal(Number(await scalar("select count(*) from cc_cost_corrections where status='approved'")),1,'rejection leaves approved costs alone');
  await rejects(()=>costRequest({...costPayload,labor_cost:-1}),/check constraint/);
  await rejects(()=>costRequest({...costPayload,effective_to:'2026-08-01'}),/check constraint/);
  await actor(sales);
  const adminRequest=(await command('request',{product_name:'Brownie',quantity:1,due_date:'2026-09-30'})).id;
  await rejects(()=>command('approve',{id:adminRequest}),/Only admin/);
  await rejects(()=>db.query('select cc_review_sales_request($1,true)',[adminRequest]),/Only admin/);
  await actor(admin);await db.query('select cc_review_sales_request($1,true)',[adminRequest]);
  await db.exec('alter table customers add column is_super_user boolean default false');
  await db.query('insert into customers(email,is_admin,is_super_user) values($1,false,true)',['visitor@example.test']);
  await actor(stranger);
  assert.equal(await scalar('select cc_can_review_approvals()'),true,'super admin can review without is_admin flag');
  const superCost=await costRequest({...costPayload,material_cost:11});await costReview(superCost,true);
  await db.exec("update customers set is_super_user=false where email='visitor@example.test'");
  assert.equal(await scalar('select cc_can_review_approvals()'),false);
  await db.exec('grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; set role authenticated;');
  await rejects(()=>db.exec("update inventory_items set current_stock=999"),/permission denied/);
  await rejects(()=>db.exec("update cc_cost_corrections set status='approved'"),/permission denied/);
  await actor(stranger);
  assert.equal(Number(await scalar('select count(*) from cc_cost_corrections')),0,'outsider cannot read corrections');
  await actor(stranger);
  assert.equal(Number(await scalar('select count(*) from cc_production_batches')),0,'RLS hides production records from other customers');
  await actor(admin);
  assert.equal(Number(await scalar('select count(*) from cc_production_batches')),1);
  await db.exec('reset role');
  await db.close();
  console.log('PASS: migration, roles/RLS, purchase retries, costing, recipe validation, batch rollback, completion, partial collection, over-collection and historical cost preservation.');
})().catch(error=>{console.error(error);process.exitCode=1;});

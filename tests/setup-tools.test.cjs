const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const OWNER='11111111-1111-1111-1111-111111111111',STAFF='22222222-2222-2222-2222-222222222222',GUEST='33333333-3333-3333-3333-333333333333';
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
insert into auth.users values('${OWNER}','owner@x',now()),('${STAFF}','staff@x',now()),('${GUEST}','guest@x',now());
create table auth.me(id uuid);insert into auth.me values('${OWNER}');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table customers(email text,is_super_user bool);insert into customers values('owner@x',true),('staff@x',false),('guest@x',false);
create function cc_loyalty_role() returns text language sql as $$select case (select email from auth.users where id=auth.uid()) when 'owner@x' then 'admin' when 'staff@x' then 'staff' else 'customer' end$$;
create function cc_production_role() returns text language sql as $$select case when cc_loyalty_role()='admin' then 'admin' else 'none' end$$;
create function cc_production_access() returns bool language sql as $$select cc_production_role()='admin'$$;
create function cc_prod_is_super() returns bool language sql as $$select cc_loyalty_role()='admin'$$;
create table cc_super_overrides(id uuid primary key default gen_random_uuid(),action text,target_id uuid,before jsonb,after jsonb,note text,actor uuid,created_at timestamptz default now());
create table store_menu(id serial primary key,name text,category text);
insert into store_menu(name,category) values('1/2kg Vanilla Cake in Fairy theme','Cakes'),('1KG Simple customisation Vanilla Cake','Cakes'),('Brownie','Bakes');
create table cc_production_recipes(id uuid primary key default gen_random_uuid(),product_name text,yield_qty integer,yield_kg numeric);
create table cc_production_requests(id uuid primary key default gen_random_uuid(),product_name text,quantity integer,status text default 'pending');
create function cc_guard() returns trigger language plpgsql as $$begin if coalesce(current_setting('cc.system_write',true),'')<>'on' and new.product_name<>old.product_name then raise exception 'guarded'; end if; return new; end$$;
create trigger g before update on cc_production_requests for each row execute function cc_guard();
create table cc_production_batches(id uuid primary key default gen_random_uuid(),product_name text,status text,actual_qty int,collected_qty int default 0,unit_cost numeric,completed_at timestamptz);
create table cc_making_costs(product_name text primary key,labor_cost numeric,overhead_cost numeric);
create table custom_bookings(id serial primary key,production_product text);
create table display_stock(id serial primary key,item_name text unique,current_stock numeric default 0,updated_at timestamptz);
insert into cc_production_recipes(product_name,yield_qty,yield_kg) values('1KG Simple customisation Vanilla Cake',1,1),('1/2kg vanilla cake',5,0.5);
insert into cc_production_requests(product_name,quantity) values('1KG Simple customisation Vanilla Cake',2),('1/2kg vanilla cake',5);
insert into cc_production_batches(product_name,status,actual_qty,unit_cost,completed_at) values('1/2kg vanilla cake','completed',5,180,now()),('Brownie','completed',10,22,now()-interval '2 day'),('Brownie','completed',10,25,now());
insert into cc_making_costs values('1KG Simple customisation Vanilla Cake',40,10);
insert into custom_bookings(production_product) values('1KG Simple customisation Vanilla Cake');
insert into display_stock(item_name,current_stock) values('1KG Simple customisation Vanilla Cake',2),('1/2kg vanilla cake',3),('1/2kg Vanilla Cake in Fairy theme',1),('Brownie',6);`);
const sql=fs.readFileSync('migrations/20260966_setup_tools.sql','utf8');await db.exec(sql);await db.exec(sql);
const one=async(q,p)=>(await db.query(q,p)).rows[0];

// 1. Menu rename follows into production (through the request guard).
await db.exec(`update store_menu set name='1KG Simple Customisation Vanilla Cake' where name='1KG Simple customisation Vanilla Cake'`);
const N='1KG Simple Customisation Vanilla Cake';
for (const [t,c] of [['cc_production_recipes','product_name'],['cc_production_requests','product_name'],['cc_making_costs','product_name'],['custom_bookings','production_product'],['display_stock','item_name']])
  assert.equal((await one(`select count(*)::int n from ${t} where ${c}=$1`,[N])).n,1,t);
assert.equal((await one(`select count(*)::int n from cc_production_requests where product_name like '1KG Simple customisation%'`)).n,0);

// 2. Relink a drifted name onto an existing menu item; outlet stock is merged.
const F='1/2kg Vanilla Cake in Fairy theme';
await db.query('select cc_super_relink_product($1,$2)',['1/2kg vanilla cake',F]);
assert.equal((await one('select count(*)::int n from cc_production_batches where product_name=$1',[F])).n,1);
assert.equal((await one('select count(*)::int n from cc_production_recipes where product_name=$1',[F])).n,1);
assert.equal(Number((await one('select current_stock from display_stock where item_name=$1',[F])).current_stock),4);
assert.equal((await one(`select count(*)::int n from display_stock where item_name='1/2kg vanilla cake'`)).n,0);
assert.equal((await one(`select count(*)::int n from cc_super_overrides where action='relink_product'`)).n,1);
await assert.rejects(db.query('select cc_super_relink_product($1,$2)',['Ghost','Not on menu']),/not found/);
await assert.rejects(db.query('select cc_super_relink_product($1,$2)',['Brownie',F]),/still on the menu/);

// 3. Wastage: takes stock off, logs latest batch cost, refuses more than on the counter.
await db.exec(`update auth.me set id='${STAFF}'`);
await assert.rejects(db.query('select cc_super_relink_product($1,$2)',['x',F]),/Only a super user/);
const w=(await one(`select cc_record_wastage('Brownie',2,'stale',null,'Chitra') r`)).r;
assert.equal(Number(w.left),4);assert.equal(Number(w.unit_cost),25);
const row=await one('select item_name,quantity,reason,recorded_by_name from cc_wastage');
assert.deepEqual(row,{item_name:'Brownie',quantity:2,reason:'stale',recorded_by_name:'Chitra'});
await assert.rejects(db.query(`select cc_record_wastage('Brownie',9,'damaged')`),/Only 4 on the counter/);
await assert.rejects(db.query(`select cc_record_wastage('Brownie',1,'lost')`),/Choose a reason/);
await assert.rejects(db.query(`select cc_record_wastage('Nope',1,'stale')`),/not on the outlet stock list/);
await db.exec(`update auth.me set id='${GUEST}'`);
await assert.rejects(db.query(`select cc_record_wastage('Brownie',1,'stale')`),/Staff access required/);
await db.close();console.log('PASS setup tools: menu rename follows into production, super-user relink with stock merge, wastage log with batch cost and checks.');
})().catch(e=>{console.error(e);process.exit(1);});

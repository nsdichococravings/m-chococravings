const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const ADMIN='11111111-1111-1111-1111-111111111111',STAFF='22222222-2222-2222-2222-222222222222';
(async()=>{
const db=new PGlite();
// Minimal copy of the live Production workspace schema (20260918*/20260920) + store tables.
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,created_at timestamptz default now());
insert into auth.users values('${ADMIN}','owner@x',now(),now()),('${STAFF}','staff@x',now(),now());
create table auth.me(id uuid);insert into auth.me values('${STAFF}');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table customers(id text primary key default gen_random_uuid()::text,email text,is_admin bool default false);
insert into customers(email,is_admin) values('owner@x',true),('staff@x',false);
create table store_menu(id uuid primary key default gen_random_uuid(),name text,category text,track_display_stock bool);
insert into store_menu(name,category,track_display_stock) values('Cold Coffee','Coffee',false),('Nutella Brownie','Brownies',true),('Vanilla Cake 1kg','Cakes',false),('Lemon Juice','Others',false);
create table inventory_items(id uuid primary key default gen_random_uuid(),name text unique,unit text,current_stock numeric default 0,cost_per_unit numeric,low_stock_threshold numeric default 0,updated_at timestamptz);
insert into inventory_items(name,unit,current_stock,low_stock_threshold) values('Milk','ml',1000,500),('Coffee powder','g',100,20),('Flour','kg',5,1),('Lemon','pcs',10,5);
create table packaging_materials(id uuid primary key default gen_random_uuid(),name text unique,category text,unit text,current_stock numeric default 0,cost_per_unit numeric,updated_at timestamptz);
insert into packaging_materials(name,unit,current_stock) values('Cup','pcs',50);
create table display_stock(id uuid primary key default gen_random_uuid(),item_name text unique,category text,current_stock numeric default 0,low_stock_threshold numeric default 5,updated_at timestamptz);
insert into display_stock(item_name,current_stock,low_stock_threshold) values('Nutella Brownie',12,5);
create table cc_production_members(user_id uuid primary key,role text,created_at timestamptz default now());
create function cc_production_role() returns text language sql as $$select case when auth.uid()='${ADMIN}' then 'admin' when auth.uid()='${STAFF}' then 'sales' end$$;
create function cc_can_review_approvals() returns bool language sql as $$select auth.uid()='${ADMIN}'$$;
create table cc_production_requests(id uuid primary key default gen_random_uuid(),product_name text not null,outlet_name text not null default 'Main outlet',quantity integer not null check(quantity>0),due_date date not null,
 status text not null default 'pending' check(status in ('pending','approved','baking','ready','partial','fulfilled','cancelled')),requested_by uuid not null references auth.users(id),approved_by uuid,created_at timestamptz default now(),approved_at timestamptz,reviewed_by uuid,reviewed_at timestamptz,review_note text);
create function cc_guard_sales_approval() returns trigger language plpgsql as $$begin if old.status='pending' and new.status in ('approved','cancelled') and not cc_can_review_approvals() then raise exception 'Only admin or super admin can approve or reject sales requests'; end if; return new; end$$;
create trigger cc_guard_sales_approval before update on cc_production_requests for each row execute function cc_guard_sales_approval();
create table cc_production_recipes(id uuid primary key default gen_random_uuid(),product_name text,yield_qty integer,yield_kg numeric,ingredients jsonb,packaging jsonb default '[]',approved_by uuid,created_at timestamptz default now(),deleted_at timestamptz);
create table cc_production_batches(id uuid primary key default gen_random_uuid(),request_id uuid);
insert into cc_production_recipes(product_name,yield_qty,yield_kg,ingredients,packaging,created_at) values
 ('Cold Coffee',1,0.25,'[{"name":"Milk","quantity":200,"unit":"ml"},{"name":"Coffee powder","quantity":10,"unit":"g"}]','[{"name":"Cup","quantity":1,"unit":"pcs"}]',now()-interval '1 day'),
 ('Cold Coffee',1,0.25,'[{"name":"Milk","quantity":250,"unit":"ml"},{"name":"Coffee powder","quantity":10,"unit":"g"}]','[{"name":"Cup","quantity":1,"unit":"pcs"}]',now()-interval '2 day'),
 ('Lemon Juice',2,0.5,'[{"name":"Lemon","quantity":3,"unit":"pcs"}]','[]',now()),
 ('Nutella Brownie',10,1,'[{"name":"Flour","quantity":1,"unit":"kg"}]','[]',now());
create table store_orders(id text primary key default gen_random_uuid()::text,items jsonb,status text default 'pending');
create table custom_bookings(id uuid primary key default gen_random_uuid(),customer_name text,booking_date date,cake_name_text text,status text default 'booked');`);
await db.exec(fs.readFileSync('migrations/20260956_auto_stock.sql','utf8'));
// Legacy units from the old Inventory screen + a recipe using them + oversold stock.
await db.exec(`insert into inventory_items(name,unit,current_stock,cost_per_unit,low_stock_threshold) values('Fresh cream','liter',2,220,1),('Eggs','dozen',3,60,1),('Sugar','kg',-1,40,1),('Butter','kg',2,null,1);
 insert into packaging_materials(name,unit,current_stock) values('Box','pieces',30);
 insert into store_menu(name,category,track_display_stock) values('Cream Shake','Milkshake',false);
 insert into cc_production_recipes(product_name,yield_qty,yield_kg,ingredients,packaging) values('Cream Shake',1,0.3,'[{"name":"Fresh cream","quantity":0.1,"unit":"liter"},{"name":"Eggs","quantity":0.5,"unit":"dozen"}]','[{"name":"Box","quantity":1,"unit":"pieces"}]');`);
const sql=fs.readFileSync('migrations/20260958_stock_units_fix.sql','utf8');
await db.exec(sql);await db.exec(sql); // re-runnable
const item=async n=>(await db.query('select unit,current_stock::float s,low_stock_threshold::float l,cost_per_unit::float c from inventory_items where name=$1 union all select unit,current_stock::float,low_stock_threshold::float,cost_per_unit::float from packaging_materials where name=$1',[n])).rows[0];
assert.deepEqual(await item('Fresh cream'),{unit:'l',s:2,l:1,c:220});
assert.deepEqual(await item('Eggs'),{unit:'pcs',s:36,l:12,c:5});
assert.deepEqual(await item('Box'),{unit:'pcs',s:30,l:0,c:0});
assert.equal((await item('Sugar')).s,0,'negative stock reset');
assert.equal((await item('Butter')).c,0,'stock without cost gets cost 0');
const rec=(await db.query("select ingredients,packaging from cc_production_recipes where product_name='Cream Shake'")).rows[0];
assert.deepEqual(rec.ingredients,[{name:'Fresh cream',quantity:0.1,unit:'l'},{name:'Eggs',quantity:6,unit:'pcs'}]);
assert.deepEqual(rec.packaging,[{name:'Box',quantity:1,unit:'pcs'}]);
// legacy-unit recipe now deducts
const o1=(await db.query(`insert into store_orders(items) values('[{"name":"Cream Shake","qty":2}]') returning id`)).rows[0].id;
assert.equal((await item('Eggs')).s,24);assert.equal((await item('Box')).s,28);
// overselling stops at 0 and cancel returns only what was taken
await db.exec("update inventory_items set current_stock=150 where name='Milk'");
const o2=(await db.query(`insert into store_orders(items) values('[{"name":"Cold Coffee","qty":1}]') returning id`)).rows[0].id;
assert.equal((await item('Milk')).s,0);
assert.equal(Number((await db.query("select quantity from cc_sales_usage where order_id=$1 and name='Milk'",[o2])).rows[0].quantity),150);
await db.query("update store_orders set status='cancelled' where id=$1",[o2]);
assert.equal((await item('Milk')).s,150);
assert.equal((await db.query('select count(*)::int n from cc_sales_usage where order_id=$1',[o2])).rows[0].n,0);
// increasing an order beyond stock, then reducing it
await db.exec("update inventory_items set current_stock=500 where name='Milk'");
const o3=(await db.query(`insert into store_orders(items) values('[{"name":"Cold Coffee","qty":1}]') returning id`)).rows[0].id;
assert.equal((await item('Milk')).s,300);
await db.query(`update store_orders set items='[{"name":"Cold Coffee","qty":4}]' where id=$1`,[o3]); // wants 800, only 300 left
assert.equal((await item('Milk')).s,0);
await db.query(`update store_orders set items='[{"name":"Cold Coffee","qty":2}]' where id=$1`,[o3]); // wants 400, had taken 500
assert.equal((await item('Milk')).s,100);
await db.query('delete from store_orders where id=$1',[o3]);assert.equal((await item('Milk')).s,500);
await db.close();console.log('PASS stock units fix: legacy units (liter/dozen/pieces) + recipe lines normalised, negative & no-cost stock unblocked, sales stop at 0, exact restores.');
})().catch(e=>{console.error(e);process.exit(1);});

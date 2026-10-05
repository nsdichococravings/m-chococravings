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
const sql=fs.readFileSync('migrations/20260956_auto_stock.sql','utf8');
await db.exec(sql);await db.exec(sql); // re-runnable
const stock=async n=>Number((await db.query('select current_stock s from inventory_items where name=$1 union all select current_stock from packaging_materials where name=$1',[n])).rows[0].s);
const reqs=async()=>(await db.query('select product_name,quantity,status,source,booking_id,due_date::text due from cc_production_requests order by created_at,product_name')).rows;
const order=async(items,status)=>(await db.query('insert into store_orders(items,status) values($1::jsonb,$2) returning id',[JSON.stringify(items),status||'pending'])).rows[0].id;

// 1. made-to-order sale uses latest active recipe x qty / yield; counter items skipped
const o1=await order([{name:'Cold Coffee',qty:2,price:89},{name:'cold coffee',qty:1},{name:'Nutella Brownie',qty:3},{name:'Unknown',qty:1}]);
assert.equal(await stock('Milk'),400);assert.equal(await stock('Coffee powder'),70);assert.equal(await stock('Cup'),47);assert.equal(await stock('Flour'),5);
// Tables board stores stringified items and adds items later
const o2=await order(JSON.stringify([{name:'Lemon Juice',qty:1}]));
assert.equal(await stock('Lemon'),8.5);
await db.query('update store_orders set items=$1::jsonb where id=$2',[JSON.stringify(JSON.stringify([{name:'Lemon Juice',qty:4}])),o2]);
assert.equal(await stock('Lemon'),4);
// status change other than cancel: no double count
await db.query("update store_orders set status='collected' where id=$1",[o1]);assert.equal(await stock('Milk'),400);
// cancel restores exactly; un-cancel deducts again; delete restores
await db.query("update store_orders set status='cancelled' where id=$1",[o1]);
assert.equal(await stock('Milk'),1000);assert.equal(await stock('Cup'),50);
await db.query("update store_orders set status='pending' where id=$1",[o1]);assert.equal(await stock('Milk'),400);
await db.query('delete from store_orders where id=$1',[o1]);assert.equal(await stock('Milk'),1000);
// overselling goes negative instead of blocking the order
await order([{name:'Cold Coffee',qty:6}]);assert.equal(await stock('Milk'),-200);
// a deleted recipe is no longer used
await db.exec("update cc_production_recipes set deleted_at=now() where product_name='Lemon Juice'");
await order([{name:'Lemon Juice',qty:2}]);assert.equal(await stock('Lemon'),4);
// a broken order payload never blocks the insert
await order('"{not json"');

// 2. counter stock at reorder level -> one automatic request (filed under the admin)
await db.exec("update display_stock set current_stock=6 where item_name='Nutella Brownie'");
assert.equal((await reqs()).length,0);
await db.exec("update display_stock set current_stock=4 where item_name='Nutella Brownie'");
await db.exec("update display_stock set current_stock=3 where item_name='Nutella Brownie'");
let r=await reqs();assert.equal(r.length,1);assert.deepEqual([r[0].product_name,r[0].quantity,r[0].source,r[0].status],['Nutella Brownie',6,'auto','pending']);
assert.equal((await db.query('select requested_by from cc_production_requests')).rows[0].requested_by,ADMIN);
// fulfilled -> next drop makes a new one; auto switch off -> none
await db.exec("update cc_production_requests set status='fulfilled'");
await db.exec("update display_stock set current_stock=2 where item_name='Nutella Brownie'");
assert.equal((await reqs()).filter(x=>x.status==='pending').length,1);
await db.exec("update cc_production_requests set status='fulfilled'; update display_stock set auto_restock=false; update display_stock set current_stock=1");
assert.equal((await reqs()).filter(x=>x.status==='pending').length,0);
await db.exec("update display_stock set auto_restock=true");

// 3. bookings -> kitchen request; edit while pending; cancel (by non-admin staff) cancels it; delivered releases outlet stock
const b=(await db.query(`insert into custom_bookings(customer_name,booking_date,cake_name_text,production_product,production_qty) values('Asha','2026-10-12','Happy Birthday Aarav','Vanilla Cake 1kg',1) returning id`)).rows[0].id;
r=(await reqs()).filter(x=>x.source==='booking');assert.equal(r.length,1);assert.deepEqual([r[0].product_name,r[0].quantity,r[0].due,r[0].booking_id],['Vanilla Cake 1kg',1,'2026-10-12',b]);
const ds=(await db.query("select auto_restock,low_stock_threshold from display_stock where item_name='Vanilla Cake 1kg'")).rows[0];assert.deepEqual([ds.auto_restock,Number(ds.low_stock_threshold)],[false,0]);
await db.query("update custom_bookings set production_qty=2, booking_date='2026-10-13' where id=$1",[b]);
r=(await reqs()).filter(x=>x.source==='booking');assert.deepEqual([r[0].quantity,r[0].due],[2,'2026-10-13']);
await db.query("update custom_bookings set status='cancelled' where id=$1",[b]);
assert.equal((await reqs()).find(x=>x.source==='booking').status,'cancelled');
await db.query("update custom_bookings set status='booked' where id=$1",[b]); // re-booked -> fresh request
assert.equal((await reqs()).find(x=>x.source==='booking').status,'pending');
await db.exec("update display_stock set current_stock=2 where item_name='Vanilla Cake 1kg'");
assert.equal((await reqs()).filter(x=>x.product_name==='Vanilla Cake 1kg').length,1,'booked cakes are never auto-baked');
await db.query("update custom_bookings set status='delivered' where id=$1",[b]);
await db.query("update custom_bookings set status='delivered', cake_name_text='x' where id=$1",[b]); // no double release
assert.equal(Number((await db.query("select current_stock from display_stock where item_name='Vanilla Cake 1kg'")).rows[0].current_stock),0);
// booking without a kitchen product, or an unknown product, creates nothing
await db.exec(`insert into custom_bookings(customer_name,booking_date) values('Bala','2026-10-20');insert into custom_bookings(customer_name,booking_date,production_product) values('Chitra','2026-10-21','Mystery Cake')`);
assert.equal((await reqs()).filter(x=>x.source==='booking').length,1);
// the normal guard still applies to people
await db.exec(`insert into cc_production_requests(product_name,quantity,due_date,requested_by) values('Cold Coffee',1,current_date,'${STAFF}')`);
await assert.rejects(db.exec("update cc_production_requests set status='approved' where product_name='Cold Coffee'"),/Only admin/);

// 4. reorder levels
await assert.rejects(db.query("select cc_set_reorder_level('raw','Nope',1)"),/not found/);
await assert.rejects(db.query("select cc_set_reorder_level('raw','Milk',-1)"),/0 or more/);
await db.query("select cc_set_reorder_level('packaging','Cup',20)");
await db.query("select cc_set_reorder_level('outlet','Nutella Brownie',2,false)");
assert.deepEqual((await db.query("select low_stock_threshold::int t,auto_restock a from display_stock where item_name='Nutella Brownie'")).rows[0],{t:2,a:false});
await db.exec('update auth.me set id=null');await assert.rejects(db.query("select cc_set_reorder_level('raw','Milk',1)"),/Production access/);
await db.exec('set role authenticated');await assert.rejects(db.query('select * from cc_sales_usage'),/permission denied/);await db.exec('reset role');
await db.close();console.log('PASS auto stock: recipe usage per sale (latest recipe, yield, packaging, string items, edits, cancel/restore, delete, oversell, deleted recipe, bad payload), auto outlet requests, booking requests (edit/cancel/rebook/deliver), guard kept, reorder levels.');
})().catch(e=>{console.error(e);process.exit(1);});

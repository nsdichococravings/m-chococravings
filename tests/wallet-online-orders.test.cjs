const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.me(id uuid);insert into auth.me values('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
insert into auth.users values('11111111-1111-1111-1111-111111111111','a@x.in',now()),('22222222-2222-2222-2222-222222222222','b@x.in',now());
create table customers(id uuid primary key default gen_random_uuid(),email text,phone text);
insert into customers(id,email,phone) values('c1c1c1c1-0000-0000-0000-000000000001','a@x.in','9876543210'),('c2c2c2c2-0000-0000-0000-000000000002','b@x.in','9800000002');
create table roles(r text);insert into roles values('staff');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create table store_orders(id uuid primary key);insert into store_orders values('aaaaaaaa-0000-0000-0000-000000000001');
create table orders(id uuid primary key default gen_random_uuid(),order_number text,customer_id uuid,customer_phone text,total numeric(10,2),
 payment_method text default 'cod' check (payment_method in ('cod','upi')),payment_status text default 'pending',status text default 'pending',
 amount_paid numeric(10,2),balance_due numeric(10,2),created_at timestamptz default now());`);
await db.exec(fs.readFileSync('migrations/20261108_customer_wallet.sql','utf8'));
const sql=fs.readFileSync('migrations/20261110_wallet_online_orders.sql','utf8');await db.exec(sql);await db.exec(sql);
const q=async(s,a)=>(await db.query(s,a)).rows[0];
// 300 in the wallet (change kept at the counter).
await q(`select cc_wallet_staff('credit_change','{"phone":"9876543210","amount":300,"order_id":"aaaaaaaa-0000-0000-0000-000000000001"}')`);
const order=async(o)=>(await q(`insert into orders(order_number,customer_id,customer_phone,total,payment_method,amount_paid,balance_due,created_at)
 values($1,$2,$3,$4,'upi',$5,$6,coalesce($7::timestamptz,now())) returning id`,[o.n,o.cust||null,o.phone,o.total,o.paid,o.due,o.at||null])).id;
const pay=async(id,amt)=>(await q('select cc_wallet_pay_order($1,$2) r',[id,amt])).r;
const row=async(id)=>q('select payment_method,payment_status,amount_paid::float,balance_due::float,wallet_paid::float from orders where id=$1',[id]);
// Whole order from the wallet.
const o1=await order({n:'CC-1',cust:'c1c1c1c1-0000-0000-0000-000000000001',phone:'+91 98765 43210',total:120,paid:0,due:120});
let r=await pay(o1,120);assert.equal(Number(r.balance),180);assert.equal(r.paid_in_full,true);
assert.deepEqual(await row(o1),{payment_method:'upi',payment_status:'paid',amount_paid:120,balance_due:0,wallet_paid:120},'method kept when table has no wallet value');
assert.equal((await pay(o1,120)).repeat,true,'retry does not charge twice');
// Part wallet, rest by UPI.
const o2=await order({n:'CC-2',phone:'9876543210',total:500,paid:400,due:100});
r=await pay(o2,100);assert.equal(Number(r.balance),80);assert.equal(r.paid_in_full,false);
assert.deepEqual(await row(o2),{payment_method:'upi',payment_status:'pending',amount_paid:500,balance_due:0,wallet_paid:100});
// Refusals.
const o3=await order({n:'CC-3',phone:'9876543210',total:200,paid:0,due:200});
await assert.rejects(pay(o3,250),/more than what is due/);
await assert.rejects(pay(o3,200),/only ₹80/,'not more than the balance');
const other=await order({n:'CC-4',cust:'c2c2c2c2-0000-0000-0000-000000000002',phone:'9800000002',total:50,paid:0,due:50});
await assert.rejects(pay(other,10),/Order not found/,'someone else\'s order');
const old=await order({n:'CC-5',phone:'9876543210',total:50,paid:0,due:50,at:new Date(Date.now()-2*864e5).toISOString()});
await assert.rejects(pay(old,10),/too old/);
assert.equal(Number((await q(`select balance from cc_wallets where phone10='9876543210'`)).balance),80,'failed attempts take nothing');
// With 'wallet' allowed, a fully wallet-paid order says so.
await db.exec(`alter table orders drop constraint orders_payment_method_check;alter table orders add constraint orders_payment_method_check check (payment_method in ('cod','upi','wallet'))`);
const o6=await order({n:'CC-6',phone:'9876543210',total:30,paid:0,due:30});
await pay(o6,30);assert.equal((await row(o6)).payment_method,'wallet');
await db.close();console.log('PASS wallet online orders: full, part, retry, limits, ownership, age.');
})().catch(e=>{console.error(e);process.exit(1);});

/* Wallet money returns when an order is cancelled. Run: node tests/wallet-refund-on-cancel.test.cjs */
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();const U1='11111111-1111-1111-1111-111111111111';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.me(id uuid);insert into auth.me values('${U1}');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table auth.users(id uuid,email text,email_confirmed_at timestamptz);insert into auth.users values('${U1}','a@x.in',now());
create table customers(id serial,email text,phone text);insert into customers(email,phone) values('a@x.in','9876543210');
create table roles(r text);insert into roles values('staff');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create table store_orders(id uuid primary key default gen_random_uuid(),token text,customer_id text,customer_phone text,total numeric,
 status text default 'pending',payment_status text default 'pending',payment_method text,merged_into uuid,created_at timestamptz default now());
create table orders(id uuid primary key default gen_random_uuid(),order_number text,customer_id text,customer_phone text,total numeric,
 status text default 'pending',payment_status text default 'pending' check (payment_status in ('pending','paid')),payment_method text,created_at timestamptz default now());`);
await db.exec(fs.readFileSync('migrations/20261108_customer_wallet.sql','utf8'));
await db.exec(fs.readFileSync('migrations/20261110_wallet_online_orders.sql','utf8'));
await db.exec(fs.readFileSync('migrations/20261123_wallet_cafe_orders.sql','utf8'));
const bal=async()=>Number((await db.query('select cc_wallet_me() r')).rows[0].r.balance);
await db.query(`select cc_wallet_topup_record('rzp_1',$1,200)`,[U1]);await db.query(`select cc_wallet_topup_settle('rzp_1',$1,'pay_1',20000)`,[U1]);
const cafe=async(total,extra='')=>{const id=(await db.query(`insert into store_orders(token,customer_id,total) values('C-'||floor(random()*99),$1,$2) returning id::text id`,[U1,total])).rows[0].id;
 await db.query('select cc_wallet_pay_store_order($1::uuid)',[id]);return id;};
// Cancelled before this migration existed: refunded when it runs.
const old=await cafe(50);await db.query(`update store_orders set status='cancelled' where id=$1::uuid`,[old]);
assert.equal(await bal(),150);
const sql=fs.readFileSync('migrations/20261124_wallet_refund_on_cancel.sql','utf8');await db.exec(sql);await db.exec(sql);
assert.equal(await bal(),200,'earlier cancelled order refunded once');
assert.equal((await db.query('select payment_status from store_orders where id=$1::uuid',[old])).rows[0].payment_status,'refunded');
// Cancel now: refunded straight away, once, even if cancelled again.
const o1=await cafe(60);assert.equal(await bal(),140);
await db.query(`update store_orders set status='cancelled' where id=$1::uuid`,[o1]);assert.equal(await bal(),200);
await db.query(`update store_orders set status='pending' where id=$1::uuid`,[o1]);await db.query(`update store_orders set status='cancelled' where id=$1::uuid`,[o1]);
assert.equal(await bal(),200,'never refunded twice');
const h=(await db.query('select cc_wallet_me() r')).rows[0].r.txns;assert.equal(h[0].kind,'refund');assert.match(h[0].note,/Refund · cancelled C-/);
// Merged into a bill: money moved to the bill, no refund.
const m=await cafe(40);await db.query(`update store_orders set status='cancelled',merged_into=gen_random_uuid() where id=$1::uuid`,[m]);assert.equal(await bal(),160);
// Unpaid or cash orders: nothing happens.
const cash=(await db.query(`insert into store_orders(token,total,payment_method) values('C-9',30,'cash') returning id::text id`)).rows[0].id;
await db.query(`update store_orders set status='cancelled' where id=$1::uuid`,[cash]);assert.equal(await bal(),160);
// Online order paid from wallet then cancelled; its table doesn't allow 'refunded'.
const on=(await db.query(`insert into orders(order_number,customer_id,total) values('NSD-1',(select id::text from customers limit 1),100) returning id::text id`)).rows[0].id;
await db.query('select cc_wallet_pay_order($1::uuid,100)',[on]);assert.equal(await bal(),60);
await db.query(`update orders set status='cancelled' where id=$1::uuid`,[on]);assert.equal(await bal(),160,'online order refunded');
console.log('wallet-refund-on-cancel: all checks passed');
})().catch(e=>{console.error(e);process.exit(1)});

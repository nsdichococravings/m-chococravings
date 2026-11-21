/* NSDI Cafe orders paid from the customer's wallet. Run: node tests/wallet-cafe-orders.test.cjs */
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();
const U1='11111111-1111-1111-1111-111111111111',U2='22222222-2222-2222-2222-222222222222',U3='33333333-3333-3333-3333-333333333333';
await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.me(id uuid);insert into auth.me values('${U1}');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
insert into auth.users values('${U1}','a@x.in',now()),('${U2}','b@x.in',now()),('${U3}','c@x.in',now());
create table customers(id serial,email text,phone text);insert into customers(email,phone) values('a@x.in','+91 98765 43210'),('b@x.in','9123456780'),('c@x.in',null);
create table roles(r text);insert into roles values('staff');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create table store_orders(id uuid primary key default gen_random_uuid(),token text,customer_id text,customer_phone text,total numeric,
 status text default 'pending',payment_status text default 'pending',payment_method text,created_at timestamptz default now());`);
await db.exec(fs.readFileSync('migrations/20261108_customer_wallet.sql','utf8'));
const sql=fs.readFileSync('migrations/20261123_wallet_cafe_orders.sql','utf8');await db.exec(sql);await db.exec(sql);
const as=async u=>db.exec(`update auth.me set id='${u}'`);
const order=async(o)=>(await db.query(`insert into store_orders(token,customer_id,customer_phone,total,status,payment_status,created_at)
  values($1,$2,$3,$4,coalesce($5,'pending'),coalesce($6,'pending'),coalesce($7::timestamptz,now())) returning id::text id`,
  [o.token||'CAFE-1',o.cust||null,o.phone||null,o.total,o.status||null,o.pay||null,o.at||null])).rows[0].id;
const pay=async id=>(await db.query('select cc_wallet_pay_store_order($1::uuid) r',[id])).rows[0].r;
const bal=async()=>Number((await db.query('select cc_wallet_me() r')).rows[0].r.balance);
const row=async id=>(await db.query('select payment_status,payment_method from store_orders where id=$1::uuid',[id])).rows[0];
// Give customer A ₹100 through a top-up.
await db.query(`select cc_wallet_topup_record('rzp_1',$1,100)`,[U1]);await db.query(`select cc_wallet_topup_settle('rzp_1',$1,'pay_1',10000)`,[U1]);
assert.equal(await bal(),100);
// Pays own order (placed while signed in), once.
const o1=await order({cust:U1,total:60});
assert.equal(Number((await pay(o1)).balance),40);
assert.deepEqual(await row(o1),{payment_status:'paid',payment_method:'wallet'});
assert.equal((await pay(o1)).repeat,true);assert.equal(await bal(),40,'not charged twice');
// Own order by mobile number only (not signed in when placed).
const o2=await order({phone:'+919876543210',total:15});assert.equal(Number((await pay(o2)).balance),25);
// Not enough: nothing changes.
const o3=await order({cust:U1,total:30});
await assert.rejects(pay(o3),/only ₹25/);assert.equal(await bal(),25);assert.equal((await row(o3)).payment_status,'pending');
// Someone else's order, cancelled, already paid, too old.
const other=await order({cust:U2,phone:'9123456780',total:5});await assert.rejects(pay(other),/Order not found/);
await assert.rejects(pay(await order({cust:U1,total:5,status:'cancelled'})),/cancelled/);
await assert.rejects(pay(await order({cust:U1,total:5,pay:'paid'})),/already paid/);
await assert.rejects(pay(await order({cust:U1,total:5,at:new Date(Date.now()-2*864e5).toISOString()})),/too old/);
// No mobile number on profile.
await as(U3);await assert.rejects(pay(await order({cust:U3,total:5})),/mobile number/);
// Guests can't call it.
await db.exec('set role anon');await assert.rejects(pay(o3),/permission denied/);await db.exec('reset role');
console.log('wallet-cafe-orders: all checks passed');
})().catch(e=>{console.error(e);process.exit(1)});

const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
create table auth.me(id uuid);insert into auth.me values('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table auth.users(id uuid,email text,email_confirmed_at timestamptz);
insert into auth.users values('11111111-1111-1111-1111-111111111111','a@x.in',now()),('22222222-2222-2222-2222-222222222222','b@x.in',now());
create table customers(email text,phone text);insert into customers values('a@x.in','+91 98765 43210'),('b@x.in',null);
create table roles(r text);insert into roles values('staff');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create table store_orders(id uuid primary key);
insert into store_orders values('aaaaaaaa-0000-0000-0000-000000000001'),('aaaaaaaa-0000-0000-0000-000000000002');`);
const sql=fs.readFileSync('migrations/20261108_customer_wallet.sql','utf8');await db.exec(sql);await db.exec(sql);
const st=async(a,p)=>(await db.query('select cc_wallet_staff($1,$2::jsonb) r',[a,JSON.stringify(p)])).rows[0].r;
const me=async()=>(await db.query('select cc_wallet_me() r')).rows[0].r;
const O1='aaaaaaaa-0000-0000-0000-000000000001',O2='aaaaaaaa-0000-0000-0000-000000000002',U1='11111111-1111-1111-1111-111111111111';
assert.equal((await me()).balance,0);
// Change credit from the Kitchen, once per order.
assert.equal(Number((await st('credit_change',{phone:'9876543210',amount:30,order_id:O1})).balance),30);
const again=await st('credit_change',{phone:'9876543210',amount:30,order_id:O1});assert.equal(again.repeat,true);
assert.equal(Number((await st('lookup',{phone:'+919876543210'})).balance),30);
await assert.rejects(st('credit_change',{phone:'9876543210',amount:5,order_id:'nope'}),/Order not found/);
await assert.rejects(st('credit_change',{phone:'9876543210',amount:5000,order_id:O2}),/₹2000/);
// Spend: not more than the balance.
await assert.rejects(st('spend',{phone:'9876543210',amount:31,order_id:O2}),/only ₹30/);
assert.equal(Number((await st('spend',{phone:'9876543210',amount:12.5,order_id:O2})).balance),17.5);
assert.equal((await st('spend',{phone:'9876543210',amount:12.5,order_id:O2})).repeat,true);
await assert.rejects(st('adjust',{phone:'9876543210',amount:10,note:'x'}),/Admin access required/);
// Customer view.
let m=await me();assert.equal(Number(m.balance),17.5);assert.equal(m.phone_last4,'3210');assert.equal(m.txns.length,2);assert.equal(m.txns[0].kind,'spend');
// Top-up: only service_role functions, amount must match, credit once.
await db.query(`select cc_wallet_topup_record('order_A',$1,100)`,[U1]);
await assert.rejects(db.query(`select cc_wallet_topup_settle('order_A',$1,'pay_1',5000)`,[U1]),/does not match/);
await assert.rejects(db.query(`select cc_wallet_topup_settle('order_A','22222222-2222-2222-2222-222222222222','pay_1',10000)`),/not found/);
assert.equal(Number((await db.query(`select cc_wallet_topup_settle('order_A',$1,'pay_1',10000) r`,[U1])).rows[0].r.balance),117.5);
assert.equal((await db.query(`select cc_wallet_topup_settle('order_A',$1,'pay_1',10000) r`,[U1])).rows[0].r.repeat,true);
assert.equal(Number((await me()).balance),117.5);
await assert.rejects(db.query(`select cc_wallet_topup_record('order_B','22222222-2222-2222-2222-222222222222',100)`),/mobile number/);
await assert.rejects(db.query(`select cc_wallet_topup_record('order_C',$1,5)`,[U1]),/₹10/);
// Admin correction.
await db.exec(`update roles set r='admin'`);
await assert.rejects(st('adjust',{phone:'9876543210',amount:-500,note:'fix'}),/only ₹117.5/);
assert.equal(Number((await st('adjust',{phone:'9876543210',amount:-7.5,note:'Miscount'})).balance),110);
// Customers and guests can't use staff actions; nobody but service_role gets top-up functions.
await db.exec(`update roles set r='customer'`);
await assert.rejects(st('lookup',{phone:'9876543210'}),/Staff access required/);
const g=(await db.query(`select has_function_privilege('authenticated','cc_wallet_topup_settle(text,uuid,text,bigint)','execute') a,
  has_function_privilege('authenticated','cc_wallet_post(text,text,numeric,text,text,text,text,text)','execute') b,
  has_function_privilege('service_role','cc_wallet_topup_settle(text,uuid,text,bigint)','execute') c,
  has_table_privilege('authenticated','cc_wallets','select') d`)).rows[0];
assert.deepEqual(g,{a:false,b:false,c:true,d:false});
await db.close();console.log('PASS customer wallet: change credit, spend, top-up, adjust, once per order, access rules.');
})().catch(e=>{console.error(e);process.exit(1);});

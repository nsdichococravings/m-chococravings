const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const OWNER='11111111-1111-1111-1111-111111111111',STAFF='22222222-2222-2222-2222-222222222222';
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create schema net;
create table auth.me(id uuid);insert into auth.me values('${OWNER}');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create function cc_prod_is_super() returns bool language sql as $$select auth.uid()='${OWNER}'$$;
create function cc_store_items(p jsonb) returns jsonb language sql as $$select case when jsonb_typeof(p)='array' then p when jsonb_typeof(p)='string' then (p#>>'{}')::jsonb else '[]'::jsonb end$$;
create table cc_push_config(key text primary key,value text);insert into cc_push_config values('function_url','https://x/send-push'),('webhook_secret','s3');
create table net.calls(url text,body jsonb,headers jsonb);
create function net.http_post(url text,body jsonb,headers jsonb) returns bigint language sql as $$insert into net.calls values(url,body,headers);select 1::bigint$$;
create table store_orders(id serial,total numeric,payment_method text,payment_status text,status text,items jsonb,created_at timestamptz);
create table orders(id serial,total numeric,status text,created_at timestamptz);
create table cc_wastage(item_name text,quantity int,unit_cost numeric,created_at timestamptz default now());
create table inventory_items(name text,current_stock numeric,low_stock_threshold numeric);
create table packaging_materials(name text,current_stock numeric,low_stock_threshold numeric);
create table staff_attendance(staff_name text,work_date date,clock_out timestamptz);`);
// Day = 2026-10-06 IST. 23:00 IST on the 5th and 00:30 IST on the 7th fall outside.
await db.exec(`insert into store_orders(total,payment_method,payment_status,status,items,created_at) values
 (500,'upi','paid','collected','[{"name":"Brownie","qty":3},{"name":"Cold Coffee","qty":1}]','2026-10-06 10:00+05:30'),
 (300,'cash','paid','collected','"[{\\"name\\":\\"Brownie\\",\\"qty\\":2}]"','2026-10-06 19:15+05:30'),
 (200,'cash','pending','pending','[{"name":"Cookie","qty":4}]','2026-10-06 21:00+05:30'),
 (150,'card','paid','collected','[{"name":"Cold Coffee","qty":1}]','2026-10-06 12:00+05:30'),
 (80,'cash','complimentary','collected','[{"name":"Cookie","qty":1}]','2026-10-06 12:30+05:30'),
 (999,'upi','paid','cancelled','[{"name":"Brownie","qty":9}]','2026-10-06 11:00+05:30'),
 (700,'upi','paid','collected','[]','2026-10-05 23:00+05:30'),
 (700,'upi','paid','collected','[]','2026-10-07 00:30+05:30'),
 (1000,'upi','paid','collected','[]','2026-09-29 13:00+05:30');
insert into orders(total,status,created_at) values(450,'delivered','2026-10-06 15:00+05:30'),(100,'cancelled','2026-10-06 15:00+05:30');
insert into cc_wastage values('Brownie',2,20,'2026-10-06 20:00+05:30'),('Cookie',1,null,'2026-10-06 20:10+05:30');
insert into inventory_items values('Milk',1,2),('Butter',5,2),('Sugar',0,0);insert into packaging_materials values('Cake box',3,5);
insert into staff_attendance values('Ravi','2026-10-06',null),('Chitra','2026-10-06',now()),('Old','2026-10-05',null);`);
const sql=fs.readFileSync('migrations/20260968_daily_summary.sql','utf8');await db.exec(sql);await db.exec(sql);
const s=(await db.query(`select cc_daily_summary('2026-10-06') s`)).rows[0].s;
assert.equal(Number(s.store.revenue),1230);assert.equal(s.store.orders,5);
assert.deepEqual([s.store.upi,s.store.cash,s.store.cash_pending,s.store.complimentary,s.store.other].map(Number),[500,300,200,80,150]);
assert.equal(Number(s.online.revenue),450);assert.equal(Number(s.revenue),1680);assert.equal(s.orders,6);
assert.equal(Number(s.last_week_revenue),1000);
assert.deepEqual(s.top_items.map(t=>[t.name,Number(t.qty)]),[['Brownie',5],['Cookie',5],['Cold Coffee',2]]);
assert.deepEqual([Number(s.wastage.pieces),Number(s.wastage.cost)],[3,40]);
assert.deepEqual(s.to_buy,['Butter','Cake box','Milk'].filter(n=>n!=='Butter'));
assert.deepEqual(s.still_clocked_in,['Ravi']);
const t=(await db.query(`select cc_daily_summary_text(cc_daily_summary('2026-10-06')) t`)).rows[0].t;
assert.equal(t.title,'₹1,680 today · 6 orders (▲68% vs last Tue)');
assert.equal(t.body,'UPI ₹500, Cash ₹300, Online ₹450 · Top: Brownie ×5, Cookie ×5, Cold Coffee ×2 · Wasted 3 pcs (₹40) · To buy: Cake box, Milk · Not clocked out: Ravi');
const big=(await db.query(`select cc_daily_summary_text(jsonb_build_object('day','2026-10-06','revenue',1234567,'orders',900,'last_week_revenue',0,'store',jsonb_build_object('upi',1000000,'cash',234567),'online',jsonb_build_object('revenue',0),'top_items','[]'::jsonb,'wastage',jsonb_build_object('pieces',0),'to_buy','["a","b","c","d","e"]'::jsonb,'still_clocked_in','[]'::jsonb)) t`)).rows[0].t;
assert.equal(big.title,'₹12,34,567 today · 900 orders');assert.equal(big.body,'UPI ₹10,00,000, Cash ₹2,34,567 · To buy: a, b, c +2');
const sent=(await db.query('select cc_send_daily_summary() r')).rows[0].r;assert.equal(sent.sent,true);
const call=(await db.query('select * from net.calls')).rows[0];
assert.equal(call.url,'https://x/send-push');assert.equal(call.body.type,'daily_summary');assert.equal(call.headers['x-cc-push-secret'],'s3');
await db.exec(`update auth.me set id='${STAFF}'`);
await assert.rejects(db.query(`select cc_daily_summary('2026-10-06')`),/Only the owner/);
await assert.rejects(db.query('select cc_send_daily_summary()'),/Only the owner/);
await db.close();console.log('PASS daily summary: IST day window, payment split, online + last-week comparison, top items (string and array items), wastage, to-buy, clocked-in staff, push text (Indian digit grouping), send call, owner only.');
})().catch(e=>{console.error(e);process.exit(1);});

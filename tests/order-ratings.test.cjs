const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const A='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',S='55555555-5555-5555-5555-555555555555';
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values(null);
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create function cc_loyalty_role() returns text language sql as $$select case when auth.uid()='${S}' then 'staff' else 'customer' end$$;
create table customers(id uuid primary key default gen_random_uuid(),auth_id uuid,name text,phone text);
create table orders(id text primary key default gen_random_uuid()::text,order_number text,customer_id uuid references customers(id),status text default 'pending');
create table order_items(id serial,order_id text references orders(id),product_id uuid,product_name text,pack_label text);
create table app_settings(key text primary key,value text);
insert into customers(auth_id,name,phone) values('${A}','Asha','+919000000001'),('${B}','Bala','+919000000002');`);
const sql=fs.readFileSync('migrations/20260948_order_ratings.sql','utf8');
await db.exec(sql);await db.exec(sql); // re-runnable
assert.equal((await db.query("select value from app_settings where key='google_review_url'")).rows[0].value,'');
const as=id=>db.query('update auth.me set id=$1',[id]);
const P1='11111111-0000-0000-0000-000000000001',P2='11111111-0000-0000-0000-000000000002';
const mk=async(auth,status,prods)=>{const o=(await db.query(`insert into orders(order_number,customer_id,status) select 'ORD-'||floor(random()*1e6),id,$2 from customers where auth_id=$1 returning id`,[auth,status])).rows[0].id;
 for(const p of prods) await db.query('insert into order_items(order_id,product_id,product_name,pack_label) values($1,$2,$3,$4)',[o,p,p===P1?'Classic':'Nutella','4pcs']);return o;};
const a1=await mk(A,'delivered',[P1,P2]),a2=await mk(A,'pending',[P1]),b1=await mk(B,'delivered',[P1]);

await assert.rejects(db.query('select cc_rate_order($1,5)',[a1]),/Sign in/);
await as(A);
await assert.rejects(db.query('select cc_rate_order($1,5)',[a2]),/once it is delivered/);
await assert.rejects(db.query('select cc_rate_order($1,5)',[b1]),/Order not found/);
await assert.rejects(db.query('select cc_rate_order($1,6)',[a1]),/1 to 5/);
await assert.rejects(db.query('select cc_rate_order($1,3,$2)',[a1,'x'.repeat(501)]),/too long/);
await db.query('select cc_rate_order($1,2,$2)',[a1,'  Too sweet ']);
await db.query('select cc_rate_order($1,5,$2)',[a1,'   ']); // re-rate, blank comment cleared
assert.deepEqual((await db.query('select stars,comment from cc_my_order_ratings()')).rows,[{stars:5,comment:null}]);
await as(B);await db.query('select cc_rate_order($1,3)',[b1]);
assert.deepEqual((await db.query('select order_id from cc_my_order_ratings()')).rows,[{order_id:b1}]);

await as(null);
const pr=Object.fromEntries((await db.query('select * from cc_product_ratings()')).rows.map(r=>[r.product_id,[Number(r.avg_stars),r.rating_count]]));
assert.deepEqual(pr,{[P1]:[4,2],[P2]:[5,1]});

await assert.rejects(db.query('select cc_ratings_report()'),/Sign in/);
await as(A);await assert.rejects(db.query('select cc_ratings_report()'),/Staff access/);
await as(S);
const r=(await db.query('select cc_ratings_report(30) v')).rows[0].v;
assert.equal(r.count,2);assert.equal(Number(r.avg),4);assert.deepEqual(r.split,{'3':1,'5':1});assert.equal(r.low_7d,0);
assert.equal(r.recent.length,2);assert.ok(r.recent.some(x=>x.name==='Asha'&&x.items==='Classic · 4pcs, Nutella · 4pcs'));
assert.deepEqual(r.products.map(p=>[p.name,Number(p.avg),p.count]),[['Classic',4,2],['Nutella',5,1]]);
// direct table access is closed
await db.exec('set role authenticated');await assert.rejects(db.query('select * from cc_order_ratings'),/permission denied/);await db.exec('reset role');
await db.close();console.log('PASS order ratings: delivered-only, own orders, validation, re-rate, product averages, staff report, access control.');
})().catch(e=>{console.error(e);process.exit(1);});

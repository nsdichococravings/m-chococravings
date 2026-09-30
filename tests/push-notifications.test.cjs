const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const A='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values(null);
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table customers(id uuid primary key default gen_random_uuid(),auth_id uuid,name text);
create table orders(id text primary key default gen_random_uuid()::text,customer_id uuid references customers(id),status text default 'pending');
create table app_settings(key text primary key,value text);
insert into customers(auth_id,name) values('${A}','Asha'),('${B}','Bala');`);
const sql=fs.readFileSync('migrations/20260950_push_notifications.sql','utf8');
await db.exec(sql); // no pg_net yet: must still install
await db.exec(`create schema net;create table net.calls(url text,body jsonb,headers jsonb);
create function net.http_post(url text,body jsonb,headers jsonb) returns bigint language sql as $$insert into net.calls values(url,body,headers);select 1::bigint$$;`);
await db.exec(sql); // re-runnable
const cfg=Object.fromEntries((await db.query('select key,value from cc_push_config')).rows.map(r=>[r.key,r.value]));
assert.match(cfg.function_url,/\/functions\/v1\/send-push$/);assert.equal(cfg.webhook_secret.length,64);
assert.equal((await db.query("select value from app_settings where key='vapid_public_key'")).rows[0].value,'');
const as=id=>db.query('update auth.me set id=$1',[id]);
const calls=async()=>(await db.query('select * from net.calls')).rows;

await assert.rejects(db.query("select cc_push_subscribe('https://push/x','k','a')"),/Sign in/);
await as(A);
await assert.rejects(db.query("select cc_push_subscribe('http://push/x','k','a')"),/Invalid push subscription/);
await db.query("select cc_push_subscribe('https://push/a1','k','a','Chrome')");
await db.query("select cc_push_subscribe('https://push/a1','k2','a2','Chrome')"); // refresh same device
assert.deepEqual((await db.query('select p256dh from cc_push_subscriptions')).rows,[{p256dh:'k2'}]);

const oa=(await db.query("insert into orders(customer_id) select id from customers where auth_id=$1 returning id",[A])).rows[0].id;
const ob=(await db.query("insert into orders(customer_id) select id from customers where auth_id=$1 returning id",[B])).rows[0].id;
await db.query("update orders set status='confirmed' where id=$1",[oa]);
await db.query("update orders set status='confirmed' where id=$1",[oa]); // unchanged: no call
await db.query("update orders set status='pending' where id=$1",[oa]);   // not a customer-facing status
await db.query("update orders set status='confirmed' where id=$1",[ob]); // no devices: no call
let c=await calls();assert.equal(c.length,1);
assert.deepEqual(c[0].body,{type:'order_status',order_id:oa,status:'confirmed'});
assert.equal(c[0].headers['x-cc-push-secret'],cfg.webhook_secret);

// a failing HTTP call never blocks the order update
await db.exec(`create or replace function net.http_post(url text,body jsonb,headers jsonb) returns bigint language plpgsql as $$begin raise exception 'down';end$$;`);
await db.query("update orders set status='delivered' where id=$1",[oa]);
assert.equal((await db.query('select status from orders where id=$1',[oa])).rows[0].status,'delivered');

// unsubscribe only removes your own device
await as(B);await db.query("select cc_push_unsubscribe('https://push/a1')");
assert.equal((await db.query('select count(*)::int n from cc_push_subscriptions')).rows[0].n,1);
await as(A);await db.query("select cc_push_unsubscribe('https://push/a1')");
assert.equal((await db.query('select count(*)::int n from cc_push_subscriptions')).rows[0].n,0);
await db.exec('set role authenticated');await assert.rejects(db.query('select * from cc_push_config'),/permission denied/);await db.exec('reset role');
await db.close();console.log('PASS push notifications: installs without pg_net, subscribe/refresh, status trigger filtering, secret header, failure isolation, unsubscribe scope, private config.');
})().catch(e=>{console.error(e);process.exit(1);});

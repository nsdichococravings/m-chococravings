const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table roles(r text);insert into roles values('admin');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create table cc_push_subscriptions(endpoint text primary key,customer_id text,created_at timestamptz default now());
insert into cc_push_subscriptions values('a','c1',now()-interval '30 days'),('b','c1',now()),('c','c2',now()-interval '2 days');`);
const sql=fs.readFileSync('migrations/20260974_push_reach.sql','utf8');await db.exec(sql);await db.exec(sql);
assert.deepEqual((await db.query('select cc_push_reach() r')).rows[0].r,{customers:2,devices:3,new_7d:2});
await db.exec(`update roles set r='staff'`);
await assert.rejects(db.query('select cc_push_reach()'),/Admin access required/);
await db.close();console.log('PASS push reach: customers, devices, new this week; admin only.');
})().catch(e=>{console.error(e);process.exit(1);});

/* Premium loyalty after 100 days: free coffee every 25 visits. Run: node tests/loyalty-premium.test.cjs */
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table roles(r text);insert into roles values('staff');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create function cc_is_super_user() returns boolean language sql as $$select false$$;
create function cc_loyalty_make_code(p text) returns text language sql as $$select 'NSDI-CARD-'||right(p,4)$$;
create table cc_loyalty_cycle_levels(level int primary key,schedule jsonb);insert into cc_loyalty_cycle_levels values(1,'[{"day":10,"item":"Brownie"}]');
create table cc_loyalty_members(id uuid primary key default gen_random_uuid(),name text,phone text unique,card_code text,cycle int default 1,
 stamp_count int default 0,completed_days int default 0,redeemed_days int[] default '{}',schedule jsonb default '[]',suspended boolean default false,
 issued_by uuid,updated_at timestamptz default now());
alter table cc_loyalty_members add column completed_days_dummy int;
create table cc_loyalty_stamp_log(id serial,member_id uuid,from_count int,to_count int,staff_name text,actor uuid,created_at timestamptz default now());
create table store_orders(id serial primary key,customer_phone text,status text,payment_status text);`);
for(const f of ['20261106_loyalty_completed_controls','20261107_loyalty_auto_hide'])
 await db.exec(fs.readFileSync('migrations/'+f+'.sql','utf8'));
await db.exec(`insert into cc_loyalty_members(name,phone,card_code,cycle,stamp_count,completed_days,schedule) values
 ('Asha','+919876543210','NSDI-CARD-3210',5,9,90,'[{"day":10,"item":"Brownie"}]'),('Bala','+919000000001','NSDI-CARD-0001',1,3,0,'[{"day":10,"item":"Brownie"}]')`);
// Under the old rule, crossing 100 hides the card.
await db.exec(`update cc_loyalty_members set stamp_count=10 where name='Asha'`);
const m=async n=>(await db.query('select * from cc_loyalty_members where name=$1',[n])).rows[0];
assert.equal((await m('Asha')).home_hidden,true,'old rule hid it');
const sql=fs.readFileSync('migrations/20261126_loyalty_premium.sql','utf8');await db.exec(sql);await db.exec(sql);
assert.equal((await m('Asha')).home_hidden,false,'shown again as Premium');
// A visit = order collected and paid; once a day.
const visit=async(phone)=>{await db.exec('delete from cc_loyalty_stamp_log');await db.query(`insert into store_orders(customer_phone,status,payment_status) values($1,'collected','paid')`,[phone]);};
await visit('9876543210');let a=await m('Asha');
assert.equal(a.stamp_count,10,'classic stamps stay');assert.equal(a.premium_count,1);assert.ok(a.premium_since);
// Same day again: no second stamp.
await db.query(`insert into store_orders(customer_phone,status,payment_status) values('9876543210','collected','paid')`);assert.equal((await m('Asha')).premium_count,1);
for(let i=0;i<23;i++)await visit('9876543210');
a=await m('Asha');assert.equal(a.premium_count,24);assert.equal(a.premium_ready,0);
await visit('9876543210');a=await m('Asha');assert.equal(a.premium_count,0,'resets after 25');assert.equal(a.premium_ready,1,'free coffee earned');
for(let i=0;i<25;i++)await visit('9876543210');a=await m('Asha');assert.equal(a.premium_ready,2,'every 25 visits');
// Non-premium card unchanged.
await visit('9000000001');const b=await m('Bala');assert.equal(b.stamp_count,4);assert.equal(b.premium_count,0);
// Staff give coffee.
const pr=(act,p)=>db.query('select cc_loyalty_premium($1,$2::jsonb) r',[act,JSON.stringify(p)]).then(x=>x.rows[0].r);
let r=await pr('give_coffee',{member_id:a.id,staff_name:'Ravi'});assert.equal(r.premium_ready,1);assert.equal(r.premium_given,1);
await pr('give_coffee',{member_id:a.id});await assert.rejects(pr('give_coffee',{member_id:a.id}),/No free coffee waiting/);
r=await pr('set_count',{member_id:a.id,count:12});assert.equal(r.premium_count,12);
await assert.rejects(pr('set_count',{member_id:a.id,count:25}),/0 to 24/);
await assert.rejects(pr('give_coffee',{member_id:b.id}),/not Premium yet/);
await db.exec(`update roles set r='customer'`);await assert.rejects(pr('give_coffee',{member_id:a.id}),/Staff access/);await db.exec(`update roles set r='staff'`);
// Super admin reset under 100: premium count starts over.
await db.exec(`update cc_loyalty_members set completed_days=0,stamp_count=0 where name='Asha'`);assert.equal((await m('Asha')).premium_count,0);
console.log('loyalty-premium: all checks passed');
})().catch(e=>{console.error(e);process.exit(1)});

const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const A='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',B='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',C='cccccccc-cccc-cccc-cccc-cccccccccccc';
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values(null);
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table customers(id uuid primary key default gen_random_uuid(),auth_id uuid,customer_code text unique,name text,is_active bool default true,loyalty_points int default 50);
create table orders(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),status text default 'pending');
create table points_transactions(id serial,customer_id uuid,order_id uuid,type text check(type in('earned','redeemed')),points int,balance_after int,description text);
insert into customers(auth_id,customer_code,name) values('${A}','CC-111111','Asha Kumar'),('${B}','CC-222222','Bala R'),('${C}','CC-333333','Chitra');`);
const sql=fs.readFileSync('migrations/20260946_referral_program.sql','utf8');
await db.exec(sql);await db.exec(sql); // re-runnable
const as=id=>db.query('update auth.me set id=$1',[id]);
const one=async(q,p)=>(await db.query(q,p)).rows[0];
const cust=code=>one('select * from customers where customer_code=$1',[code]);

// normalisation + anon check
for(const [i,o] of [['CC-111111','CC-111111'],[' cc 111111 ','CC-111111'],['111111','CC-111111'],['cc-11111',null],['',null],[null,null]])
 assert.equal((await one('select cc_referral_normalize($1) v',[i])).v,o,String(i));
assert.equal((await one("select cc_referral_check('111111') v")).v,true);
assert.equal((await one("select cc_referral_check('CC-999999') v")).v,false);

// apply rules
await assert.rejects(db.query("select cc_referral_apply('CC-111111')"),/Sign in/);
await as(B);
await assert.rejects(db.query("select cc_referral_apply('CC-222222')"),/own referral code/);
await assert.rejects(db.query("select cc_referral_apply('CC-999999')"),/Invalid referral code/);
let r=(await one("select cc_referral_apply(' cc-111111 ') v")).v;assert.equal(r.referrer_name,'Asha');assert.equal(r.reward_points,100);
assert.equal((await one("select cc_referral_apply('111111') v")).v.ok,true); // same code again is fine
await assert.rejects(db.query("select cc_referral_apply('CC-333333')"),/already applied/);
await as(C);await db.exec(`insert into orders(customer_id) select id from customers where customer_code='CC-333333'`);
await assert.rejects(db.query("select cc_referral_apply('CC-111111')"),/before your first order/);

// reward: nothing on placing / cancelling, both paid once on first delivery
const b=await cust('CC-222222');
await db.query('insert into orders(customer_id) values($1),($1)',[b.id]);
const [o1,o2]=(await db.query('select id from orders where customer_id=$1 order by id',[b.id])).rows.map(x=>x.id);
await db.query("update orders set status='cancelled' where id=$1",[o2]);
assert.equal((await cust('CC-111111')).loyalty_points,50);
await db.query("update orders set status='delivered' where id=$1",[o1]);
assert.equal((await cust('CC-111111')).loyalty_points,150);assert.equal((await cust('CC-222222')).loyalty_points,150);
assert.equal((await cust('CC-111111')).lifetime_points,100);
await db.query("update orders set status='delivered' where id=$1",[o2]); // second delivery pays nothing
await db.query("update orders set status='shipped' where id=$1",[o1]);await db.query("update orders set status='delivered' where id=$1",[o1]);
assert.equal((await cust('CC-111111')).loyalty_points,150);assert.equal((await cust('CC-222222')).loyalty_points,150);
// type check rejects 'referral', so the log falls back to 'earned'
assert.deepEqual((await db.query("select type,points,balance_after from points_transactions order by id")).rows,[{type:'earned',points:100,balance_after:150},{type:'earned',points:100,balance_after:150}]);

// a customer who already had delivered orders before being linked earns nothing
const c=await cust('CC-333333');
await db.query("update orders set status='delivered' where customer_id=$1",[c.id]);
await db.query('update customers set referred_by=(select id from customers where customer_code=$1) where id=$2',['CC-111111',c.id]);
await db.query("insert into orders(customer_id,status) values($1,'delivered')",[c.id]);
assert.equal((await cust('CC-333333')).loyalty_points,50);
// self-referral written directly is ignored
const d=(await one("insert into customers(customer_code,name) values('CC-444444','Dev') returning id")).id;
await db.query('update customers set referred_by=id where id=$1',[d]);
await db.query("insert into orders(customer_id,status) values($1,'delivered')",[d]);
assert.equal((await cust('CC-444444')).loyalty_points,50);

// profile summary
await as(A);
assert.deepEqual((await one('select cc_referral_my_summary() v')).v,{code:'CC-111111',joined:2,rewarded:1,points_earned:100,reward_points:100});
await as(null);await assert.rejects(db.query('select cc_referral_my_summary()'),/Sign in/);
await db.close();console.log('PASS referral program: code normalisation, anon check, apply rules, first-delivery reward once, log fallback, abuse guards, summary.');
})().catch(e=>{console.error(e);process.exit(1);});

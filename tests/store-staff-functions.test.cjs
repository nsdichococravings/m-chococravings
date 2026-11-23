/* Staff list, login and Manage Staff through server functions. Run: node tests/store-staff-functions.test.cjs */
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();const A='11111111-1111-1111-1111-111111111111',C='22222222-2222-2222-2222-222222222222';
await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth to anon,authenticated;
create table auth.users(id uuid,email text,email_confirmed_at timestamptz);insert into auth.users values('${A}','a@x.in',now()),('${C}','c@x.in',now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create table public.customers(id serial,email text,name text,phone text,is_admin boolean default false,is_super_user boolean default false,is_employee boolean default false);
insert into customers(email,is_admin) values('a@x.in',true),('c@x.in',false);
create table public.store_staff(id uuid primary key default gen_random_uuid(),name text,pin text,role text default 'Employee',active boolean default true,
 is_super_admin boolean default false,basic_salary numeric default 0,customer_feedback_bonus numeric,sales_target_bonus numeric,no_leave_allowance numeric,created_at timestamptz default now());
insert into store_staff(name,pin,role,is_super_admin,basic_salary) values('Priya','1234','Admin',true,15000),('Ravi','4321','Employee',false,12000),('Old','1111','Employee',false,0);
update store_staff set active=false where name='Old';
grant all on store_staff to anon,authenticated;grant usage on schema public to anon,authenticated;`);
await db.exec(fs.readFileSync('migrations/20261113_staff_app_access.sql','utf8'));
const sql=fs.readFileSync('migrations/20261125_store_staff_functions.sql','utf8');await db.exec(sql);await db.exec(sql);
async function as(role,uid,q,p){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);await db.exec('set role '+role);
 try{return (await db.query(q,p)).rows[0]}finally{await db.exec('reset role')}}
const anon=(q,p)=>as('anon',null,q,p);
// Table closed to the app; PINs not readable.
await assert.rejects(anon('select pin from store_staff'),/permission denied/);
await assert.rejects(as('authenticated',A,'select * from store_staff'),/permission denied/);
// Names for login lists.
assert.deepEqual((await anon('select cc_staff_names() r')).r,['Priya','Ravi']);
assert.deepEqual((await anon("select cc_staff_names(array['Admin']) r")).r,['Priya']);
// Login.
const login=(n,p)=>anon('select cc_staff_login($1,$2) r',[n,p]).then(x=>x.r);
assert.deepEqual(await login('Priya','1234'),{ok:true,id:(await db.query("select id::text from store_staff where name='Priya'")).rows[0].id,name:'Priya',role:'Admin',is_super_admin:true});
assert.equal((await login('priya ','1234')).ok,true,'name case/space tolerant');
assert.deepEqual(await login('Priya','9999'),{ok:false,error:'Wrong name or PIN'});
assert.equal((await login('Old','1111')).ok,false,'inactive staff cannot sign in');
// Own pay details, without the PIN.
const me=(await anon('select cc_staff_self($1,$2) r',['Ravi','4321'])).r;assert.equal(Number(me.basic_salary),12000);assert.equal(me.pin,undefined);
await assert.rejects(anon('select cc_staff_self($1,$2) r',['Ravi','0000']),/sign in again/);
// Super admin salaries.
await assert.rejects(anon('select cc_staff_salaries($1,$2) r',['Ravi','4321']),/Super admin/);
assert.equal((await anon('select cc_staff_salaries($1,$2) r',['Priya','1234'])).r.length,2);
await anon('select cc_staff_set_salary($1,$2,$3,$4,$5)',['Priya','1234','Ravi','basic_salary',13000]);
assert.equal(Number((await db.query("select basic_salary from store_staff where name='Ravi'")).rows[0].basic_salary),13000);
await assert.rejects(anon('select cc_staff_set_salary($1,$2,$3,$4,$5)',['Priya','1234','Ravi','pin',1]),/Unknown pay component/);
// Manage Staff: app admin only.
const ms=(uid,a,p)=>as('authenticated',uid,'select cc_admin_store_staff($1,$2::jsonb) r',[a,JSON.stringify(p||{})]).then(x=>x.r);
await assert.rejects(ms(C,'list'),/do not have access/);
await assert.rejects(anon("select cc_admin_store_staff('list','{}') r"),/permission denied/);
let list=await ms(A,'list');assert.equal(list.length,3);assert.ok(list[0].pin);
list=await ms(A,'add',{name:'Karthik',pin:'5678',role:'Employee'});assert.ok(list.some(s=>s.name==='Karthik'));
await assert.rejects(ms(A,'add',{name:'karthik',pin:'5678'}),/already on the staff list/);
await assert.rejects(ms(A,'add',{name:'X',pin:'12'}),/4 to 8 digits/);
const k=list.find(s=>s.name==='Karthik');
list=await ms(A,'set_active',{id:k.id,active:false});assert.equal(list.find(s=>s.id===k.id).active,false);
list=await ms(A,'delete',{id:k.id});assert.ok(!list.some(s=>s.id===k.id));
console.log('store-staff-functions: all checks passed');
})().catch(e=>{console.error(e);process.exit(1)});

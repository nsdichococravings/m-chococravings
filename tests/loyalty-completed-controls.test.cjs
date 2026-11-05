const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table su(v boolean);insert into su values(true);
create function cc_is_super_user() returns boolean language sql as $$select v from su$$;
create table cc_loyalty_cycle_levels(level int primary key,schedule jsonb);
insert into cc_loyalty_cycle_levels values(1,'[{"day":10,"item":"Coffee"}]');
create table cc_loyalty_members(id uuid primary key default gen_random_uuid(),name text,phone text,card_code text,
 schedule jsonb not null default '[]',stamp_count int not null default 0,cycle int not null default 1,
 redeemed_days int[] not null default '{}',suspended boolean not null default false,completed_days int not null default 0,
 updated_at timestamptz default now());
create table cc_loyalty_stamp_log(id serial,member_id uuid,from_count int,to_count int,staff_name text,actor uuid);
insert into cc_loyalty_members(id,name,phone,card_code,stamp_count,cycle,completed_days,redeemed_days,schedule) values
 ('aaaaaaaa-0000-0000-0000-000000000001','Done','+919876543210','NSDI-CARD-1',10,10,90,'{10}','[{"day":10,"item":"Cake"}]'),
 ('aaaaaaaa-0000-0000-0000-000000000002','Half','+919876500000','NSDI-CARD-2',5,3,20,'{}','[]');`);
const sql=fs.readFileSync('migrations/20261106_loyalty_completed_controls.sql','utf8');await db.exec(sql);await db.exec(sql);
const q=async(a,p)=>(await db.query('select cc_loyalty_super($1,$2::jsonb) r',[a,JSON.stringify(p||{})])).rows[0].r;
assert.equal((await q('check')).super,true);
let l=await q('list_completed');assert.equal(l.members.length,1);assert.equal(l.members[0].total_days,100);
assert.equal((await q('list_completed',{query:'3210'})).members.length,1);
assert.equal((await q('list_completed',{query:'nobody'})).members.length,0);
assert.equal((await q('set_visible',{member_id:'aaaaaaaa-0000-0000-0000-000000000001',visible:false})).home_hidden,true);
assert.equal((await q('list_completed')).members[0].home_hidden,true);
assert.equal((await q('set_visible',{member_id:'aaaaaaaa-0000-0000-0000-000000000001',visible:true})).home_hidden,false);
await assert.rejects(q('set_visible',{member_id:'aaaaaaaa-0000-0000-0000-000000000002',visible:false}),/not reached 100/);
await assert.rejects(q('set_visible',{member_id:'aaaaaaaa-0000-0000-0000-000000000001'}),/visible/);
await q('set_visible',{member_id:'aaaaaaaa-0000-0000-0000-000000000001',visible:false});
const r=await q('reset',{member_id:'aaaaaaaa-0000-0000-0000-000000000001'});
assert.deepEqual([r.cycle,r.stamp_count,r.completed_days,r.redeemed_days,r.home_hidden],[1,0,0,[],false]);
assert.deepEqual(r.schedule,[{day:10,item:'Coffee'}]);
assert.equal((await db.query(`select count(*)::int n from cc_loyalty_stamp_log where to_count=0`)).rows[0].n,1);
assert.equal((await q('list_completed')).members.length,0);
await db.exec('update su set v=false');
assert.equal((await q('check')).super,false);
await assert.rejects(q('list_completed'),/Super admin access required/);
await assert.rejects(q('reset',{member_id:'aaaaaaaa-0000-0000-0000-000000000002'}),/Super admin access required/);
// Auto-hide at 100 days.
await db.exec(`insert into cc_loyalty_members(id,name,phone,card_code,stamp_count,completed_days) values
 ('aaaaaaaa-0000-0000-0000-000000000003','Old','+919811111111','NSDI-CARD-3',2,100),
 ('aaaaaaaa-0000-0000-0000-000000000004','Near','+919822222222','NSDI-CARD-4',8,90)`);
await db.exec('update su set v=true');
const auto=fs.readFileSync('migrations/20261107_loyalty_auto_hide.sql','utf8');await db.exec(auto);
const hid=async id=>(await db.query(`select home_hidden h from cc_loyalty_members where id=$1`,[id])).rows[0].h;
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000003'),true,'already past 100 -> hidden on first run');
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),false);
await db.exec(`update cc_loyalty_members set stamp_count=9 where id='aaaaaaaa-0000-0000-0000-000000000004'`);
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),false,'99 days stays visible');
await db.exec(`update cc_loyalty_members set stamp_count=10 where id='aaaaaaaa-0000-0000-0000-000000000004'`);
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),true,'hides when it reaches 100');
await q('set_visible',{member_id:'aaaaaaaa-0000-0000-0000-000000000004',visible:true});
await db.exec(`update cc_loyalty_members set stamp_count=11 where id='aaaaaaaa-0000-0000-0000-000000000004'`);
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),false,'shown by super admin stays shown');
await db.exec(auto);
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),false,'re-running does not re-hide');
await q('reset',{member_id:'aaaaaaaa-0000-0000-0000-000000000004'});
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),false);
await db.exec(`update cc_loyalty_members set completed_days=95,stamp_count=5 where id='aaaaaaaa-0000-0000-0000-000000000004'`);
assert.equal(await hid('aaaaaaaa-0000-0000-0000-000000000004'),true,'hides again after reset + 100');
await db.close();console.log('PASS loyalty 100-day controls (+ auto-hide): list, hide/show, reset; super admin only.');
})().catch(e=>{console.error(e);process.exit(1);});

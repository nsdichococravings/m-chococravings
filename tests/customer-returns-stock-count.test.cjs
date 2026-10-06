const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const OWNER='11111111-1111-1111-1111-111111111111',STAFF='22222222-2222-2222-2222-222222222222';
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;create schema net;
create table auth.me(id uuid);insert into auth.me values('${OWNER}');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create function cc_prod_is_super() returns bool language sql as $$select auth.uid()='${OWNER}'$$;
create function cc_production_role() returns text language sql as $$select case when auth.uid()='${OWNER}' then 'admin' when auth.uid()='${STAFF}' then 'production' else 'none' end$$;
create function cc_production_access() returns bool language sql as $$select cc_production_role()<>'none'$$;
create function cc_store_items(p jsonb) returns jsonb language sql as $$select case when jsonb_typeof(p)='array' then p else '[]'::jsonb end$$;
create table cc_push_config(key text primary key,value text);insert into cc_push_config values('function_url','https://x/send-push'),('webhook_secret','s3');
create table net.calls(url text,body jsonb,headers jsonb);
create function net.http_post(url text,body jsonb,headers jsonb) returns bigint language sql as $$insert into net.calls values(url,body,headers);select 1::bigint$$;
create table customers(id text primary key,name text,phone text);
create table cc_push_subscriptions(endpoint text primary key,customer_id text);
create table store_orders(id serial,customer_phone text,customer_name text,total numeric,status text,items jsonb,created_at timestamptz);
create table orders(id serial,customer_id text,total numeric,status text,created_at timestamptz);
create table inventory_items(name text primary key,unit text,current_stock numeric,cost_per_unit numeric,updated_at timestamptz);
create table packaging_materials(name text primary key,unit text,current_stock numeric,cost_per_unit numeric,updated_at timestamptz);
insert into customers values('c1','Priya Sharma','98765 43210'),('c2','Arun','+91 9000000002');
insert into cc_push_subscriptions values('https://push/1','c1');
insert into inventory_items values('Milk','ml',5000,0.06,null),('Butter','kg',2,500,null),('Eggs','pcs',30,null,null);
insert into packaging_materials values('Cake box','pcs',40,12,null);`);
const ago=d=>`now()-interval '${d} days'`;
// Priya: 4 visits, last 45 days ago -> missing regular (has app). Ravi: 3 visits, last 40 days ago, no app.
// Meena: regular, visited 2 days ago. New: first visit 5 days ago. Old: last 300 days ago (too old). Cancelled orders ignored.
const ins=(ph,nm,d,items,st='collected')=>`insert into store_orders(customer_phone,customer_name,total,status,items,created_at) values('${ph}',${nm?`'${nm}'`:'null'},200,'${st}','${JSON.stringify(items)}',${ago(d)});`;
await db.exec([ins('+919876543210','Priya',120,[{name:'Brownie',qty:2}]),ins('+919876543210','Priya',90,[{name:'Brownie',qty:1}]),ins('+919876543210',null,60,[{name:'Cold Coffee',qty:1}]),ins('+919876543210','Priya',45,[{name:'Brownie',qty:1}]),
 ins('+919111111111','Ravi',100,[{name:'Cookie',qty:3}]),ins('+919111111111','Ravi',70,[]),ins('+919111111111','Ravi',40,[]),
 ins('+919222222222','Meena',50,[]),ins('+919222222222','Meena',20,[]),ins('+919222222222','Meena',2,[]),
 ins('+919333333333','New',5,[]),
 ins('+919444444444','Old',400,[]),ins('+919444444444','Old',350,[]),ins('+919444444444','Old',300,[]),
 ins('+919555555555','Gone',10,[],'cancelled')].join(''));
await db.exec(`insert into orders(customer_id,total,status,created_at) values('c2',300,'delivered',${ago(35)}),('c2',300,'delivered',${ago(50)})`);
const sql=fs.readFileSync('migrations/20260970_customer_returns_stock_count.sql','utf8');await db.exec(sql);await db.exec(sql);
const r=(await db.query('select cc_customer_returns(30) r')).rows[0].r;
assert.deepEqual(r.summary,{days:30,active:2,new:1,returning:1,total_known:6}); // Meena + New in the last 30 days
assert.deepEqual(r.missing.map(m=>[m.phone,m.visits,m.has_app,m.fav]),[['9876543210',4,true,'Brownie'],['9111111111',3,false,'Cookie']]);
assert.deepEqual(r.second_visit,{first_timers:2,came_back:2}); // Arun and Meena: first visit 50 days ago, both came back
assert.equal(r.missing[0].name,'Priya');assert.equal(r.missing[0].days_since,45);
assert.ok(r.top.some(t=>t.phone==='9222222222'));
// Win-back: Priya has the app -> push; Ravi -> WhatsApp list.
const w=(await db.query(`select cc_winback_send(array['+91 98765 43210','9111111111'],'We miss you {name}!','Your {item} is waiting 🍫') w`)).rows[0].w;
assert.equal(w.pushed,1);assert.deepEqual(w.no_app.map(x=>[x.phone,x.name]),[['9111111111','Ravi']]);
const call=(await db.query('select body from net.calls')).rows[0].body;
assert.equal(call.type,'winback');assert.deepEqual(call.messages,[{customer_id:'c1',title:'We miss you Priya!',body:'Your Brownie is waiting 🍫'}]);
await db.query(`select cc_winback_mark('9111111111','whatsapp','hi')`);
const r2=(await db.query('select cc_customer_returns(30) r')).rows[0].r;assert.ok(r2.missing.every(m=>m.messaged_at));
await assert.rejects(db.query(`select cc_winback_send(array[]::text[],'a','b')`),/Choose 1 to 200/);
// Stock count by production staff.
await db.exec(`update auth.me set id='${STAFF}'`);
await assert.rejects(db.query('select cc_customer_returns(30)'),/Only the owner/);
await assert.rejects(db.query(`select cc_winback_send(array['9111111111'],'a','b')`),/Only the owner/);
const c=(await db.query(`select cc_stock_count('[{"kind":"raw","name":"Milk","counted":4200},{"kind":"raw","name":"Butter","counted":""},{"kind":"raw","name":"Eggs","counted":32},{"kind":"packaging","name":"Cake box","counted":35}]','Sunday count','Chitra') c`)).rows[0].c;
assert.equal(c.lines,3);assert.equal(Number(c.value_gap),-48-60);
assert.deepEqual((await db.query(`select name,current_stock::float s from inventory_items order by name`)).rows,[{name:'Butter',s:2},{name:'Eggs',s:32},{name:'Milk',s:4200}]);
assert.equal(Number((await db.query(`select current_stock from packaging_materials`)).rows[0].current_stock),35);
const lines=(await db.query(`select name,expected::float e,counted::float c,gap::float g,value_gap::float v from cc_stock_count_lines order by name`)).rows;
assert.deepEqual(lines,[{name:'Cake box',e:40,c:35,g:-5,v:-60},{name:'Eggs',e:30,c:32,g:2,v:null},{name:'Milk',e:5000,c:4200,g:-800,v:-48}]);
await assert.rejects(db.query(`select cc_stock_count('[{"kind":"raw","name":"Milk","counted":-1}]')`),/0 or more/);
await assert.rejects(db.query(`select cc_stock_count('[{"kind":"raw","name":"Ghee","counted":1}]')`),/Material not found/);
await assert.rejects(db.query(`select cc_stock_count('[{"kind":"raw","name":"Milk","counted":""}]')`),/at least one/);
await db.exec(`update auth.me set id='33333333-3333-3333-3333-333333333333'`);
await assert.rejects(db.query(`select cc_stock_count('[{"kind":"raw","name":"Milk","counted":1}]')`),/Only admin or production/);
await db.close();console.log('PASS customer returns + stock count: new/returning/missing by phone (store + app orders), favourite item, win-back push vs WhatsApp, log, owner only; stock count sets stock, records gaps and value, validation and access.');
})().catch(e=>{console.error(e);process.exit(1);});

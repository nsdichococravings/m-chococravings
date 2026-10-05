const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(role text);insert into auth.me values('admin');
create function auth.uid() returns uuid language sql as $$select case when (select role from auth.me) is null then null else gen_random_uuid() end$$;
create function cc_production_role() returns text language sql as $$select role from auth.me$$;
create table inventory_items(id uuid primary key default gen_random_uuid(),name text unique,unit text,current_stock numeric,cost_per_unit numeric,updated_at timestamptz);
create table packaging_materials(id uuid primary key default gen_random_uuid(),name text unique,unit text,current_stock numeric,cost_per_unit numeric,updated_at timestamptz);
create table inventory_movements(id serial,item_id uuid references inventory_items(id));
create table cc_production_recipes(product_name text,ingredients jsonb,packaging jsonb,deleted_at timestamptz);
insert into inventory_items(name,unit,current_stock,cost_per_unit) values('Milk','ml',1000,0),('White chocolate','kg',3,0),('Old flour','kg',0,10),('Yeast','g',500,0.46);
insert into packaging_materials(name,unit,current_stock,cost_per_unit) values('Cup','pcs',10,2);
insert into inventory_movements(item_id) select id from inventory_items where name='Yeast';
insert into cc_production_recipes values('Instant Coffee','[{"name":"Milk","quantity":150,"unit":"ml"}]','[{"name":"Cup","quantity":1,"unit":"pcs"}]',null),('Old cake','[{"name":"Old flour","quantity":1,"unit":"kg"}]','[]',now());`);
const sql=fs.readFileSync('migrations/20260960_material_admin.sql','utf8');await db.exec(sql);await db.exec(sql);
const call=(a,k,n,v)=>db.query('select cc_material_admin($1,$2,$3,$4)',[a,k,n,v??null]);
await assert.rejects(call('delete','raw','Milk'),/Used in recipe: Instant Coffee/);
await assert.rejects(call('delete','packaging','Cup'),/Used in recipe: Instant Coffee/);
await call('delete','raw','Old flour'); // only a deleted recipe used it
await assert.rejects(call('delete','raw','Yeast'),/cannot be deleted/);
await assert.rejects(call('delete','raw','Nope'),/not found/);
await call('set_cost','raw','White chocolate',650);
await assert.rejects(call('set_cost','raw','Milk',-1),/0 or more/);
assert.deepEqual((await db.query("select name,cost_per_unit::float c from inventory_items order by name")).rows,[{name:'Milk',c:0},{name:'White chocolate',c:650},{name:'Yeast',c:0.46}]);
await db.exec("update auth.me set role='sales'");await assert.rejects(call('set_cost','raw','Milk',1),/Only admin or production/);
await db.close();console.log('PASS material admin: delete blocked by active recipes / history, allowed otherwise, set cost with validation, role check.');
})().catch(e=>{console.error(e);process.exit(1);});

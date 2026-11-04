const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const sql=fs.readFileSync('migrations/20261102_disk_io_indexes.sql','utf8');
(async()=>{
  const db=new PGlite();
  // A shop database with the busy tables (no cc_order_ratings table, and
  // store_orders without table_code) to check optional parts are skipped.
  await db.exec(`create table store_orders(id serial primary key,status text,created_at timestamptz default now(),customer_id uuid,customer_phone text,items jsonb,total numeric);
    create table orders(id serial primary key,customer_id uuid,status text,created_at timestamptz default now());
    create table customer_addresses(id serial primary key,customer_id uuid);
    create table store_menu(id serial primary key,available bool,sort_order int);
    create table app_settings(key text,value text);
    insert into store_orders(status,created_at) select case when g%10=0 then 'pending' else 'collected' end, now()-(g||' hours')::interval from generate_series(1,5000) g;`);
  await db.exec(sql);
  await db.exec(sql); // safe to run again
  const names=(await db.query(`select indexname from pg_indexes where schemaname='public' and indexname like 'cc_%' order by 1`)).rows.map(r=>r.indexname);
  for(const n of ['cc_store_orders_created_idx','cc_store_orders_status_created_idx','cc_store_orders_open_idx','cc_store_orders_customer_idx','cc_store_orders_phone_idx','cc_orders_customer_created_idx','cc_customer_addresses_customer_idx','cc_store_menu_available_idx','cc_app_settings_key_idx'])
    assert.ok(names.includes(n),'created '+n);
  assert.ok(!names.includes('cc_store_orders_table_idx'),'skipped: no table_code column');
  assert.ok(!names.includes('cc_order_ratings_order_idx'),'skipped: no cc_order_ratings table');
  // The Kitchen query (today's open orders) now uses an index instead of reading every order.
  await db.exec('set enable_seqscan = off');
  const plan=(await db.query(`explain select * from store_orders where created_at >= now()-interval '1 day' and status in ('pending','preparing','ready') order by created_at`)).rows.map(r=>r['QUERY PLAN']).join('\n');
  assert.match(plan,/Index/,'kitchen query can use an index:\n'+plan);
  console.log('PASS: indexes created, re-run safe, missing tables/columns skipped, kitchen query uses an index.');
})().catch(e=>{console.error(e);process.exitCode=1;});

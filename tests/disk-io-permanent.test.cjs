/* Run: node tests/disk-io-permanent.test.cjs */
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');
const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261105_disk_io_permanent.sql'), 'utf8');
const old = fs.readFileSync(path.join(__dirname, '../migrations/20260954_store_menu_photos_ratings.sql'), 'utf8');

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table store_orders(id uuid primary key default gen_random_uuid(), status text, created_at timestamptz default now(),
      customer_id uuid, customer_phone text, items jsonb, total numeric);
    create table customers(id uuid primary key default gen_random_uuid(), email text, phone text, is_admin boolean);
    create index idx_customers_email on customers(email);
    create table cc_loyalty_members(id uuid primary key default gen_random_uuid(), phone text, stamp_count int default 0, suspended boolean default false);
    create table cc_loyalty_stamp_log(id bigserial primary key, member_id uuid, created_at timestamptz default now());
    create table store_menu(id serial primary key, name text, available bool, sort_order int);
    create table app_settings(key text, value text);
    create table cc_store_order_ratings(order_id text primary key, stars int, comment text, updated_at timestamptz default now());
    create or replace function cc_store_items(p jsonb) returns jsonb language plpgsql immutable as $$
    begin if p is null then return '[]'::jsonb; end if;
      if jsonb_typeof(p)='string' then p := (p #>> '{}')::jsonb; end if;
      if jsonb_typeof(p)<>'array' then return '[]'::jsonb; end if; return p;
    exception when others then return '[]'::jsonb; end $$;
    insert into customers(email, phone) select 'user' || g || '@x.test', '98765' || lpad(g::text, 5, '0') from generate_series(1, 3000) g;
    insert into cc_loyalty_members(phone) select '+91 98765 ' || lpad(g::text, 5, '0') from generate_series(1, 2000) g;
    -- 6000 orders over a year; items as JSON arrays (some stored as a JSON string, like old rows)
    insert into store_orders(status, created_at, items)
    select case when g % 17 = 0 then 'cancelled' else 'collected' end, now() - ((g % 365) || ' days')::interval - ((g % 24) || ' hours')::interval,
      case when g % 5 = 0 then to_jsonb(json_build_array(json_build_object('name', 'Brownie', 'qty', 2), json_build_object('name', 'Latte'))::text)
           else jsonb_build_array(jsonb_build_object('name', (array['Brownie','Latte','Cold Coffee','Blondie'])[1 + g % 4], 'qty', 1 + g % 3)) end
    from generate_series(1, 6000) g;
    -- ratings on old and new orders
    insert into cc_store_order_ratings(order_id, stars) select id::text, 1 + (abs(hashtext(id::text)) % 5) from store_orders where random() < 0.08;
  `);

  // Reference: the old function's results.
  const oldFn = old.slice(old.indexOf('create or replace function public.cc_store_menu_stats()'), old.indexOf('$$;', old.indexOf('create or replace function public.cc_store_menu_stats()')) + 3);
  await db.exec(oldFn);
  const norm = rows => rows.map(r => [r.name, r.avg_stars == null ? null : Number(r.avg_stars), r.rating_count, r.sold_30d]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const before = norm((await db.query('select * from cc_store_menu_stats()')).rows);
  assert.ok(before.length >= 4);

  await db.exec(sql);
  await db.exec(sql); // safe to run again
  const after = norm((await db.query('select * from cc_store_menu_stats()')).rows);
  assert.deepEqual(after, before, 'same stars and 30-day sales as before');

  // Saved copy: a new order does not trigger a full recount on every visit...
  await db.exec(`insert into store_orders(status, items) values ('collected', '[{"name":"Brownie","qty":50}]')`);
  const cached = norm((await db.query('select * from cc_store_menu_stats()')).rows);
  assert.deepEqual(cached, before, 'served from the saved copy');
  // ...and is counted once the copy is 15 minutes old.
  await db.exec(`update cc_store_menu_stats_meta set refreshed_at = now() - interval '16 minutes'`);
  const fresh = (await db.query(`select sold_30d from cc_store_menu_stats() where name='Brownie'`)).rows[0].sold_30d;
  const prev = before.find(r => r[0] === 'Brownie')[3];
  assert.equal(fresh, prev + 50, 'refreshed after 15 minutes');

  // Customers and anon cannot read the saved tables directly.
  await db.exec('set role anon');
  await assert.rejects(db.query('select * from cc_store_menu_stats_cache'), /permission denied/);
  await db.exec('reset role');

  // Indexes exist and are used.
  const idx = (await db.query(`select indexname from pg_indexes where schemaname='public' and indexname like 'cc_%'`)).rows.map(r => r.indexname);
  for (const n of ['cc_store_orders_created_idx', 'cc_store_orders_id_text_idx', 'cc_customers_email_lower_idx', 'cc_loyalty_members_phone10_idx', 'cc_loyalty_stamp_log_member_idx'])
    assert.ok(idx.includes(n), 'created ' + n);
  assert.ok(!idx.includes('cc_customers_email_idx'), 'no duplicate: customers.email already had an index');
  await db.exec('set enable_seqscan = off');
  const plan = async q => (await db.query('explain ' + q)).rows.map(r => r['QUERY PLAN']).join('\n');
  assert.match(await plan(`select * from customers where lower(email) = lower('User5@x.test')`), /cc_customers_email_lower_idx/);
  assert.match(await plan(`select * from cc_loyalty_members where right(regexp_replace(phone,'[^0-9]','','g'),10) = '9876500042'`), /cc_loyalty_members_phone10_idx/);
  assert.match(await plan(`select * from store_orders where id::text = 'abc'`), /cc_store_orders_id_text_idx/);
  assert.match(await plan(`select 1 from cc_loyalty_stamp_log where member_id = gen_random_uuid() and created_at > now() - interval '1 day'`), /cc_loyalty_stamp_log_member_idx/);

  // Missing optional tables are skipped, not errors.
  const db2 = new PGlite();
  await db2.exec(`create role anon; create role authenticated;
    create table store_orders(id uuid primary key default gen_random_uuid(), status text, created_at timestamptz default now(), items jsonb);
    create table cc_store_order_ratings(order_id text primary key, stars int);
    create function cc_store_items(p jsonb) returns jsonb language sql immutable as $$ select coalesce(p,'[]'::jsonb) $$;`);
  await db2.exec(sql);

  console.log('PASS: same menu stats, saved copy refreshes every 15 min, indexes used, re-run safe, missing tables skipped.');
})().catch(e => { console.error(e); process.exitCode = 1; });

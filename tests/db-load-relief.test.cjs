/* Cached product ratings give the same answer. Run: node tests/db-load-relief.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.orders(id uuid primary key default gen_random_uuid());
    create table public.order_items(id serial primary key, order_id uuid, product_id uuid);
    create table public.cc_order_ratings(order_id text primary key, customer_id text not null, stars smallint not null);
    -- the old function, for comparison
    create function public.old_ratings() returns table(product_id text, avg_stars numeric, rating_count int) language sql as $$
     select oi.product_id::text, round(avg(r.stars)::numeric,1), count(distinct r.order_id)::int
     from public.cc_order_ratings r join public.orders o on o.id::text=r.order_id
     join public.order_items oi on oi.order_id::text=r.order_id where oi.product_id is not null group by oi.product_id::text $$;
  `);
  const p = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
  for (let i = 0; i < 6; i++) {
    const o = (await db.query('insert into orders default values returning id::text id')).rows[0].id;
    await db.query('insert into order_items(order_id, product_id) values ($1,$2)', [o, p[i % 2]]);
    if (i % 3 === 0) await db.query('insert into order_items(order_id, product_id) values ($1,$2)', [o, p[(i + 1) % 2]]);
    if (i < 5) await db.query('insert into cc_order_ratings values ($1,$2,$3)', [o, 'c' + i, 1 + i]);
  }
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261122_db_load_relief.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  const norm = (rows) => rows.map((r) => [r.product_id, String(r.avg_stars), r.rating_count]).sort();
  const want = async () => norm((await db.query('select * from old_ratings()')).rows);
  const got = async () => norm((await db.query('select * from cc_product_ratings()')).rows);
  assert.deepEqual(await got(), await want(), 'same answer as before');
  // Saved copy is used: change data behind its back (no trigger fires on order_items)
  const at1 = (await db.query("select refreshed_at from cc_cache_meta where key='product_ratings'")).rows[0].refreshed_at;
  await db.query('select * from cc_product_ratings()');
  const at2 = (await db.query("select refreshed_at from cc_cache_meta where key='product_ratings'")).rows[0].refreshed_at;
  assert.equal(+at1, +at2, 'second call reads the saved copy');
  // A new rating refreshes it
  const o6 = (await db.query('select o.id::text id from orders o where not exists(select 1 from cc_order_ratings r where r.order_id=o.id::text) limit 1')).rows[0].id;
  await db.query('insert into cc_order_ratings values ($1,$2,5)', [o6, 'c9']);
  assert.deepEqual(await got(), await want(), 'new rating shows straight away');
  await db.query("update cc_order_ratings set stars = 1 where customer_id='c0'");
  assert.deepEqual(await got(), await want(), 'changed rating shows straight away');
  console.log('db-load-relief: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

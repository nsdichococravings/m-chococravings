/* One customer's open orders at one table. Run: node tests/customer-table-merge.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.store_orders(id uuid primary key default gen_random_uuid(), token text, customer_phone text,
      customer_table text, table_code text, status text default 'pending', created_at timestamptz default now(), items jsonb, total numeric);
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261115_customer_table_merge.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec('grant usage on schema public to anon');
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const add = async (o) => (await q(`insert into store_orders(token,customer_phone,customer_table,table_code,status,created_at)
     values ($1,$2,$3,$4,coalesce($5,'pending'),coalesce($6::timestamptz,now())) returning id`,
     [o.token, o.phone || null, o.table || null, o.code || null, o.status || null, o.at || null]))[0].id;
  const asAnon = async (fn, a) => { await db.exec('set role anon'); try { return (await q(`select public.${fn}($1) r`, [a]))[0].r; } finally { await db.exec('reset role'); } };
  const tableOf = async (id) => (await q('select customer_table from store_orders where id=$1', [id]))[0].customer_table;

  // Nothing open
  assert.equal(await asAnon('cc_customer_open_table', '9000000001'), null);
  assert.equal(await asAnon('cc_customer_open_table', '123'), null, 'needs 10 digits');

  // Asha has orders at T2 (older) and T3 (newer)
  const a1 = await add({ token: 'T-001', phone: '+91 90000 00001', table: 'T2', at: new Date(Date.now() - 3600e3).toISOString() });
  const a2 = await add({ token: 'T-002', phone: '9000000001', table: 'T3' });
  const takeaway = await add({ token: 'T-003', phone: '9000000001', table: 'TAKEAWAY' });
  const done = await add({ token: 'T-000', phone: '9000000001', table: 'T1', status: 'collected' });
  const old = await add({ token: 'T-OLD', phone: '9000000001', table: 'SL', at: new Date(Date.now() - 6 * 3600e3).toISOString() });
  const bala = await add({ token: 'T-004', phone: '9000000002', table: 'BS' });
  let found = await asAnon('cc_customer_open_table', '09000000001');
  assert.deepEqual(found, { table: 'T3', token: 'T-002', orders: 2 }, 'newest open table, collected/takeaway/old ignored');

  // She says yes: the new order goes to T3, and T2 is freed
  const a3 = await add({ token: 'T-005', phone: '+919000000001', table: 'T3' });
  const r = await asAnon('cc_merge_customer_table', a3);
  assert.deepEqual(r, { table: 'T3', moved: 1 });
  assert.equal(await tableOf(a1), 'T3', 'T2 freed');
  assert.equal(await tableOf(a2), 'T3');
  assert.equal(await tableOf(takeaway), 'TAKEAWAY', 'takeaway untouched');
  assert.equal(await tableOf(done), 'T1', 'collected untouched');
  assert.equal(await tableOf(old), 'SL', 'old orders untouched');
  assert.equal(await tableOf(bala), 'BS', 'other customers untouched');
  assert.deepEqual(await asAnon('cc_merge_customer_table', a3), { table: 'T3', moved: 0 }, 'runs twice safely');

  // A staff table bill wins and is never moved
  const bill = await add({ token: 'TB', phone: '9000000003', code: 't4' });
  const c1 = await add({ token: 'T-006', phone: '9000000003', table: 'T1' });
  found = await asAnon('cc_customer_open_table', '9000000003');
  assert.equal(found.table, 'T4', 'seated at the staff table bill');
  const c2 = await add({ token: 'T-007', phone: '9000000003', table: 'T4' });
  assert.equal((await asAnon('cc_merge_customer_table', c2)).moved, 1);
  assert.equal(await tableOf(c1), 'T4');
  assert.equal((await q('select table_code, customer_table from store_orders where id=$1', [bill]))[0].table_code, 't4', 'table bill untouched');

  // Only right after placing the order
  const late = await add({ token: 'T-008', phone: '9000000002', table: 'DC', at: new Date(Date.now() - 3600e3).toISOString() });
  assert.equal((await asAnon('cc_merge_customer_table', late)).moved, 0);
  assert.equal(await tableOf(bala), 'BS');
  await assert.rejects(asAnon('cc_merge_customer_table', '00000000-0000-0000-0000-000000000000'), /not found/);
  console.log('customer-table-merge: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

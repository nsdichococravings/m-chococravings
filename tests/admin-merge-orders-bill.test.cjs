/* Kitchen: admin merges one number's open orders into one bill. Run: node tests/admin-merge-orders-bill.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const ids = { admin: randomUUID(), staff: randomUUID() };
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id text primary key, email text, is_admin boolean default false, is_employee boolean default false, is_super_user boolean default false);
    insert into auth.users values ('${ids.admin}','a@x.t',now()),('${ids.staff}','s@x.t',now());
    insert into public.customers values ('1','a@x.t',true,false,false),('2','s@x.t',false,true,false);
    create table public.store_orders(id uuid primary key default gen_random_uuid(), token text, customer_phone text, customer_table text, table_code text,
      status text default 'pending', payment_method text default 'cash', payment_status text default 'pending', razorpay_payment_id text,
      items jsonb, total numeric, created_at timestamptz default now());
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261119_admin_merge_orders_bill.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec('grant usage on schema public to anon, authenticated');
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const add = async (o) => (await q(`insert into store_orders(token,customer_phone,customer_table,table_code,status,payment_method,payment_status,razorpay_payment_id,items,total,created_at)
     values ($1,$2,$3,$4,coalesce($5,'pending'),coalesce($6,'cash'),coalesce($7,'pending'),$8,$9::jsonb,$10,now() - ($11 || ' minutes')::interval) returning id`,
     [o.token, o.phone, o.table || 'T1', o.code || null, o.status || null, o.pm || null, o.ps || null, o.rzp || null, JSON.stringify(o.items), o.total, String(o.ago || 0)]))[0].id;
  async function as(who) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ? ids[who] : '']); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
  const merge = async (who, list) => { await as(who); try { return (await q('select public.cc_admin_merge_orders($1::uuid[]) r', [list]))[0].r; } finally { await db.exec('reset role'); } };
  const get = async (id) => (await q('select * from store_orders where id=$1', [id]))[0];

  // Table 1: the same customer ordered twice (the double tap), plus a third order.
  const a = await add({ token: 'T-011', phone: '+91 90000 00001', items: [{ name: 'Cold Coffee', qty: 2, price: 89 }], total: 178, ago: 20 });
  const b = await add({ token: 'T-012', phone: '9000000001', items: [{ name: 'Cold Coffee', qty: 2, price: 89 }], total: 178, ago: 19, status: 'preparing' });
  const c = await add({ token: 'T-014', phone: '09000000001', table: 'T3', items: '[{"name":"Fudge Brownie","qty":1,"price":60}]', total: 60, ago: 5 });
  const paid = await add({ token: 'T-015', phone: '9000000001', pm: 'upi', ps: 'paid', rzp: 'pay_1', items: [{ name: 'Mocha', qty: 1, price: 120 }], total: 120, ago: 3 });
  const other = await add({ token: 'T-016', phone: '9000000002', items: [{ name: 'Mocha', qty: 1, price: 120 }], total: 120 });

  await assert.rejects(merge(null, [a, b]), /permission denied|Only an admin/);
  await assert.rejects(merge('staff', [a, b]), /Only an admin/);
  await assert.rejects(merge('admin', [a]), /at least two/);
  await assert.rejects(merge('admin', [a, other]), /same mobile number/);
  await assert.rejects(merge('admin', [a, paid]), /paid and an unpaid/, 'never mixes paid and unpaid');

  const r = await merge('admin', [c, b, a]);
  assert.deepEqual(r, { order_id: a, token: 'T-011', merged: 2, total: 416 }, 'the oldest order becomes the bill');
  const bill = await get(a);
  assert.equal(Number(bill.total), 416);
  assert.equal(bill.status, 'pending', 'as far along as the least advanced order');
  assert.equal(bill.customer_table, 'T1');
  assert.deepEqual(bill.items, [{ name: 'Cold Coffee', price: 89, qty: 4 }, { name: 'Fudge Brownie', price: 60, qty: 1 }], 'same item + price on one line, string items read too');
  assert.deepEqual(bill.merged_from.map(m => m.token), ['T-012', 'T-014']);
  for (const id of [b, c]) { const o = await get(id); assert.equal(o.status, 'cancelled'); assert.equal(o.merged_into, a); }
  assert.equal((await get(paid)).status, 'pending', 'the paid order is left alone');
  assert.equal((await get(other)).merged_into, null, 'other customers untouched');
  await assert.rejects(merge('admin', [a, b]), /already closed/, 'merged orders can\'t be merged again');

  // Two paid orders can be merged too (one ticket); payment ids are kept.
  const p2 = await add({ token: 'T-017', phone: '9000000001', pm: 'upi', ps: 'paid', rzp: 'pay_2', items: [{ name: 'Mocha', qty: 1, price: 120 }], total: 120, ago: 1 });
  const rp = await merge('admin', [paid, p2]);
  assert.equal(rp.order_id, paid); assert.equal(Number(rp.total), 240);
  const pb = await get(paid);
  assert.equal(pb.payment_status, 'paid'); assert.equal(pb.razorpay_payment_id, 'pay_1');
  assert.equal(pb.merged_from[0].razorpay_payment_id, 'pay_2', 'the other payment id is kept');
  assert.deepEqual(pb.items, [{ name: 'Mocha', price: 120, qty: 2 }]);

  // Staff table bills are not merged here.
  const t1 = await add({ token: 'TB1', phone: '9000000003', code: 'T2', items: [], total: 0, ago: 2 });
  const t2 = await add({ token: 'T-018', phone: '9000000003', items: [], total: 0 });
  await assert.rejects(merge('admin', [t1, t2]), /table bills/);
  console.log('admin-merge-orders-bill: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

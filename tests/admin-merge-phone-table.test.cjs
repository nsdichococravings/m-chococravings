/* Kitchen: admin merges one number's open orders to one table. Run: node tests/admin-merge-phone-table.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const ids = { admin: randomUUID(), owner: randomUUID(), staff: randomUUID(), cust: randomUUID(), fake: randomUUID() };
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id text primary key, email text, is_admin boolean default false, is_employee boolean default false, is_super_user boolean default false);
    insert into auth.users values ('${ids.admin}','a@x.t',now()),('${ids.owner}','o@x.t',now()),('${ids.staff}','s@x.t',now()),('${ids.cust}','c@x.t',now()),('${ids.fake}','f@x.t',null);
    insert into public.customers values ('1','a@x.t',true,false,false),('2','o@x.t',false,false,true),('3','s@x.t',false,true,false),('4','c@x.t',false,false,false),('5','f@x.t',true,false,false);
    create table public.store_orders(id uuid primary key default gen_random_uuid(), token text, customer_phone text, customer_table text, table_code text, status text default 'pending', created_at timestamptz default now());
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261116_admin_merge_phone_table.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec('grant usage on schema public to anon, authenticated');
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  const add = async (phone, table, opts = {}) => (await q(`insert into store_orders(token,customer_phone,customer_table,table_code,status,created_at)
     values ('t',$1,$2,$3,coalesce($4,'pending'),now() - coalesce($5,'0')::interval) returning id`, [phone, table, opts.code || null, opts.status || null, opts.ago || null]))[0].id;
  async function as(who) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ? ids[who] : '']); await db.exec(who ? 'set role authenticated' : 'set role anon'); }
  const merge = async (who, phone, t) => { await as(who); try { return (await q('select public.cc_admin_merge_phone_table($1,$2) r', [phone, t]))[0].r; } finally { await db.exec('reset role'); } };
  const tbl = async (id) => (await q('select customer_table, table_code from store_orders where id=$1', [id]))[0];

  // The kitchen today: one number with 3 open orders at 3 tables (one from yesterday evening)
  const o1 = await add('+91 90000 00001', 'T1', { ago: '20 hours' });
  const o2 = await add('9000000001', 'T3');
  const o3 = await add('09000000001', 'SL');
  const gone = await add('9000000001', 'BS', { status: 'collected' });
  const bill = await add('9000000001', null, { code: 'T2' });
  const other = await add('9000000002', 'DC');

  await assert.rejects(merge(null, '9000000001', 'T1'), /permission denied|Only an admin/);
  for (const who of ['staff', 'cust', 'fake']) await assert.rejects(merge(who, '9000000001', 'T1'), /Only an admin/, who);
  await assert.rejects(merge('admin', '123', 'T1'), /10-digit/);
  await assert.rejects(merge('admin', '9000000001', 'T9'), /Unknown table/);

  assert.deepEqual(await merge('admin', '9000000001', 't3'), { table: 'T3', moved: 2 });
  for (const id of [o1, o2, o3]) assert.equal((await tbl(id)).customer_table, 'T3', 'all open orders at T3, even older ones');
  assert.equal((await tbl(gone)).customer_table, 'BS', 'collected orders untouched');
  assert.deepEqual(await tbl(bill), { customer_table: null, table_code: 'T2' }, 'staff table bill untouched');
  assert.equal((await tbl(other)).customer_table, 'DC', 'other customers untouched');
  assert.deepEqual(await merge('owner', '9000000001', 'T3'), { table: 'T3', moved: 0 }, 'super admin allowed; nothing left to move');
  console.log('admin-merge-phone-table: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

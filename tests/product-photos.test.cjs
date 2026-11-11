/* Admins set product photos. Run: node tests/product-photos.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  const ids = { admin: randomUUID(), owner: randomUUID(), cust: randomUUID(), fake: randomUUID() };
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id text primary key, email text, is_admin boolean default false, is_super_user boolean default false);
    insert into auth.users values ('${ids.admin}','a@x.t',now()),('${ids.owner}','o@x.t',now()),('${ids.cust}','c@x.t',now()),('${ids.fake}','f@x.t',null);
    insert into public.customers values ('1','a@x.t',true,false),('2','o@x.t',false,true),('3','c@x.t',false,false),('4','f@x.t',true,false);
    create table public.products(id uuid primary key default gen_random_uuid(), sku text, name text);
    insert into public.products(sku,name) values ('PREM-EL-CLASSIC','Classic'),('PREM-EG-CLASSIC','Classic (egg)');
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261120_product_photos.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec('grant usage on schema public to anon, authenticated');
  const pid = (await db.query("select id::text id from products where sku='PREM-EL-CLASSIC'")).rows[0].id;
  async function call(who, url, id = pid) {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ? ids[who] : '']);
    await db.exec(who ? 'set role authenticated' : 'set role anon');
    try { return (await db.query('select public.cc_admin_set_product_image($1,$2) r', [id, url])).rows[0].r; } finally { await db.exec('reset role'); }
  }
  const url = 'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/uploads/PREM-EL-CLASSIC-1.jpg';
  await assert.rejects(call(null, url), /permission denied|Only an admin/);
  for (const w of ['cust', 'fake']) await assert.rejects(call(w, url), /Only an admin/, w);
  await assert.rejects(call('admin', 'http://evil.test/x.jpg'), /not valid/);
  await assert.rejects(call('admin', url, randomUUID()), /not found/);
  assert.deepEqual(await call('admin', url), { id: pid, sku: 'PREM-EL-CLASSIC', image_url: url });
  assert.equal((await call('owner', url + '?v=2')).image_url, url + '?v=2', 'super admin too');
  assert.equal((await db.query("select image_url from products where sku='PREM-EG-CLASSIC'")).rows[0].image_url, null, 'only that product changes');
  assert.equal((await call('admin', '')).image_url, null, 'empty clears it (back to the built-in photo)');
  console.log('product-photos: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

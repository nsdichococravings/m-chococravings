/* Admin photo uploads pass storage rules. Run: node tests/photo-upload-policies.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async () => {
  const db = new PGlite();
  const ids = { admin: randomUUID(), owner: randomUUID(), caps: randomUUID(), cust: randomUUID() };
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id text primary key, email text, is_admin boolean default false, is_super_user boolean default false);
    insert into auth.users values ('${ids.admin}','a@x.t',now()),('${ids.owner}','o@x.t',now()),('${ids.caps}','Boss@X.t',now()),('${ids.cust}','c@x.t',now());
    insert into public.customers values ('1','a@x.t',true,false),('2','o@x.t',false,true),('3','boss@x.t',true,false),('4','c@x.t',false,false);
    create table public.products(id uuid primary key default gen_random_uuid(), sku text);
    create schema storage; grant usage on schema storage to authenticated;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.objects to authenticated;
    -- the old rule, as migration 20260954 left it
    create policy "cc menu photos admin insert" on storage.objects for insert to authenticated
     with check (bucket_id='menu-photos' and exists(select 1 from public.customers c where c.email='x' and c.is_admin));
  `);
  await db.exec(fs.readFileSync(path.join(__dirname, '../migrations/20261120_product_photos.sql'), 'utf8'));
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261121_photo_upload_fix.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec('grant usage on schema public to authenticated');
  async function upload(who, bucket) {
    await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids[who]]);
    await db.exec('set role authenticated');
    try { await db.query('insert into storage.objects(bucket_id,name) values ($1,$2)', [bucket, who + '-' + Date.now() + '.jpg']); return true; }
    catch (e) { if (/row-level security/.test(e.message)) return false; throw e; } finally { await db.exec('reset role'); }
  }
  for (const b of ['menu-photos', 'product-images']) {
    assert.equal(await upload('admin', b), true, 'admin ' + b);
    assert.equal(await upload('owner', b), true, 'super admin ' + b);
    assert.equal(await upload('caps', b), true, 'email with capitals ' + b);
    assert.equal(await upload('cust', b), false, 'customer refused ' + b);
  }
  assert.equal(await upload('admin', 'other-bucket'), false, 'other buckets untouched');
  console.log('photo-upload-policies: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

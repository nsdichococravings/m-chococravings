/* Staff tab access managed from the app. Run: node tests/staff-app-access.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const ids = { owner: randomUUID(), admin: randomUUID(), admin2: randomUUID(), staff: randomUUID(), cust: randomUUID(), unconfirmed: randomUUID() };
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id text primary key, name text, phone text, email text,
      is_admin boolean default false, is_employee boolean default false, is_super_user boolean default false);
    insert into auth.users values
      ('${ids.owner}','owner@x.test',now()),('${ids.admin}','admin@x.test',now()),('${ids.admin2}','admin2@x.test',now()),
      ('${ids.staff}','staff@x.test',now()),('${ids.cust}','cust@x.test',now()),('${ids.unconfirmed}','fake@x.test',null);
    insert into public.customers values
      ('c1','Owner','+91 90000 00001','owner@x.test',true,false,true),
      ('c2','Admin','9000000002','admin@x.test',true,false,false),
      ('c3','Admin Two','9000000003','admin2@x.test',true,false,false),
      ('c4','Chitra','9000000004','staff@x.test',false,true,false),
      ('c5','Asha','9000000005','cust@x.test',false,false,false),
      ('c6','Fake','9000000006','fake@x.test',true,false,false);
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261113_staff_app_access.sql'), 'utf8');
  await db.exec(sql); await db.exec(sql);
  await db.exec('grant usage on schema public to anon, authenticated');

  async function as(who) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ? ids[who] : '']);
    await db.exec(who ? 'set role authenticated' : 'set role anon');
  }
  const rpc = async (fn, args = []) => (await db.query(`select public.${fn}(${args.map((_, i) => '$' + (i + 1)).join(',')}) r`, args)).rows[0].r;
  const flags = async (id) => { await db.exec('reset role'); return (await db.query('select is_employee, is_admin from customers where id=$1', [id])).rows[0]; };

  // Who can use it
  await as(null); await assert.rejects(rpc('cc_admin_staff_accounts'), /permission denied|do not have access/);
  for (const who of ['cust', 'staff', 'unconfirmed']) { await as(who); await assert.rejects(rpc('cc_admin_staff_accounts'), /do not have access/, who); }
  await as('admin');
  const list = await rpc('cc_admin_staff_accounts');
  assert.equal(list.caller, 'admin');
  assert.deepEqual(list.accounts.map(a => a.id).sort(), ['c1', 'c2', 'c3', 'c4', 'c6'], 'everyone with a staff flag, not plain customers');

  // Removing Chitra's Staff tab
  const after = await rpc('cc_admin_set_staff_access', ['c4', 'employee', false]);
  assert.deepEqual(await flags('c4'), { is_employee: false, is_admin: false });
  assert.ok(!after.accounts.some(a => a.id === 'c4'), 'she drops off the list');

  // Giving access by phone
  await rpc('cc_admin_grant_staff_by_phone', ['+91 90000-00005']);
  assert.equal((await flags('c5')).is_employee, true);
  await as('admin');
  await assert.rejects(rpc('cc_admin_grant_staff_by_phone', ['12345']), /10-digit/);
  await assert.rejects(rpc('cc_admin_grant_staff_by_phone', ['9999999999']), /No customer account/);

  // Admin limits
  await assert.rejects(rpc('cc_admin_set_staff_access', ['c3', 'admin', false]), /Only the super admin/);
  await assert.rejects(rpc('cc_admin_set_staff_access', ['c1', 'employee', true]), /super admin/);
  await assert.rejects(rpc('cc_admin_set_staff_access', ['c5', 'owner', true]), /Unknown access type/);
  await assert.rejects(rpc('cc_admin_set_staff_access', ['nope', 'employee', false]), /not found/);

  // Super admin
  await as('owner');
  assert.equal((await rpc('cc_admin_staff_accounts')).caller, 'super');
  await rpc('cc_admin_set_staff_access', ['c3', 'admin', false]);
  assert.equal((await flags('c3')).is_admin, false);
  await assert.rejects(rpc('cc_admin_set_staff_access', ['c1', 'admin', false]), /super admin/);

  // Only the two flags change
  await db.exec('reset role');
  assert.deepEqual((await db.query('select is_super_user from customers order by id')).rows.map(r => r.is_super_user), [true, false, false, false, false, false]);
  console.log('staff-app-access: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
// Database: admin only, known values only, safe to re-run.
const db=new PGlite();await db.exec(`create role anon;create role authenticated;create schema auth;
create table auth.me(id uuid);insert into auth.me values('11111111-1111-1111-1111-111111111111');
create function auth.uid() returns uuid language sql as $$select id from auth.me$$;
create table roles(r text);insert into roles values('admin');
create function cc_loyalty_role() returns text language sql as $$select r from roles$$;
create table app_settings(key text primary key,value text);`);
const sql=fs.readFileSync('migrations/20261111_festive_theme.sql','utf8');await db.exec(sql);
await db.exec(`update app_settings set value='diwali' where key='festive_theme'`);await db.exec(sql);
assert.equal((await db.query(`select value from app_settings where key='festive_theme'`)).rows[0].value,'diwali','re-run keeps the choice');
await db.query(`select cc_set_festive_theme('holi')`);
assert.equal((await db.query(`select value from app_settings where key='festive_theme'`)).rows[0].value,'holi');
await assert.rejects(db.query(`select cc_set_festive_theme('<script>')`),/Unknown theme/);
await db.exec(`update roles set r='staff'`);
await assert.rejects(db.query(`select cc_set_festive_theme('off')`),/Admin access required/);
await db.close();
// Calendar: which theme shows on which India date.
const ctx={window:{},document:{readyState:'loading',addEventListener(){},getElementById(){return null}},setInterval(){},localStorage:{getItem(){return null},setItem(){}}};ctx.window=ctx;
vm.createContext(ctx);vm.runInContext(fs.readFileSync('festive-theme.js','utf8'),ctx);
const a=ctx.ccFestive.autoTheme;
assert.equal(a('2026-11-05'),'diwali');assert.equal(a('2026-11-08'),'diwali');assert.equal(a('2026-11-13'),null);
assert.equal(a('2027-10-29'),'diwali');assert.equal(a('2026-12-25'),'christmas');assert.equal(a('2026-12-31'),'newyear');
assert.equal(a('2027-01-02'),'newyear');assert.equal(a('2027-01-15'),'pongal');assert.equal(a('2027-08-15'),'independence');
assert.equal(a('2027-02-14'),'valentine');assert.equal(a('2027-04-14'),'tamilnewyear');assert.equal(a('2027-03-10'),null);
// Every calendar entry points at a real theme, and the database accepts every theme id.
const ids=Object.keys(ctx.ccFestive.themes);for(const id of ids)assert.ok(sql.includes(`'${id}'`),'migration allows '+id);
console.log('PASS festive theme: dates, admin-only setting, allowed values.');
})().catch(e=>{console.error(e);process.exit(1);});

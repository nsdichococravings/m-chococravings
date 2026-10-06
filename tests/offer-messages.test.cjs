const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;`);
const sql=fs.readFileSync('migrations/20260976_offer_messages.sql','utf8');await db.exec(sql);await db.exec(sql);
await db.exec(`insert into cc_broadcasts(title,body,created_at) values('New','Free brownie',now()),('Old','Expired',now()-interval '60 days');
grant usage on schema public to anon;`);
await db.exec('set role anon');
assert.deepEqual((await db.query('select title from cc_broadcasts')).rows,[{title:'New'}]);
await assert.rejects(db.query(`insert into cc_broadcasts(title,body) values('x','y')`),/permission denied/);
await db.close();console.log('PASS offer messages: public read of last 45 days, no public writes.');
})().catch(e=>{console.error(e);process.exit(1);});

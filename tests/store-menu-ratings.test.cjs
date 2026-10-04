const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../.production-test-runtime/node_modules/@electric-sql/pglite');
(async()=>{
const db=new PGlite();await db.exec(`create role anon;create role authenticated;
create table store_menu(id uuid primary key default gen_random_uuid(),name text,price numeric,category text);
create table store_orders(id uuid primary key default gen_random_uuid(),items jsonb,status text,created_at timestamptz default now());`);
const sql=fs.readFileSync('migrations/20260954_store_menu_photos_ratings.sql','utf8');
await db.exec(sql);await db.exec(sql); // re-runnable, no storage schema here
await db.exec(`insert into store_menu(name,price,category) values('Cold Coffee',89,'Coffee')`);
await db.exec(`update store_menu set image_url='https://x/y.jpg',egg_type='eggless',is_new=true`);
await assert.rejects(db.exec(`update store_menu set egg_type='vegan'`),/check/);
const ins=async(items,status,ago)=>(await db.query(`insert into store_orders(items,status,created_at) values($1::jsonb,$2,now()-($3||' days')::interval) returning id`,[items,status,String(ago||0)])).rows[0].id;
const a=await ins(JSON.stringify([{name:'Cold Coffee',qty:2,price:89},{name:'Brownie',qty:1,price:80}]),'collected');
const b=await ins(JSON.stringify(JSON.stringify([{name:'cold coffee ',qty:1,price:89}])),'ready'); // stringified (Tables board)
const c=await ins(JSON.stringify([{name:'Cold Coffee',qty:5}]),'cancelled');
const d=await ins(JSON.stringify([{name:'Cold Coffee',qty:3}]),'collected',40); // too old for sales, still ratable? no (3 days)
const e=await ins(JSON.stringify([{name:'Brownie',qty:1}]),'pending');
await ins('"not json"','collected');await ins('null','collected');

await assert.rejects(db.query(`select cc_rate_store_order($1,5)`,[e]),/once it is ready/);
await assert.rejects(db.query(`select cc_rate_store_order($1,5)`,[d]),/closed/);
await assert.rejects(db.query(`select cc_rate_store_order('nope',5)`),/not found/);
await assert.rejects(db.query(`select cc_rate_store_order($1,0)`,[a]),/1 to 5/);
await db.query(`select cc_rate_store_order($1,3,'  ')`,[a]);
await db.query(`select cc_rate_store_order($1,5,'Lovely')`,[a]); // change rating
await db.query(`select cc_rate_store_order($1,4)`,[b]);
assert.deepEqual((await db.query(`select cc_store_order_rating($1) v`,[a])).rows[0].v,{stars:5,comment:'Lovely'});

const stats=Object.fromEntries((await db.query('select * from cc_store_menu_stats()')).rows.map(r=>[r.name.toLowerCase().trim(),[r.avg_stars===null?null:Number(r.avg_stars),r.rating_count,r.sold_30d]]));
assert.deepEqual(stats['cold coffee'],[4.5,2,3]);   // a(2)+b(1) sold; cancelled & 40-day-old excluded; rated 5 and 4
assert.deepEqual(stats['brownie'],[5,1,2]);         // a(1)+e(1) sold; rated via order a
await db.exec('set role anon');await assert.rejects(db.query('select * from cc_store_order_ratings'),/permission denied/);
assert.equal((await db.query('select count(*)::int n from cc_store_menu_stats()')).rows[0].n,2);await db.exec('reset role');
await db.close();console.log('PASS store menu ratings: new columns, egg check, rate rules, re-rate, both item formats, 30-day sales, private table.');
})().catch(e=>{console.error(e);process.exit(1);});

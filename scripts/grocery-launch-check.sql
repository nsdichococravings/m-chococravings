-- NSDI Store launch check — READ ONLY, changes nothing.
-- Paste into Supabase → SQL Editor → Run. Every row should say PASS before launch
-- (rows marked LAUNCH STEP are the switches you flip to go live).
-- Change the product name below if your sugar product is called something else.
with
 cfg as (select * from public.grocery_settings where id = 1),
 sugar as (
   select p.*,
     (select coalesce(sum(on_hand - reserved), 0) from public.grocery_stock s where s.product_id = p.id) as available,
     (select count(*) from public.grocery_product_images i where i.product_id = p.id) as photos
   from public.grocery_products p
   where p.deleted_at is null and p.name ilike '%white sugar%'
   order by p.updated_at desc limit 1),
 checks(n, item, ok, detail) as (
  values
  (1, 'Store database update 20261109 (verified online payments)',
      to_regprocedure('public.grocery_record_verified_payment(uuid,uuid,text,text,bigint,text)') is not null,
      'Run migrations/20261109_grocery_verified_payments.sql'),
  (2, 'Store database update 20261112 (only super admin manages)',
      coalesce(pg_get_functiondef(to_regprocedure('public.grocery_require(text)')) like '%p_level in (''owner'',''admin'') and r=''owner''%', false),
      'Run migrations/20261112_grocery_owner_manages.sql'),
  (3, 'A super admin with a confirmed email exists',
      exists(select 1 from public.customers c join auth.users u on lower(u.email) = lower(c.email)
             where coalesce((to_jsonb(c)->>'is_super_user')::boolean, false) and u.email_confirmed_at is not null),
      'Set customers.is_super_user = true for the owner'),
  (4, 'White Sugar product exists', exists(select 1 from sugar), 'Add it in Manage NSDI Store → Products'),
  (5, 'White Sugar is published', coalesce((select is_published from sugar), false), 'Products → White Sugar → tick Published'),
  (6, 'White Sugar price is set and not above MRP',
      coalesce((select price > 0 and mrp > 0 and price <= mrp from sugar), false),
      'Products → White Sugar → Price / MRP'),
  (7, 'White Sugar has packs in stock', coalesce((select available > 0 from sugar), false),
      'Products → White Sugar → Stock → add packs'),
  (8, 'White Sugar has a photo', coalesce((select photos > 0 from sugar), false), 'Products → White Sugar → add a photo'),
  (9, 'White Sugar label details (net qty, packer, origin, best before, FSSAI)',
      coalesce((select nullif(trim(net_quantity), '') is not null and nullif(trim(manufacturer), '') is not null
                   and nullif(trim(country_of_origin), '') is not null and nullif(trim(best_before), '') is not null
                   and nullif(trim(fssai_license), '') is not null from sugar), false),
      'Required on packaged food: fill all five in the product form'),
  (10, 'No placeholder product is published',
      not exists(select 1 from public.grocery_products where deleted_at is null and is_published
                 and (name = '5 KG Pack' or description ilike 'Placeholder:%')),
      'Rename or unpublish the "5 KG Pack" placeholder'),
  (11, 'Outlet name and address are real', (select outlet_address not ilike '%placeholder%' and outlet_name <> 'NSDI ChocoCravings outlet' from cfg),
      'Settings → Outlet name / address'),
  (12, 'Pickup hours set', (select nullif(trim(pickup_hours), '') is not null from cfg), 'Settings → Pickup hours'),
  (13, 'At least one way to pay is on', (select cash_enabled or online_enabled from cfg), 'Settings → Cash at pickup and/or Online payment'),
  (14, 'Unpaid holds are freed every 5 minutes (pg_cron)',
      -- cron.job only exists when pg_cron is installed, so it is read through query_to_xml.
      case when to_regclass('cron.job') is null then false
           else (xpath('/row/n/text()', query_to_xml(
                 'select count(*) as n from cron.job where jobname = ''grocery-release-expired''', false, true, '')))[1]::text::int > 0 end,
      'Optional: holds are also freed when a new order comes in or staff open Orders'),
  (15, 'LAUNCH STEP: store is open', (select enabled from cfg), 'Settings → Open NSDI Store (super admin)'),
  (16, 'LAUNCH STEP: open to all customers, not just pilot list', (select not pilot_only from cfg),
      'Settings → turn off "Pilot: only listed customers" (super admin)')
 )
select n as "#", item as "Check", case when ok then 'PASS' else 'FAIL' end as "Result",
       case when ok then '' else detail end as "What to do"
from checks order by n;

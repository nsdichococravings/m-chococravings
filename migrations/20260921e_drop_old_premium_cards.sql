-- OPTIONAL cleanup. Run this only once you're sure you don't need any
-- data from the old login/code-based Premium Cards system (any issued
-- cards, stamps, rewards, allocations). This permanently deletes it.
-- The new system (migrations/20260921d_loyalty_cards.sql) is
-- completely independent and does not need this to be run.
begin;
drop trigger if exists cc_premium_order on public.store_orders;
drop function if exists public.cc_premium_order_trigger();
drop function if exists public.cc_premium_command(text,jsonb);
drop function if exists public.cc_premium_view(uuid);
drop function if exists public.cc_premium_reconcile(uuid,date);
drop function if exists public.cc_premium_schedule(jsonb);
drop function if exists public.cc_premium_items(jsonb);
drop function if exists public.cc_premium_role();
drop table if exists public.cc_premium_reviews;
drop table if exists public.cc_premium_audit;
drop table if exists public.cc_premium_codes;
drop table if exists public.cc_premium_rewards;
drop table if exists public.cc_premium_stamps;
drop table if exists public.cc_premium_purchases;
drop table if exists public.cc_premium_allocations;
drop table if exists public.cc_premium_cards;
drop table if exists public.cc_premium_members;
notify pgrst,'reload schema';
commit;

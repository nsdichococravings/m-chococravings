-- Home page sliding banner — makes the "Treats & Sips" carousel on the
-- customer app's Home page dynamic. Staff manage slides (combo offers,
-- bestseller highlights, seasonal specials) from store.html; the
-- customer app reads only active ones, ordered, and falls back to its
-- built-in default slides if this table is empty.
-- Run this ENTIRE file as database owner AFTER 20260921d_loyalty_cards.sql
-- (reuses cc_loyalty_role() for the admin/staff check).
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_loyalty_role' and pronamespace='public'::regnamespace) then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first — cc_loyalty_role() is not installed yet.';
 end if;
end $$;

create table if not exists public.home_banners (
 id uuid primary key default gen_random_uuid(),
 eyebrow text not null check (length(eyebrow) between 1 and 80),
 title_main text not null check (length(title_main) between 1 and 60),
 title_accent text not null check (length(title_accent) between 1 and 60),
 tagline text not null check (length(tagline) between 1 and 200),
 cta_label text check (cta_label is null or length(cta_label) between 1 and 40),
 color_1 text not null check (color_1 ~ '^#[0-9a-fA-F]{6}$'),
 color_2 text not null check (color_2 ~ '^#[0-9a-fA-F]{6}$'),
 color_3 text not null check (color_3 ~ '^#[0-9a-fA-F]{6}$'),
 link_type text not null default 'grid' check (link_type in ('grid','category','explore','accessories','none')),
 link_value text,
 sort_order int not null default 0,
 is_active boolean not null default true,
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

alter table public.home_banners enable row level security;

drop policy if exists home_banners_read on public.home_banners;
create policy home_banners_read on public.home_banners for select
 using (is_active or public.cc_loyalty_role() in ('admin','staff'));

-- No direct writes — every change goes through cc_home_banners_admin so
-- validation and the staff/admin check live in one place.
revoke all on public.home_banners from public, anon, authenticated;
grant select on public.home_banners to anon, authenticated;

create or replace function public.cc_home_banners_admin(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text = public.cc_loyalty_role(); b public.home_banners; v_id uuid; v_rows jsonb;
begin
 if role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 if p_action = 'list' then
  select coalesce(jsonb_agg(to_jsonb(h) order by h.sort_order, h.created_at), '[]'::jsonb) into v_rows
   from public.home_banners h;
  return v_rows;

 elsif p_action = 'create' then
  if coalesce(p_payload->>'color_1','') !~ '^#[0-9a-fA-F]{6}$'
  or coalesce(p_payload->>'color_2','') !~ '^#[0-9a-fA-F]{6}$'
  or coalesce(p_payload->>'color_3','') !~ '^#[0-9a-fA-F]{6}$' then
   raise exception 'Colors must be 6-digit hex, e.g. #6e0977';
  end if;
  insert into public.home_banners(eyebrow,title_main,title_accent,tagline,cta_label,color_1,color_2,color_3,link_type,link_value,sort_order,is_active,created_by)
  values(
    btrim(p_payload->>'eyebrow'), btrim(p_payload->>'title_main'), btrim(p_payload->>'title_accent'),
    btrim(p_payload->>'tagline'), nullif(btrim(coalesce(p_payload->>'cta_label','')),''),
    p_payload->>'color_1', p_payload->>'color_2', p_payload->>'color_3',
    coalesce(p_payload->>'link_type','grid'), nullif(btrim(coalesce(p_payload->>'link_value','')),''),
    coalesce((p_payload->>'sort_order')::int, 0), coalesce((p_payload->>'is_active')::boolean, true),
    auth.uid()
  ) returning * into b;
  return to_jsonb(b);

 elsif p_action = 'update' then
  v_id := (p_payload->>'id')::uuid;
  if p_payload ? 'color_1' and p_payload->>'color_1' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'color_1 must be 6-digit hex'; end if;
  if p_payload ? 'color_2' and p_payload->>'color_2' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'color_2 must be 6-digit hex'; end if;
  if p_payload ? 'color_3' and p_payload->>'color_3' !~ '^#[0-9a-fA-F]{6}$' then raise exception 'color_3 must be 6-digit hex'; end if;
  update public.home_banners set
   eyebrow      = case when p_payload ? 'eyebrow' then btrim(p_payload->>'eyebrow') else eyebrow end,
   title_main   = case when p_payload ? 'title_main' then btrim(p_payload->>'title_main') else title_main end,
   title_accent = case when p_payload ? 'title_accent' then btrim(p_payload->>'title_accent') else title_accent end,
   tagline      = case when p_payload ? 'tagline' then btrim(p_payload->>'tagline') else tagline end,
   cta_label    = case when p_payload ? 'cta_label' then nullif(btrim(coalesce(p_payload->>'cta_label','')),'') else cta_label end,
   color_1      = coalesce(p_payload->>'color_1', color_1),
   color_2      = coalesce(p_payload->>'color_2', color_2),
   color_3      = coalesce(p_payload->>'color_3', color_3),
   link_type    = coalesce(p_payload->>'link_type', link_type),
   link_value   = case when p_payload ? 'link_value' then nullif(btrim(coalesce(p_payload->>'link_value','')),'') else link_value end,
   sort_order   = coalesce((p_payload->>'sort_order')::int, sort_order),
   is_active    = coalesce((p_payload->>'is_active')::boolean, is_active),
   updated_at   = now()
  where id = v_id
  returning * into b;
  if b.id is null then raise exception 'Banner not found'; end if;
  return to_jsonb(b);

 elsif p_action = 'delete' then
  v_id := (p_payload->>'id')::uuid;
  delete from public.home_banners where id = v_id;
  return jsonb_build_object('ok', true);

 else raise exception 'Unknown banner action'; end if;
end $$;

revoke all on function public.cc_home_banners_admin(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_home_banners_admin(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;

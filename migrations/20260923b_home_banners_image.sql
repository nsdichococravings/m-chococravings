-- Adds an optional photo background to Home banners (e.g. a customer
-- enjoying coffee/tea/dessert), on top of the 3-colour gradient
-- 20260923_home_banners.sql already supports. When image_url is set,
-- the customer app renders the photo with a dark gradient overlay for
-- text legibility (same treatment the app's very first Home hero card
-- used); when it's null, the banner falls back to the gradient as before.
-- Run this ENTIRE file as database owner AFTER 20260923_home_banners.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='home_banners') then
  raise exception 'Run migrations/20260923_home_banners.sql first — home_banners is not installed yet.';
 end if;
end $$;

alter table public.home_banners add column if not exists image_url text check (image_url is null or length(image_url) between 1 and 500);

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
  insert into public.home_banners(eyebrow,title_main,title_accent,tagline,cta_label,color_1,color_2,color_3,link_type,link_value,image_url,sort_order,is_active,created_by)
  values(
    btrim(p_payload->>'eyebrow'), btrim(p_payload->>'title_main'), btrim(p_payload->>'title_accent'),
    btrim(p_payload->>'tagline'), nullif(btrim(coalesce(p_payload->>'cta_label','')),''),
    p_payload->>'color_1', p_payload->>'color_2', p_payload->>'color_3',
    coalesce(p_payload->>'link_type','grid'), nullif(btrim(coalesce(p_payload->>'link_value','')),''),
    nullif(btrim(coalesce(p_payload->>'image_url','')),''),
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
   image_url    = case when p_payload ? 'image_url' then nullif(btrim(coalesce(p_payload->>'image_url','')),'') else image_url end,
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

-- Additive update for an installed production workspace. Safe to rerun.
begin;
alter table public.cc_production_recipes add column if not exists deleted_at timestamptz;
create table if not exists public.cc_recipe_delete_requests (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.cc_production_recipes(id),
  reason text not null check(length(btrim(reason))>0),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  requested_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id), reviewed_at timestamptz
);
alter table public.cc_recipe_delete_requests add column if not exists review_note text;
create unique index if not exists cc_recipe_one_pending_delete
  on public.cc_recipe_delete_requests(recipe_id) where status='pending';
alter table public.cc_recipe_delete_requests enable row level security;
revoke all on public.cc_recipe_delete_requests from public,anon,authenticated;
grant select on public.cc_recipe_delete_requests to authenticated;
drop policy if exists cc_read on public.cc_recipe_delete_requests;
create policy cc_read on public.cc_recipe_delete_requests for select to authenticated using ((select public.cc_production_access()));

create or replace function public.cc_recipe_delete(p_action text,p_id uuid,p_reason text default '')
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.cc_recipe_delete_requests%rowtype; v_recipe uuid;
begin
  if auth.uid() is null or not coalesce(public.cc_production_access(),false) then raise exception 'Production access denied'; end if;
  if p_action='request' then
    if nullif(btrim(p_reason),'') is null then raise exception 'A deletion reason is required'; end if;
    perform 1 from public.cc_production_recipes where id=p_id and deleted_at is null for update;
    if not found then raise exception 'Active recipe not found'; end if;
    insert into public.cc_recipe_delete_requests(recipe_id,reason,requested_by)
      values(p_id,btrim(p_reason),auth.uid()) on conflict(recipe_id) where status='pending' do nothing;
  elsif p_action in ('approve','reject') then
    if public.cc_production_role() is distinct from 'admin' then raise exception 'Only an admin can review deletion requests'; end if;
    select recipe_id into strict v_recipe from public.cc_recipe_delete_requests where id=p_id;
    -- Same lock order as requests and batch creation.
    perform 1 from public.cc_production_recipes where id=v_recipe for update;
    select * into strict r from public.cc_recipe_delete_requests where id=p_id for update;
    if r.status=(case when p_action='approve' then 'approved' else 'rejected' end) then return; end if;
    if r.status<>'pending' then raise exception 'Deletion request has already been reviewed'; end if;
    if p_action='approve' then
      update public.cc_production_recipes set deleted_at=now() where id=r.recipe_id;
    end if;
    update public.cc_recipe_delete_requests set status=case when p_action='approve' then 'approved' else 'rejected' end,
      reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_reason) where id=p_id;
  else raise exception 'Unknown deletion action'; end if;
end $$;

-- Retain recipes referenced by old batches, but prohibit future use after approval.
create or replace function public.cc_batch_active_recipe() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  perform 1 from public.cc_production_recipes where id=new.recipe_id and deleted_at is null for share;
  if not found then raise exception 'This recipe has been deleted; select an active version'; end if;
  return new;
end $$;
drop trigger if exists cc_batch_active_recipe on public.cc_production_batches;
create trigger cc_batch_active_recipe before insert on public.cc_production_batches
for each row execute function public.cc_batch_active_recipe();

revoke all on function public.cc_recipe_delete(text,uuid,text),public.cc_batch_active_recipe() from public,anon,authenticated;
grant execute on function public.cc_recipe_delete(text,uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;

-- Unified approvals and effective-dated making-cost corrections.
begin;
-- Use verified account identity and existing protected customer role flags.
-- Map super admin to admin for compatibility with existing production RPCs.
create or replace function public.cc_production_role() returns text
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(
   (select 'admin' from auth.users u join public.customers c on lower(c.email)=lower(u.email)
    where u.id=auth.uid() and u.email_confirmed_at is not null
      and (c.is_admin=true or coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)) limit 1),
   (select role from public.cc_production_members where user_id=auth.uid())
 )
$$;
create or replace function public.cc_can_review_approvals() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and coalesce(public.cc_production_role()='admin',false)
$$;

create table if not exists public.cc_cost_corrections (
 id uuid primary key default gen_random_uuid(), product_name text not null,
 effective_from date not null, effective_to date not null,
 material_cost numeric not null check(material_cost>=0 and material_cost<100000000),
 packaging_cost numeric not null check(packaging_cost>=0 and packaging_cost<100000000),
 labor_cost numeric not null check(labor_cost>=0 and labor_cost<100000000),
 overhead_cost numeric not null check(overhead_cost>=0 and overhead_cost<100000000),
 reason text not null check(length(btrim(reason))>0),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id), reviewed_at timestamptz, review_note text,
 command_key uuid not null, base_approval_id uuid references public.cc_cost_corrections(id),
 unique(requested_by,command_key), check(effective_from<=effective_to)
);
create unique index if not exists cc_cost_one_pending on public.cc_cost_corrections(product_name) where status='pending';
create index if not exists cc_cost_product_dates on public.cc_cost_corrections(product_name,effective_from,effective_to) where status='approved';
alter table public.cc_cost_corrections enable row level security;
revoke all on public.cc_cost_corrections from public,anon,authenticated;
grant select on public.cc_cost_corrections to authenticated;
drop policy if exists cc_cost_read on public.cc_cost_corrections;
create policy cc_cost_read on public.cc_cost_corrections for select to authenticated using (
 (select public.cc_production_access()) and
 (status='approved' or requested_by=auth.uid() or (select public.cc_can_review_approvals()))
);

create or replace function public.cc_request_cost_correction(p_payload jsonb,p_key uuid) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id uuid; v_name text:=btrim(p_payload->>'product_name'); v_base uuid; prior public.cc_cost_corrections%rowtype;
begin
 if auth.uid() is null or not coalesce(public.cc_production_access(),false) then raise exception 'Production access denied'; end if;
 if p_key is null then raise exception 'Retry key required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cc-cost:'||coalesce(v_name,''),0));
 select * into prior from public.cc_cost_corrections where requested_by=auth.uid() and command_key=p_key;
 if found then
   if prior.product_name is distinct from v_name
     or prior.effective_from is distinct from (p_payload->>'effective_from')::date
     or prior.effective_to is distinct from (p_payload->>'effective_to')::date
     or prior.material_cost is distinct from (p_payload->>'material_cost')::numeric
     or prior.packaging_cost is distinct from (p_payload->>'packaging_cost')::numeric
     or prior.labor_cost is distinct from (p_payload->>'labor_cost')::numeric
     or prior.overhead_cost is distinct from (p_payload->>'overhead_cost')::numeric
     or prior.reason is distinct from btrim(p_payload->>'reason') then
     raise exception 'Retry key belongs to different input; close and reopen the correction form';
   end if;
   return prior.id;
 end if;
 if not exists(select 1 from public.store_menu where name=v_name) and
    not exists(select 1 from public.cc_production_recipes where product_name=v_name) then raise exception 'Product not found'; end if;
 if exists(select 1 from public.cc_cost_corrections where product_name=v_name and status='pending') then raise exception 'A cost correction for this product is already awaiting approval'; end if;
 select id into v_base from public.cc_cost_corrections where product_name=v_name and status='approved' order by reviewed_at desc,id desc limit 1;
 insert into public.cc_cost_corrections(product_name,effective_from,effective_to,material_cost,packaging_cost,labor_cost,overhead_cost,reason,requested_by,command_key,base_approval_id)
 values(v_name,(p_payload->>'effective_from')::date,(p_payload->>'effective_to')::date,
 (p_payload->>'material_cost')::numeric,(p_payload->>'packaging_cost')::numeric,
 (p_payload->>'labor_cost')::numeric,(p_payload->>'overhead_cost')::numeric,
 btrim(p_payload->>'reason'),auth.uid(),p_key,v_base) returning id into v_id;
 return v_id;
end $$;
create or replace function public.cc_review_cost_correction(p_id uuid,p_approve boolean,p_note text default '') returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.cc_cost_corrections%rowtype; v_name text; v_base uuid; v_status text;
begin
 if not public.cc_can_review_approvals() then raise exception 'Only admin or super admin can review approvals'; end if;
 if p_approve is null then raise exception 'Decision required'; end if;
 select product_name into strict v_name from public.cc_cost_corrections where id=p_id;
 perform pg_advisory_xact_lock(hashtextextended('cc-cost:'||v_name,0));
 select * into strict r from public.cc_cost_corrections where id=p_id for update;
 v_status:=case when p_approve then 'approved' else 'rejected' end;
 if r.status=v_status then return; end if;
 if r.status<>'pending' then raise exception 'Request already reviewed'; end if;
 select id into v_base from public.cc_cost_corrections where product_name=r.product_name and status='approved' order by reviewed_at desc,id desc limit 1;
 if p_approve and v_base is distinct from r.base_approval_id then raise exception 'Costs changed since submission; reject this request and submit again'; end if;
 update public.cc_cost_corrections set status=v_status,reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_note=btrim(p_note) where id=p_id;
end $$;

-- Enforce admin approval even when an older browser calls the original command.
create or replace function public.cc_guard_sales_approval() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if old.status='pending' and new.status in ('approved','cancelled') and not public.cc_can_review_approvals() then
   raise exception 'Only admin or super admin can approve or reject sales requests';
 end if;
 return new;
end $$;
drop trigger if exists cc_guard_sales_approval on public.cc_production_requests;
create trigger cc_guard_sales_approval before update on public.cc_production_requests for each row execute function public.cc_guard_sales_approval();
alter table public.cc_production_requests add column if not exists reviewed_by uuid references auth.users(id);
alter table public.cc_production_requests add column if not exists reviewed_at timestamptz;
alter table public.cc_production_requests add column if not exists review_note text;
create or replace function public.cc_review_sales_request(p_id uuid,p_approve boolean,p_note text default '') returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.cc_production_requests%rowtype; v_status text;
begin
 if not public.cc_can_review_approvals() then raise exception 'Only admin or super admin can review approvals'; end if;
 if p_approve is null then raise exception 'Decision required'; end if;
 select * into strict r from public.cc_production_requests where id=p_id for update;
 v_status:=case when p_approve then 'approved' else 'cancelled' end;
 if r.status=v_status and r.reviewed_by is not null then return; end if;
 if r.status<>'pending' then raise exception 'Request already reviewed'; end if;
 update public.cc_production_requests set status=v_status,reviewed_by=auth.uid(),reviewed_at=now(),review_note=btrim(p_note),
   approved_by=case when p_approve then auth.uid() else approved_by end,
   approved_at=case when p_approve then now() else approved_at end where id=p_id;
end $$;
revoke all on function public.cc_can_review_approvals(),public.cc_request_cost_correction(jsonb,uuid),public.cc_review_cost_correction(uuid,boolean,text),public.cc_review_sales_request(uuid,boolean,text),public.cc_guard_sales_approval() from public,anon,authenticated;
grant execute on function public.cc_can_review_approvals(),public.cc_request_cost_correction(jsonb,uuid),public.cc_review_cost_correction(uuid,boolean,text),public.cc_review_sales_request(uuid,boolean,text) to authenticated;
notify pgrst,'reload schema';
commit;

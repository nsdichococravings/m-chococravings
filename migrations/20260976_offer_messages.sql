-- Offers sent from "Send Notification" are saved here, so a customer who
-- taps the notification sees the full offer in the app (index.html?offer=<id>)
-- and can read it later under the 🔔 "Your Updates" bell. Readable by
-- everyone for 45 days (they are public offers); only the send-push Edge
-- Function (service role) writes them.
-- "We miss you" messages are personal: send-push adds them to that
-- customer's own notifications list instead.
-- Run after 20260950_push_notifications.sql, then redeploy send-push.
-- Safe to re-run.
begin;
set local lock_timeout = '10s';

create table if not exists public.cc_broadcasts(
 id uuid primary key default gen_random_uuid(),
 title text not null,
 body text not null,
 target text,
 sent int not null default 0,
 sent_by text,
 created_at timestamptz not null default now()
);
create index if not exists cc_broadcasts_created_idx on public.cc_broadcasts(created_at desc);
alter table public.cc_broadcasts enable row level security;
revoke all on public.cc_broadcasts from public, anon, authenticated;
grant select on public.cc_broadcasts to anon, authenticated;
drop policy if exists cc_broadcasts_read on public.cc_broadcasts;
create policy cc_broadcasts_read on public.cc_broadcasts for select to anon, authenticated
 using (created_at > now() - interval '45 days');

notify pgrst, 'reload schema';
commit;

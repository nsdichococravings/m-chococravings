// send-push — Supabase Edge Function that sends Web Push notifications.
//
// Two callers:
//  1. The cc_push_order_status trigger (migrations/20260950_push_notifications.sql),
//     via pg_net, with header x-cc-push-secret:
//       { type: 'order_status', order_id, status }
//     -> tells that order's customer what's happening with their order.
//     and cc_send_daily_summary (migrations/20260968_daily_summary.sql), same header:
//       { type: 'daily_summary', title, body }
//     -> the 10 pm summary to the owner's (customers.is_super_user) devices.
//     and cc_winback_send (migrations/20260970), same header:
//       { type: 'winback', messages: [{ customer_id, title, body }] }
//     -> one personal "we miss you" message per customer.
//  2. An admin in the app (Command Center > Send Notification), with their
//     normal sign-in token:
//       { type: 'broadcast', title, body, url? }
//     -> sends to every subscribed device. Only customers.is_admin users.
//
// Deploy:  supabase functions deploy send-push --no-verify-jwt
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...),
//          PUSH_WEBHOOK_SECRET (= cc_push_config.webhook_secret).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const STATUS_TEXT: Record<string, [string, string]> = {
  confirmed:        ["Order confirmed ✅", "We've received your order {n} and will start on it soon."],
  baking:           ["Baking now 🍫", "Your order {n} is in the oven!"],
  packed:           ["Packed and ready 📦", "Your order {n} is packed."],
  shipped:          ["On its way 🚚", "Your order {n} has been shipped."],
  out_for_delivery: ["Out for delivery 🚚", "Your order {n} is on its way to you."],
  delivered:        ["Delivered 🎉", "Enjoy your treats! Tap to rate order {n}."],
  cancelled:        ["Order cancelled", "Your order {n} was cancelled. Contact us if this is unexpected."],
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const env = (k: string) => Deno.env.get(k) ?? "";
  if (!env("VAPID_PUBLIC_KEY") || !env("VAPID_PRIVATE_KEY")) return json({ error: "VAPID keys not configured" }, 500);
  webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  let payload: { title: string; body: string; url: string; tag?: string };
  let broadcastId: string | null = null;
  let subsQuery = admin.from("cc_push_subscriptions").select("endpoint,p256dh,auth");

  if (body.type === "order_status") {
    const secret = env("PUSH_WEBHOOK_SECRET");
    if (!secret || req.headers.get("x-cc-push-secret") !== secret) return json({ error: "Forbidden" }, 403);
    const { data: order } = await admin.from("orders")
      .select("id,order_number,status,customer_id").eq("id", String(body.order_id)).maybeSingle();
    if (!order || !order.customer_id) return json({ sent: 0, reason: "order not found" });
    const text = STATUS_TEXT[order.status];
    if (!text) return json({ sent: 0, reason: "status not notified" });
    const n = order.order_number || "";
    payload = { title: text[0], body: text[1].replace("{n}", n).replace(/\s+/g, " "), url: "/index.html?open=orders", tag: "order-" + order.id };
    subsQuery = subsQuery.eq("customer_id", order.customer_id);
  } else if (body.type === "daily_summary") {
    // 10 pm owner summary from cc_send_daily_summary (migrations/20260968), via pg_net.
    const secret = env("PUSH_WEBHOOK_SECRET");
    if (!secret || req.headers.get("x-cc-push-secret") !== secret) return json({ error: "Forbidden" }, 403);
    const { data: owners } = await admin.from("customers").select("id").eq("is_super_user", true);
    const ids = (owners || []).map((o) => String(o.id));
    if (!ids.length) return json({ sent: 0, reason: "no owner account" });
    const title = String(body.title || "").trim().slice(0, 80);
    const text = String(body.body || "").trim().slice(0, 300);
    if (!title) return json({ error: "Title is required" }, 400);
    payload = { title, body: text, url: "/store.html?open=daily-summary", tag: "daily-summary" };
    subsQuery = subsQuery.in("customer_id", ids);
  } else if (body.type === "winback") {
    // Personal "we miss you" messages from cc_winback_send (migrations/20260970), via pg_net.
    const secret = env("PUSH_WEBHOOK_SECRET");
    if (!secret || req.headers.get("x-cc-push-secret") !== secret) return json({ error: "Forbidden" }, 403);
    const messages = Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]).slice(0, 200) : [];
    let sent = 0, removed = 0;
    for (const m of messages) {
      const title = String(m.title || "").trim().slice(0, 80), text = String(m.body || "").trim().slice(0, 300);
      if (!title || !m.customer_id) continue;
      const { data: subs } = await admin.from("cc_push_subscriptions").select("endpoint,p256dh,auth").eq("customer_id", String(m.customer_id));
      // Also into their "Your Updates" list, so the message can be read after tapping.
      await admin.from("notifications").insert({
        customer_id: String(m.customer_id), type: "whatsapp", direction: "inbound", recipient: "",
        subject: title, message: text, status: "delivered", template_name: "promo",
        sent_at: new Date().toISOString(), delivered_at: new Date().toISOString(),
      }).then(() => {}, () => {});
      const r = await deliver(admin, subs || [], { title, body: text, url: "/index.html?open=updates", tag: "winback" });
      sent += r.sent; removed += r.removed;
    }
    return json({ sent, removed, customers: messages.length });
  } else if (body.type === "broadcast") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: userData } = await admin.auth.getUser(token);
    const email = userData?.user?.email;
    if (!email) return json({ error: "Sign in required" }, 401);
    const { data: me } = await admin.from("customers").select("is_admin").eq("email", email).maybeSingle();
    if (!me?.is_admin) return json({ error: "Admins only" }, 403);
    const title = String(body.title || "").trim().slice(0, 60);
    const text = String(body.body || "").trim().slice(0, 180);
    if (!title || !text) return json({ error: "Title and message are required" }, 400);
    const target = typeof body.url === "string" && body.url.startsWith("/") ? body.url : "/index.html";
    // Save the offer so a tap opens it in full in the app (migrations/20260976).
    const { data: saved } = await admin.from("cc_broadcasts").insert({ title, body: text, target, sent_by: email }).select("id").maybeSingle();
    broadcastId = saved?.id ?? null;
    const url = broadcastId ? "/index.html?offer=" + broadcastId : target;
    payload = { title, body: text, url, tag: "broadcast" };
  } else {
    return json({ error: "Unknown type" }, 400);
  }

  const { data: subs, error } = await subsQuery;
  if (error) return json({ error: error.message }, 500);
  const r = await deliver(admin, subs || [], payload);
  if (broadcastId) await admin.from("cc_broadcasts").update({ sent: r.sent }).eq("id", broadcastId);
  return json({ ...r, total: (subs || []).length });
});

type Sub = { endpoint: string; p256dh: string; auth: string };
// Sends one payload to each device; forgets devices that unsubscribed or expired.
async function deliver(admin: ReturnType<typeof createClient>, subs: Sub[], payload: unknown) {
  let sent = 0;
  const gone: string[] = [];
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 },
      );
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint); // device unsubscribed / expired
      else console.warn("push failed", code, (e as Error).message);
    }
  }));
  if (gone.length) await admin.from("cc_push_subscriptions").delete().in("endpoint", gone);
  return { sent, removed: gone.length };
}

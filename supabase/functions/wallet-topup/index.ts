// wallet-topup — adds money to a customer's wallet with UPI (Razorpay).
//
// The wallet is only credited here, after Razorpay itself says the
// payment was captured. The app never tells the database "I paid".
//
// Called by the customer app (index.html, wallet.js) with the customer's
// normal sign-in token:
//   { action: 'create',  amount }    -> { order_id, amount (paise), key_id }
//        creates a Razorpay order and records it as a pending top-up.
//   { action: 'confirm', order_id }  -> { status: 'paid', amount, balance } | { status: 'pending' }
//        asks Razorpay for that order's payments; if one is captured (or
//        authorized, which this captures), the wallet is credited once.
//        Safe to call again: a top-up is never credited twice.
//
// Deploy:  supabase functions deploy wallet-topup
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (the same live keys the
//          create-razorpay-order function uses).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Needs migrations/20261108_customer_wallet.sql.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const MIN = 10, MAX = 10000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const env = (k: string) => Deno.env.get(k) ?? "";
  const keyId = env("RAZORPAY_KEY_ID"), keySecret = env("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) return json({ error: "Payments are not set up yet" }, 500);
  const rzAuth = "Basic " + btoa(keyId + ":" + keySecret);
  const rz = async (path: string, init: RequestInit = {}) => {
    const r = await fetch("https://api.razorpay.com/v1" + path, {
      ...init, headers: { Authorization: rzAuth, "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((data && data.error && data.error.description) || "Payment service error");
    return data;
  };

  const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  const user = u && u.user;
  if (!user) return json({ error: "Please sign in again" }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

  try {
    if (body.action === "create") {
      const amount = Math.round(Number(body.amount));
      if (!Number.isFinite(amount) || amount < MIN || amount > MAX) return json({ error: `Add from ₹${MIN} to ₹${MAX}` }, 400);
      const order = await rz("/orders", {
        method: "POST",
        body: JSON.stringify({
          amount: amount * 100, currency: "INR", receipt: "wallet_" + Date.now(),
          payment_capture: 1, notes: { module: "wallet", user_id: user.id },
        }),
      });
      const rec = await admin.rpc("cc_wallet_topup_record", { p_rzp_order_id: order.id, p_user: user.id, p_amount: amount });
      if (rec.error) return json({ error: rec.error.message }, 400);
      return json({ order_id: order.id, amount: order.amount, key_id: keyId });
    }

    if (body.action === "confirm") {
      const orderId = String(body.order_id || "");
      if (!/^order_[A-Za-z0-9]+$/.test(orderId)) return json({ error: "Missing top-up" }, 400);
      const list = await rz("/orders/" + orderId + "/payments");
      const items: Array<Record<string, unknown>> = (list && list.items) || [];
      let paid = items.find((p) => p.status === "captured");
      if (!paid) {
        const auth = items.find((p) => p.status === "authorized");
        if (auth) paid = await rz("/payments/" + auth.id + "/capture", {
          method: "POST", body: JSON.stringify({ amount: auth.amount, currency: "INR" }),
        });
      }
      if (!paid || paid.status !== "captured" || paid.order_id !== orderId) return json({ status: "pending" });
      const s = await admin.rpc("cc_wallet_topup_settle", {
        p_rzp_order_id: orderId, p_user: user.id, p_payment_id: String(paid.id), p_paise: Number(paid.amount),
      });
      if (s.error) return json({ error: s.error.message }, 400);
      return json(s.data);
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong" }, 502);
  }
});

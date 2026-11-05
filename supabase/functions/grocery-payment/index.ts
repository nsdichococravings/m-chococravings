// grocery-payment — confirms an NSDI Store online payment with Razorpay.
//
// The store app (grocery.html) calls this after Razorpay checkout, with
// the customer's normal sign-in token:
//   { order_id, payment_id, rzp_order_id? }  -> the store order (same shape as grocery_order)
//
// It asks Razorpay for the payment and only records it when:
//   * the payment is captured (an authorized one is captured here),
//   * it belongs to a Razorpay order made for this store order
//     (notes.order_number or receipt = the store order number),
//   * the amount is the order total (checked again in the database).
// The database step, grocery_record_verified_payment, is service_role
// only, so the app can no longer mark an order paid by itself.
// Safe to call again with the same payment.
//
// Deploy:  supabase functions deploy grocery-payment
// Secrets: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET (same live keys as create-razorpay-order).
// Needs migrations/20261109_grocery_verified_payments.sql.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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
  const orderId = String(body.order_id || "");
  const paymentId = String(body.payment_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) return json({ error: "Missing payment details" }, 400);

  try {
    let pay = await rz("/payments/" + paymentId);
    if (pay.status === "authorized") {
      pay = await rz("/payments/" + paymentId + "/capture", {
        method: "POST", body: JSON.stringify({ amount: pay.amount, currency: pay.currency || "INR" }),
      });
    }
    if (pay.status !== "captured") return json({ error: "Payment is not complete yet. Please try again in a moment." }, 409);
    if (!pay.order_id || (body.rzp_order_id && body.rzp_order_id !== pay.order_id)) {
      return json({ error: "This payment was not made for this order" }, 400);
    }
    const rzOrder = await rz("/orders/" + pay.order_id);
    const ref = (rzOrder.notes && rzOrder.notes.order_number) || rzOrder.receipt || null;

    const r = await admin.rpc("grocery_record_verified_payment", {
      p_user: user.id, p_order_id: orderId, p_payment_id: paymentId,
      p_rzp_order_id: pay.order_id, p_paise: Number(pay.amount), p_order_ref: ref,
    });
    if (r.error) return json({ error: r.error.message }, 400);
    return json(r.data);
  } catch (e) {
    return json({ error: (e as Error).message || "Something went wrong" }, 502);
  }
});

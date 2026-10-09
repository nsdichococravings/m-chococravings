// auth-login: password sign-in with lockout, for the WealthPilot app.
//
// The app sends { email, password } here instead of calling Supabase Auth
// directly, so every attempt is checked and recorded:
//   * 5 wrong passwords in 15 minutes  -> account locked for 15 minutes (423)
//   * 20 failures from one IP in 15 min -> that IP is slowed down (429)
//   * every success / failure / lock goes to fin.login_events
//   * a login from a device not seen before is recorded as 'new_device'
// The password itself is only passed on to Supabase Auth; it is never stored or logged.
//
// Deploy:  supabase functions deploy auth-login --no-verify-jwt
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const admin = createClient(URL, SERVICE, { db: { schema: "fin" }, auth: { persistSession: false } });

function clientIp(req: Request): string | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
}

async function logEvent(user_id: string | null, event: string, ip: string | null, device: string) {
  const { error } = await admin.from("login_events").insert({ user_id, event, ip, device });
  if (error) console.error("login_events insert failed", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password || email.length > 254 || password.length > 200) {
    return json(400, { error: "bad_request", message: "Enter your email and password." });
  }

  const ip = clientIp(req);
  const device = (req.headers.get("user-agent") ?? "unknown").slice(0, 200);

  // Slow down one IP trying many accounts
  if (ip) {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin.from("login_events").select("id", { count: "exact", head: true })
      .eq("ip", ip).eq("event", "login_failed").gte("created_at", since);
    if ((count ?? 0) >= 20) {
      return json(429, { error: "too_many_attempts", message: "Too many attempts. Please wait 15 minutes." });
    }
  }

  const { data: uid } = await admin.rpc("user_id_by_email", { p_email: email });
  const userId = (uid as string | null) ?? null;

  if (userId) {
    const { data: locked } = await admin.rpc("is_login_locked", { p_user: userId });
    if (locked) {
      return json(423, { error: "locked", message: "Too many wrong passwords. Your account is locked for 15 minutes. You can also reset your password." });
    }
  }

  const auth = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    if (error?.message?.toLowerCase().includes("email not confirmed")) {
      return json(403, { error: "email_not_confirmed", message: "Please confirm your email first. Check your inbox for the link." });
    }
    await logEvent(userId, "login_failed", ip, device);
    if (userId) {
      const { data: nowLocked } = await admin.rpc("is_login_locked", { p_user: userId });
      if (nowLocked) {
        await logEvent(userId, "locked", ip, device);
        return json(423, { error: "locked", message: "Too many wrong passwords. Your account is locked for 15 minutes. You can also reset your password." });
      }
    }
    // Same message whether or not the account exists
    return json(401, { error: "invalid_credentials", message: "Email or password is incorrect." });
  }

  const user = data.session.user.id;
  const prior = admin.from("login_events").select("id", { count: "exact", head: true })
    .eq("user_id", user).eq("event", "login_ok");
  const [{ count: total }, { count: seen }] = await Promise.all([prior, prior.eq("device", device)]);
  await logEvent(user, "login_ok", ip, device);
  if ((total ?? 0) > 0 && (seen ?? 0) === 0) await logEvent(user, "new_device", ip, device);

  return json(200, {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
});

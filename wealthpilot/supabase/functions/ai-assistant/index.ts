// ai-assistant: the WealthPilot AI (Ask AI chat + "Find savings" cost cutter).
//
// The app calls it with the user's normal sign-in token:
//   { mode: "chat", question, history?: [{role, content}] }  -> { answer }
//   { mode: "insights" }                                     -> { insights: [...] } (also saved to fin.ai_insights)
//
// Rules this function keeps:
//   * The AI explains numbers; it never computes them. It receives the results of
//     the SQL engine (get_home, get_dues, get_month_spend) and is told to use them as-is.
//   * Data is read with the USER's token, so Row Level Security applies.
//   * Only totals and masked names are sent (no full account numbers, no passwords).
//   * The user must switch on AI in Settings first (profiles.ai_consent).
//   * Every call counts against the plan's monthly AI limit (fin.bump_ai_usage).
//
// Deploy:  supabase functions deploy ai-assistant
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-opus-5-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
const admin = createClient(URL, SERVICE, { db: { schema: "fin" }, auth: { persistSession: false } });

// Stable text first so it can be cached; the family's numbers go in the user turn.
const SYSTEM = `You are WealthPilot, a friendly personal finance assistant for Indian families.
You receive a JSON snapshot of the family's finances computed by the app's own engine.
All amounts in the snapshot are in PAISE (divide by 100 for rupees). Always talk in rupees with Indian digit grouping, e.g. ₹1,25,000.

How to answer:
- Use the snapshot numbers exactly as given. Never recalculate the earning target, Freedom Date or dues yourself; if a question needs a number that is not in the snapshot, say what extra information is needed.
- Be short and practical: a direct answer first, then at most 3 bullet points of concrete actions.
- The "target" block is how much the family must earn per day / week / month to cover everything. The "freedom" block is their financial-freedom progress.
- For cutting costs, look for: subscriptions and fees, credit card interest or late fees, high-interest loans that could be prepaid, categories growing month over month, and discretionary spend.
- You give education, not licensed investment advice. Never recommend a specific stock or fund; talk about asset classes, SIP amounts and habits.
- If the snapshot is mostly empty, tell the user which screens to fill in first (income, EMIs, cards, bills, daily spend).`;

const INSIGHTS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["insights"],
  properties: {
    insights: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "body", "saving_rupees_per_month", "severity"],
        properties: {
          kind: { type: "string", enum: ["saving", "due_alert", "forecast", "coach", "invest"] },
          title: { type: "string" },
          body: { type: "string" },
          saving_rupees_per_month: { type: "integer" },
          severity: { type: "integer", enum: [1, 2, 3, 4] },
        },
      },
    },
  },
};

type Turn = { role: "user" | "assistant"; content: string };

function textOf(msg: { content: Array<{ type: string; text?: string }> }): string {
  return msg.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

async function callClaude(params: Record<string, unknown>) {
  // fallbacks: "default" lets the API retry a declined request on a suitable model.
  // deno-lint-ignore no-explicit-any
  const create = anthropic.beta.messages.create as (p: any) => Promise<any>;
  return await create.call(anthropic.beta.messages, {
    model: MODEL,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    ...params,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const authHeader = req.headers.get("Authorization") ?? "";
  const userDb = createClient(URL, ANON, {
    db: { schema: "fin" },
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userDb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  const user = userData?.user;
  if (!user) return json(401, { error: "not_signed_in" });

  let body: { mode?: string; question?: string; history?: Turn[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const mode = body.mode === "insights" ? "insights" : "chat";

  const { data: profile } = await userDb.from("profiles").select("ai_consent").eq("user_id", user.id).maybeSingle();
  if (!profile?.ai_consent) {
    return json(403, { error: "consent_required", message: "Switch on AI help in Settings first." });
  }

  const { data: member } = await userDb.from("household_members").select("household_id")
    .eq("user_id", user.id).order("created_at").limit(1).maybeSingle();
  const household = member?.household_id as string | undefined;
  if (!household) return json(404, { error: "no_household" });

  const { data: usage } = await admin.rpc("bump_ai_usage", { p_household: household, p_tokens: 0 });
  if (usage && usage.limit > 0 && usage.used > usage.limit) {
    return json(429, { error: "limit_reached", message: `You have used all ${usage.limit} AI messages for this month on your plan.` });
  }

  // Snapshot from the deterministic engine, read with the user's token (RLS applies)
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const [home, dues, spendNow, spendLast] = await Promise.all([
    userDb.rpc("get_home", { p_household: household }),
    userDb.rpc("get_dues", { p_household: household, p_days: 30 }),
    userDb.rpc("get_month_spend", { p_household: household }),
    userDb.rpc("get_month_spend", { p_household: household, p_month: lastMonth.toISOString().slice(0, 10) }),
  ]);
  const snapshot = {
    today: new Date().toISOString().slice(0, 10),
    target: home.data?.target,
    freedom: home.data?.freedom,
    earned_this_week_paise: home.data?.earned_this_week_paise,
    earned_this_month_paise: home.data?.earned_this_month_paise,
    spent_this_month_paise: home.data?.spent_this_month_paise,
    dues_next_30_days: dues.data,
    spend_by_category_this_month: spendNow.data,
    spend_by_category_last_month: spendLast.data,
  };
  const snapshotText = `Family snapshot (JSON):\n${JSON.stringify(snapshot)}`;

  const started = Date.now();
  try {
    let response;
    if (mode === "chat") {
      const question = (body.question ?? "").trim().slice(0, 2000);
      if (!question) return json(400, { error: "bad_request", message: "Type a question." });
      const history = (body.history ?? []).slice(-8)
        .filter((t) => (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
        .map((t) => ({ role: t.role, content: t.content.slice(0, 4000) }));
      response = await callClaude({
        max_tokens: 4000,
        output_config: { effort: "low" },
        messages: [...history, { role: "user", content: `${snapshotText}\n\nQuestion: ${question}` }],
      });
    } else {
      response = await callClaude({
        max_tokens: 8000,
        output_config: { effort: "medium", format: { type: "json_schema", schema: INSIGHTS_SCHEMA } },
        messages: [{
          role: "user",
          content: `${snapshotText}\n\nFind up to 5 ways this family can cut unwanted costs or avoid charges ` +
            `(late fees, card interest, unused subscriptions, overspending categories), plus any urgent due-date warning. ` +
            `Each insight: a short title, a 1-2 sentence body with the exact action, the realistic monthly saving in rupees ` +
            `(0 if none), and severity 1 info / 2 tip / 3 warning / 4 urgent.`,
        }],
      });
    }

    await admin.from("ai_agent_runs").insert({
      household_id: household,
      agent: mode === "chat" ? "chat" : "cost_cutter",
      input_hash: String(snapshotText.length),
      model: response.model ?? MODEL,
      status: response.stop_reason === "refusal" ? "failed" : "done",
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      cache_read_tokens: response.usage?.cache_read_input_tokens,
      duration_ms: Date.now() - started,
    });

    if (response.stop_reason === "refusal") {
      return json(200, { answer: "Sorry, I can't help with that one. Try asking about your budget, dues or savings." });
    }
    if (mode === "chat") return json(200, { answer: textOf(response) });

    let parsed: { insights: Array<{ kind: string; title: string; body: string; saving_rupees_per_month: number; severity: number }> };
    try {
      parsed = JSON.parse(textOf(response));
    } catch {
      return json(502, { error: "bad_ai_output" });
    }
    await admin.from("ai_insights").update({ status: "expired" })
      .eq("household_id", household).eq("agent", "cost_cutter").eq("status", "new");
    const rows = parsed.insights.slice(0, 5).map((i) => ({
      household_id: household,
      agent: "cost_cutter",
      kind: i.kind,
      title: i.title.slice(0, 200),
      body: i.body.slice(0, 1000),
      saving_paise: Math.max(0, Math.round(i.saving_rupees_per_month)) * 100,
      severity: i.severity,
      valid_until: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }));
    if (rows.length) await admin.from("ai_insights").insert(rows);
    return json(200, { insights: rows });
  } catch (err) {
    console.error("ai-assistant failed", err);
    await admin.from("ai_agent_runs").insert({
      household_id: household, agent: mode === "chat" ? "chat" : "cost_cutter", input_hash: "-",
      model: MODEL, status: "failed", error: String(err).slice(0, 500), duration_ms: Date.now() - started,
    });
    return json(502, { error: "ai_unavailable", message: "The AI is busy right now. Please try again in a minute." });
  }
});

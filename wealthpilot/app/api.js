// Data layer. Two interchangeable backends with the same methods:
//   * supabaseApi: the real app (Supabase Auth + the fin schema from supabase/migrations)
//   * demoApi:     runs in the browser with sample data when config.js has no Supabase URL
import { computeTarget, computeFreedom, nextDayOfMonth, nextDue, addDays } from "./engine.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Could not load " + src));
    document.head.appendChild(s);
  });
}

export async function createApi(config) {
  if (config.SUPABASE_URL && config.SUPABASE_ANON_KEY) return supabaseApi(config);
  return demoApi();
}

// ===========================================================================
// Supabase backend
// ===========================================================================
async function supabaseApi({ SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_VIA_FUNCTION = true }) {
  if (!window.supabase) await loadScript(SUPABASE_JS);
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: "fin" } });
  let hid = null;

  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const rpc = async (fn, args) => must(await sb.rpc(fn, args));
  const home = () => location.href.split("#")[0];

  async function passwordLogin(email, password) {
    if (!LOGIN_VIA_FUNCTION) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw new Error("Email or password is incorrect.");
      return;
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/auth-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || "Could not sign in. Please try again.");
    must(await sb.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token }));
  }

  return {
    demo: false,

    // ---------- auth ----------
    onAuth(cb) { sb.auth.onAuthStateChange((event, session) => cb(event, session)); },
    async session() { return (await sb.auth.getSession()).data.session; },
    async signUp({ name, email, password }) {
      const { data, error } = await sb.auth.signUp({
        email, password,
        options: { data: { full_name: name, app: "wealthpilot" }, emailRedirectTo: home() },
      });
      if (error) throw new Error(error.message);
      return { needsConfirm: !data.session };
    },
    signIn: passwordLogin,
    async sendReset(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: home() })); },
    async changePassword(password) {
      must(await sb.auth.updateUser({ password }));
      await sb.rpc("log_my_login_event", { p_event: "password_changed", p_device: navigator.userAgent });
    },
    // re-check the current password (same lockout rules as a normal login)
    verifyPassword: passwordLogin,
    async signOut(everywhere = false) {
      if (everywhere) await sb.rpc("log_my_login_event", { p_event: "logout_all", p_device: navigator.userAgent });
      await sb.auth.signOut({ scope: everywhere ? "global" : "local" });
      hid = null;
    },
    async me() { return (await sb.auth.getUser()).data.user; },

    // ---------- setup ----------
    async init(user) {
      hid = await rpc("ensure_my_household", { p_full_name: user?.user_metadata?.full_name ?? null });
      return hid;
    },

    // ---------- screens ----------
    home: () => rpc("get_home", { p_household: hid }),
    dues: (days = 30) => rpc("get_dues", { p_household: hid, p_days: days }),
    monthSpend: (month) => rpc("get_month_spend", { p_household: hid, p_month: month ?? iso(new Date()) }),
    transactions: (before) => rpc("list_transactions", {
      p_household: hid, p_before_date: before?.txn_date ?? null, p_before_id: before?.id ?? null, p_limit: 30,
    }),

    // ---------- lists ----------
    categories: async () => must(await sb.from("categories").select("id,name,bucket,household_id").order("name")),
    accounts: async () => must(await sb.from("accounts").select("*").eq("household_id", hid).eq("is_active", true).order("created_at")),
    bills: async () => must(await sb.from("recurring_bills").select("*").eq("household_id", hid).eq("is_active", true).order("next_due_date")),
    loans: async () => must(await sb.from("loans").select("*").eq("household_id", hid).eq("status", "active").order("emi_day")),
    cards: async () => must(await sb.from("credit_cards").select("*").eq("household_id", hid)),
    goals: async () => must(await sb.from("goals").select("*").eq("household_id", hid).neq("status", "paused").order("target_date")),
    holdings: async () => must(await sb.from("holdings").select("*").eq("household_id", hid).order("current_paise", { ascending: false })),
    profile: async () => must(await sb.from("profiles").select("*").maybeSingle()),
    household: async () => must(await sb.from("households").select("*").eq("id", hid).single()),
    loginEvents: async () => must(await sb.from("login_events").select("event,device,created_at").order("created_at", { ascending: false }).limit(8)),

    // ---------- writes ----------
    addAccount: async (a) => must(await sb.from("accounts").insert({ ...a, household_id: hid })),
    addTransaction: async (t) => must(await sb.from("transactions").insert({ ...t, household_id: hid })),
    deleteTransaction: async (t) => must(await sb.from("transactions").delete()
      .eq("household_id", hid).eq("txn_date", t.txn_date).eq("id", t.id)),
    addBill: async (b) => must(await sb.from("recurring_bills").insert({ ...b, household_id: hid })),
    addLoan: async (l) => must(await sb.from("loans").insert({ ...l, household_id: hid, outstanding_paise: l.outstanding_paise ?? l.principal_paise })),
    async addCard(c) {
      const acc = must(await sb.from("accounts").insert({ household_id: hid, kind: "credit_card", name: `${c.issuer} card`, last4: c.last4 }).select("id").single());
      must(await sb.from("credit_cards").insert({ ...c, household_id: hid, account_id: acc.id }));
    },
    addStatement: async (s) => must(await sb.from("card_statements").insert({ ...s, household_id: hid })),
    async payDue(due, accountId) {
      if (due.type === "bill") return rpc("pay_bill", { p_occurrence: due.id, p_account: accountId });
      if (due.type === "emi") return rpc("pay_emi", { p_loan: due.id, p_account: accountId });
      return rpc("pay_card", { p_statement: due.id, p_account: accountId });
    },
    addGoal: async (g) => must(await sb.from("goals").insert({ ...g, household_id: hid })),
    contribute: async (goalId, amount) => must(await sb.from("goal_contributions").insert({ goal_id: goalId, contrib_date: iso(new Date()), amount_paise: amount })),
    addHolding: async (h) => must(await sb.from("holdings").insert({ ...h, household_id: hid })),
    updateHolding: async (id, f) => must(await sb.from("holdings").update({ ...f, updated_at: new Date().toISOString() }).eq("id", id)),
    setInsight: async (id, status) => must(await sb.from("ai_insights").update({ status }).eq("id", id)),
    updateProfile: async (f) => must(await sb.from("profiles").update(f).eq("user_id", (await sb.auth.getUser()).data.user.id)),
    updateSettings: async (settings) => must(await sb.from("households").update({ settings }).eq("id", hid)),

    // ---------- AI ----------
    async ask(question, history) { return (await callAi(sb, { mode: "chat", question, history })).answer; },
    async findSavings() { return (await callAi(sb, { mode: "insights" })).insights; },
  };
}

async function callAi(sb, body) {
  const { data, error } = await sb.functions.invoke("ai-assistant", { body });
  if (error) {
    let msg = "The AI could not answer right now.";
    try { msg = (await error.context.json()).message || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return data;
}

// ===========================================================================
// Demo backend: the worked example from docs/finance-assistant/EARNING-TARGET.md
// ===========================================================================
function demoApi() {
  const today = new Date();
  const d = (n) => iso(addDays(today, n));
  let seq = 1;
  const id = () => `demo-${seq++}`;

  const CATS = [
    ["Salary", "income"], ["Business income", "income"], ["Other income", "income"],
    ["Rent", "fixed"], ["EMI", "fixed"], ["Electricity", "fixed"], ["Mobile & internet", "fixed"], ["Insurance", "fixed"], ["Subscriptions", "fixed"],
    ["School fees", "kids"], ["Tuition & classes", "kids"], ["School transport", "kids"],
    ["Groceries", "daily"], ["Milk & vegetables", "daily"], ["Fuel", "daily"], ["Medicine", "daily"],
    ["Holidays", "sinking"], ["Festivals & gifts", "sinking"], ["Big purchases", "sinking"],
    ["SIP / mutual fund", "invest"], ["Emergency fund", "invest"],
    ["Eating out", "discretionary"], ["Shopping", "discretionary"], ["Entertainment", "discretionary"], ["Other expense", "discretionary"],
    ["Card payment", "transfer"], ["Transfer", "transfer"],
  ].map(([name, bucket], i) => ({ id: i + 1, name, bucket, household_id: null }));
  const cat = (name) => CATS.find((c) => c.name === name).id;

  const s = {
    user: null,
    household: { id: "demo-home", name: "Priya's family", plan_code: "family",
      settings: { buffer_pct: 5, working_days_per_month: 26, real_return_pct: 5, swr_multiple: 25, daily_needs_per_day_paise: 55000 } },
    profile: { full_name: "Priya", ai_consent: false },
    accounts: [
      { id: "acc-bank", kind: "bank", name: "Main bank account", balance_paise: 0, is_active: true },
      { id: "acc-cash", kind: "cash", name: "Cash", balance_paise: 0, is_active: true },
    ],
    bills: [], occurrences: [], loans: [], cards: [], statements: [], goals: [], holdings: [], txns: [], insights: [],
    events: [{ event: "login_ok", device: navigator.userAgent, created_at: new Date().toISOString() }],
  };

  const addBill = (b) => {
    const bill = { id: id(), is_active: true, autopay: false, ...b };
    s.bills.push(bill);
    let due = new Date(bill.next_due_date);
    while (due <= addDays(today, 35)) {
      s.occurrences.push({ id: id(), bill_id: bill.id, due_date: iso(due), amount_paise: bill.amount_paise, status: "due" });
      due = nextDue(due, bill.frequency);
    }
    bill.next_due_date = iso(due);
  };
  [["Electricity, water, gas", "Electricity", "monthly", 320000, 3], ["Phone, internet, OTT", "Mobile & internet", "monthly", 190000, 20],
   ["Term + health insurance", "Insurance", "yearly", 3600000, 60], ["School fees (2 kids)", "School fees", "yearly", 12000000, 90],
   ["Tuition, books, school bus", "Tuition & classes", "monthly", 400000, 25], ["Holiday fund", "Holidays", "yearly", 9000000, 200],
   ["Festivals and gifts", "Festivals & gifts", "yearly", 3600000, 120], ["Emergency fund top-up", "Emergency fund", "monthly", 200000, 28]]
    .forEach(([name, c, frequency, amount_paise, days]) => addBill({ name, category_id: cat(c), frequency, amount_paise, next_due_date: d(days) }));

  const loanDefaults = (l) => {
    const pt = nextDayOfMonth(l.emi_day, today); pt.setMonth(pt.getMonth() - 1);
    return { id: id(), status: "active", outstanding_paise: l.principal_paise, paid_through: iso(pt), ...l };
  };
  s.loans.push(loanDefaults({ loan_type: "home", lender: "SBI", principal_paise: 250000000, outstanding_paise: 200000000, interest_rate_bps: 865, tenure_months: 240, emi_paise: 2150000, emi_day: addDays(today, 4).getDate(), start_date: "2020-01-01" }));
  s.loans.push(loanDefaults({ loan_type: "car", lender: "HDFC Bank", principal_paise: 60000000, outstanding_paise: 30000000, interest_rate_bps: 950, tenure_months: 60, emi_paise: 980000, emi_day: addDays(today, 15).getDate(), start_date: "2024-01-01" }));

  s.cards.push({ id: "card-1", issuer: "HDFC", last4: "4321", credit_limit_paise: 20000000, statement_day: 20, due_day: 9 });
  s.statements.push({ id: id(), card_id: "card-1", statement_date: d(-15), due_date: d(3), total_due_paise: 1840000, min_due_paise: 92000, paid_paise: 0, status: "open" });

  const college = { id: id(), kind: "education", name: "Kids' college", target_paise: 250000000, saved_paise: 250000000, target_date: d(3650), status: "active" };
  s.goals.push(college, { id: id(), kind: "holiday", name: "Goa trip", target_paise: 12000000, saved_paise: 1000000, target_date: d(200), status: "active" });
  s.holdings.push(
    { id: id(), asset_class: "equity_mf", name: "Nifty 50 index fund", invested_paise: 300000000, current_paise: 360000000, sip_paise: 800000, goal_id: null },
    { id: id(), asset_class: "equity_mf", name: "Kids' college fund", invested_paise: 0, current_paise: 0, sip_paise: 300000, goal_id: college.id },
  );

  const tx = (days, amount, c, merchant) => s.txns.push({ id: id(), txn_date: d(-days), amount_paise: amount, category_id: cat(c), merchant, account_id: "acc-bank" });
  tx(0, 2790000, "Salary", "Weekly business income");
  [[0, -45000, "Groceries", "Swiggy Instamart"], [1, -32000, "Milk & vegetables", "Local market"], [2, -150000, "Fuel", "Indian Oil"],
   [3, -64900, "Subscriptions", "Netflix"], [4, -89000, "Eating out", "Zomato"], [5, -21900, "Subscriptions", "Spotify"],
   [6, -54000, "Groceries", "DMart"], [8, -129900, "Subscriptions", "Hotstar + Prime"], [9, -76000, "Shopping", "Myntra"],
   [11, -38000, "Medicine", "Apollo Pharmacy"]].forEach((a) => tx(...a));
  s.insights.push(
    { id: id(), title: "4 subscriptions cost ₹2,247/month", body: "Netflix, Spotify, Hotstar and Prime overlap. Keeping one video app saves about ₹1,300 a month.", saving_paise: 130000, severity: 2, status: "new" },
    { id: id(), title: "Pay the HDFC card in full by " + new Date(d(3)).toLocaleDateString("en-IN", { day: "numeric", month: "short" }), body: "Paying only the minimum ₹920 would cost about ₹650 in interest this month.", saving_paise: 65000, severity: 3, status: "new" },
  );

  const sortByDateDesc = (a, b) => (b.txn_date + b.id).localeCompare(a.txn_date + a.id);
  const loanNext = (l) => nextDayOfMonth(l.emi_day, addDays(new Date(l.paid_through), 1));
  const daySpend = (from) => s.txns.filter((t) => new Date(t.txn_date) >= from && CATS.find((c) => c.id === t.category_id)?.bucket !== "transfer");

  const api = {
    demo: true,
    onAuth(cb) { api._cb = cb; },
    async session() { return s.user ? { user: s.user } : null; },
    async signUp({ name, email }) { s.profile.full_name = name; s.user = { id: "demo-user", email, user_metadata: { full_name: name } }; api._cb?.("SIGNED_IN", { user: s.user }); return { needsConfirm: false }; },
    async signIn(email) { s.user = { id: "demo-user", email, user_metadata: { full_name: s.profile.full_name } }; api._cb?.("SIGNED_IN", { user: s.user }); },
    async sendReset() {},
    async changePassword() { s.events.unshift({ event: "password_changed", device: navigator.userAgent, created_at: new Date().toISOString() }); },
    async verifyPassword() {},
    async signOut() { s.user = null; api._cb?.("SIGNED_OUT", null); },
    async me() { return s.user; },
    async init() { return s.household.id; },

    async home() {
      const target = computeTarget({ bills: s.bills, categories: CATS, loans: s.loans, holdings: s.holdings, goals: s.goals, settings: s.household.settings });
      const monday = new Date(today); monday.setHours(0, 0, 0, 0); monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        household: { id: s.household.id, name: s.household.name, plan: s.household.plan_code, settings: s.household.settings },
        target,
        freedom: computeFreedom({ target, holdings: s.holdings, goals: s.goals, settings: s.household.settings }),
        earned_this_week_paise: daySpend(monday).filter((t) => t.amount_paise > 0).reduce((a, t) => a + t.amount_paise, 0),
        earned_this_month_paise: daySpend(monthStart).filter((t) => t.amount_paise > 0).reduce((a, t) => a + t.amount_paise, 0),
        spent_this_month_paise: -daySpend(monthStart).filter((t) => t.amount_paise < 0).reduce((a, t) => a + t.amount_paise, 0),
        dues_7d: await api.dues(7),
        insights: s.insights.filter((i) => i.status === "new").slice(0, 3),
      };
    },
    async dues(days = 30) {
      const until = addDays(today, days), t0 = iso(today);
      const out = [];
      s.occurrences.filter((o) => o.status !== "paid" && new Date(o.due_date) <= until).forEach((o) => {
        const b = s.bills.find((x) => x.id === o.bill_id);
        out.push({ type: "bill", id: o.id, name: b.name, amount_paise: o.amount_paise, due_date: o.due_date, status: o.due_date < t0 ? "overdue" : "due", autopay: b.autopay });
      });
      s.loans.filter((l) => l.status === "active").forEach((l) => {
        const nd = loanNext(l);
        if (nd <= until) out.push({ type: "emi", id: l.id, name: `${l.loan_type[0].toUpperCase() + l.loan_type.slice(1)} loan · ${l.lender}`, amount_paise: l.emi_paise, due_date: iso(nd), status: iso(nd) < t0 ? "overdue" : "due" });
      });
      s.statements.filter((st) => st.status !== "paid" && new Date(st.due_date) <= until).forEach((st) => {
        const c = s.cards.find((x) => x.id === st.card_id);
        out.push({ type: "card", id: st.id, name: `${c.issuer} card ••${c.last4}`, amount_paise: st.total_due_paise - st.paid_paise, due_date: st.due_date, status: st.due_date < t0 ? "overdue" : "due" });
      });
      return out.sort((a, b) => a.due_date.localeCompare(b.due_date) || b.amount_paise - a.amount_paise);
    },
    async monthSpend() {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const by = {};
      daySpend(start).filter((t) => t.amount_paise < 0).forEach((t) => {
        const c = CATS.find((x) => x.id === t.category_id);
        by[c.name] ??= { category: c.name, bucket: c.bucket, spend_paise: 0, count: 0 };
        by[c.name].spend_paise -= t.amount_paise; by[c.name].count++;
      });
      return Object.values(by).sort((a, b) => b.spend_paise - a.spend_paise);
    },
    async transactions(before) {
      const all = [...s.txns].sort(sortByDateDesc);
      const start = before ? all.findIndex((t) => t.id === before.id) + 1 : 0;
      return all.slice(start, start + 30);
    },
    categories: async () => CATS,
    accounts: async () => s.accounts,
    bills: async () => s.bills,
    loans: async () => s.loans.filter((l) => l.status === "active"),
    cards: async () => s.cards,
    goals: async () => s.goals,
    holdings: async () => s.holdings,
    profile: async () => s.profile,
    household: async () => s.household,
    loginEvents: async () => s.events,

    addAccount: async (a) => { s.accounts.push({ id: id(), is_active: true, balance_paise: 0, ...a }); },
    addTransaction: async (t) => { s.txns.push({ id: id(), ...t }); },
    deleteTransaction: async (t) => { s.txns = s.txns.filter((x) => x.id !== t.id); },
    addBill: async (b) => addBill(b),
    addLoan: async (l) => { s.loans.push(loanDefaults(l)); },
    addCard: async (c) => { s.cards.push({ id: id(), ...c }); },
    addStatement: async (st) => { s.statements.push({ id: id(), paid_paise: 0, status: "open", ...st }); },
    async payDue(due, accountId) {
      if (due.type === "bill") {
        const o = s.occurrences.find((x) => x.id === due.id); o.status = "paid";
        const b = s.bills.find((x) => x.id === o.bill_id);
        s.txns.push({ id: id(), txn_date: iso(today), amount_paise: -o.amount_paise, category_id: b.category_id, merchant: b.name, account_id: accountId });
      } else if (due.type === "emi") {
        const l = s.loans.find((x) => x.id === due.id);
        const interest = Math.round(l.outstanding_paise * l.interest_rate_bps / 120000);
        l.outstanding_paise = Math.max(l.outstanding_paise - Math.max(l.emi_paise - interest, 0), 0);
        l.paid_through = due.due_date;
        if (!l.outstanding_paise) l.status = "closed";
        s.txns.push({ id: id(), txn_date: iso(today), amount_paise: -l.emi_paise, category_id: cat("EMI"), merchant: l.lender, account_id: accountId });
      } else {
        const st = s.statements.find((x) => x.id === due.id);
        const amt = st.total_due_paise - st.paid_paise; st.paid_paise += amt; st.status = "paid";
        s.txns.push({ id: id(), txn_date: iso(today), amount_paise: -amt, category_id: cat("Card payment"), merchant: due.name, account_id: accountId });
      }
    },
    addGoal: async (g) => { s.goals.push({ id: id(), saved_paise: 0, status: "active", ...g }); },
    contribute: async (goalId, amount) => {
      const g = s.goals.find((x) => x.id === goalId); g.saved_paise += amount;
      if (g.saved_paise >= g.target_paise) g.status = "achieved";
    },
    addHolding: async (h) => { s.holdings.push({ id: id(), ...h }); },
    updateHolding: async (hId, f) => Object.assign(s.holdings.find((x) => x.id === hId), f),
    setInsight: async (iId, status) => { s.insights.find((x) => x.id === iId).status = status; },
    updateProfile: async (f) => Object.assign(s.profile, f),
    updateSettings: async (settings) => { s.household.settings = settings; },

    async ask(question) {
      if (!s.profile.ai_consent) throw new Error("Switch on AI help in Settings first.");
      const h = await api.home();
      const r = (p) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
      return `Demo mode (no AI connected). From your numbers: you need ${r(h.target.daily_paise)} a day, ` +
        `${r(h.target.weekly_paise)} a week. Freedom is ${h.freedom.pct}% done, about ${h.freedom.years} years away.\n\n` +
        `You asked: "${question}". Connect Supabase and the ai-assistant function to get real answers.`;
    },
    async findSavings() {
      if (!s.profile.ai_consent) throw new Error("Switch on AI help in Settings first.");
      return s.insights.filter((i) => i.status === "new");
    },
  };
  return api;
}

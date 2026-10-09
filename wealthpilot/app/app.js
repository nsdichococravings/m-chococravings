// WealthPilot app: login, Home, Money, Dues, Goals & Investments, Ask AI, Settings.
import { createApi } from "./api.js";
import { whatIf, monthsUntil } from "./engine.js";

const config = window.WEALTHPILOT_CONFIG || {};
let api;
let user = null;
let cache = { categories: [], accounts: [] };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const rupees = (paise) => inr.format(Math.round((Number(paise) || 0) / 100));
const toPaise = (v) => Math.round(parseFloat(String(v).replace(/[,₹\s]/g, "")) * 100) || 0;
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fmtDate = (iso, opts = { day: "numeric", month: "short" }) => iso ? new Date(iso).toLocaleDateString("en-IN", opts) : "";
const daysFrom = (iso) => Math.round((new Date(iso) - new Date(todayIso())) / 86400000);
const whenText = (iso) => { const n = daysFrom(iso); return n === 0 ? "Today" : n === 1 ? "Tomorrow" : n < 0 ? `${-n} days late` : `In ${n} days`; };
const pct = (a, b) => (b > 0 ? Math.min(100, Math.round((a / b) * 100)) : 0);
const yearsText = (y) => (y == null ? "—" : y === 0 ? "Reached!" : `${y} years`);

const ICON = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  money: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 10v5M18 10v5"/></svg>',
  dues: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h3"/></svg>',
  grow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.4L12 15l-1.8-4.6L5.5 9l4.7-1.4z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
};
const TYPE_ICON = { bill: "🧾", emi: "🏦", card: "💳" };
const BUCKET_ICON = { income: "💰", fixed: "🏠", kids: "🎒", daily: "🛒", sinking: "🏖️", invest: "📈", discretionary: "🛍️", transfer: "🔁" };
const BUCKET_LABEL = { fixed: "Bills & EMIs", kids: "Kids' education", daily: "Daily needs", sinking: "Holidays & goals", invest: "Investing" };

function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function sheet(title, html, onMount) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-backdrop";
  wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grip"></div><h3>${esc(title)}</h3>${html}</div>`;
  const close = () => wrap.remove();
  wrap.addEventListener("click", (e) => { if (e.target === wrap) close(); });
  document.body.appendChild(wrap);
  onMount?.(wrap.querySelector(".sheet"), close);
  wrap.querySelector("input,select,textarea,button")?.focus();
  return close;
}

// fields: [{ name, label, type, options:[[value,label]], value, required, hint, step, min }]
function formHtml(fields, submitLabel) {
  const f = fields.map((x) => {
    const req = x.required ? "required" : "";
    let input;
    if (x.type === "select") {
      input = `<select name="${x.name}" ${req}>${x.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(x.value ?? "") ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    } else if (x.type === "textarea") {
      input = `<textarea name="${x.name}" rows="3" ${req}>${esc(x.value ?? "")}</textarea>`;
    } else {
      const t = x.type === "money" ? "text" : (x.type || "text");
      const extra = x.type === "money" ? 'inputmode="decimal" placeholder="₹"' : "";
      input = `<input name="${x.name}" type="${t}" ${extra} value="${esc(x.value ?? "")}" ${req} ${x.step ? `step="${x.step}"` : ""} ${x.min != null ? `min="${x.min}"` : ""} ${x.max != null ? `max="${x.max}"` : ""} ${x.autocomplete ? `autocomplete="${x.autocomplete}"` : ""}>`;
    }
    return `<label class="field">${esc(x.label)}${input}${x.hint ? `<span class="hint">${esc(x.hint)}</span>` : ""}</label>`;
  }).join("");
  return `<form class="form">${f}<div class="error hidden"></div><button class="btn block" type="submit">${esc(submitLabel)}</button></form>`;
}

function formSheet(title, fields, submitLabel, onSubmit) {
  sheet(title, formHtml(fields, submitLabel), (root, close) => {
    const form = $("form", root);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", form), err = $(".error", form);
      const values = Object.fromEntries(new FormData(form).entries());
      btn.disabled = true; err.classList.add("hidden");
      try {
        await onSubmit(values);
        close();
        render();
      } catch (ex) {
        err.textContent = ex.message; err.classList.remove("hidden");
      } finally { btn.disabled = false; }
    });
  });
}

const categoryOptions = (kind) => cache.categories
  .filter((c) => (kind === "income" ? c.bucket === "income" : !["income", "transfer"].includes(c.bucket)))
  .map((c) => [c.id, c.name]);
const accountOptions = (filter = () => true) => cache.accounts.filter(filter).map((a) => [a.id, a.name + (a.last4 ? ` ••${a.last4}` : "")]);

// ---------------------------------------------------------------------------
// password rules (shown live on sign-up, reset and change password)
// ---------------------------------------------------------------------------
function passwordCheck(pw, email = "", name = "") {
  const lower = pw.toLowerCase();
  const local = (email.split("@")[0] || "").toLowerCase();
  const nameParts = name.toLowerCase().split(/\s+/).filter((p) => p.length >= 3);
  const rules = [
    { ok: pw.length >= 10, label: "At least 10 characters" },
    { ok: pw.length <= 72, label: "No more than 72 characters" },
    { ok: !(local.length >= 3 && lower.includes(local)) && !nameParts.some((p) => lower.includes(p)), label: "Doesn't contain your name or email" },
    { ok: !/^(.)\1+$/.test(pw) && !/^(1234|password|qwerty)/i.test(pw), label: "Not an easy-to-guess pattern" },
  ];
  const variety = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = 0;
  if (pw.length >= 10) score = 1;
  if (pw.length >= 12 && variety >= 2) score = 2;
  if (pw.length >= 14 && variety >= 3) score = 3;
  if (pw.length >= 16 && variety >= 3) score = 4;
  if (!rules.every((r) => r.ok)) score = Math.min(score, 1);
  return { ok: rules.every((r) => r.ok), rules, score };
}

function passwordField(name = "password", label = "Password", autocomplete = "new-password") {
  return `<label class="field">${label}<input name="${name}" type="password" autocomplete="${autocomplete}" required>
    <div class="strength" data-score="0"><span></span><span></span><span></span><span></span></div>
    <ul class="rules"></ul></label>`;
}

function bindPasswordRules(form, getEmail = () => "", getName = () => "", name = "password") {
  const input = form.querySelector(`input[name=${name}]`);
  const update = () => {
    const r = passwordCheck(input.value, getEmail(), getName());
    form.querySelector(".strength").dataset.score = input.value ? r.score : 0;
    form.querySelector(".rules").innerHTML = r.rules.map((x) => `<li class="${x.ok && input.value ? "met" : ""}">${x.label}</li>`).join("");
  };
  input.addEventListener("input", update);
  update();
  return () => passwordCheck(input.value, getEmail(), getName());
}

// ---------------------------------------------------------------------------
// login screens
// ---------------------------------------------------------------------------
let authMode = "signin";
let recovering = false;

function renderAuth() {
  const root = $("#root");
  const brand = `<div class="brand"><div class="logo">₹</div>WealthPilot</div>`;
  const demo = api.demo ? `<div class="demo-banner">Demo mode: any email and password works, and nothing is saved. Add your Supabase keys in config.js to go live.</div>` : "";
  let body;
  if (recovering) {
    body = `<div><h2 style="margin:0">Set a new password</h2><p class="muted small">Choose a new password for your account. Other devices will be signed out.</p></div>
      <form class="form" id="f-reset">${passwordField()}
        <label class="field">Confirm password<input name="confirm" type="password" autocomplete="new-password" required></label>
        <div class="error hidden"></div><button class="btn block">Save new password</button></form>`;
  } else if (authMode === "forgot") {
    body = `<div><h2 style="margin:0">Forgot password?</h2><p class="muted small">We'll email you a link to set a new one. It works once and expires in 1 hour.</p></div>
      <form class="form" id="f-forgot"><label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
        <div class="error hidden"></div><div class="success hidden"></div><button class="btn block">Send reset link</button></form>
      <button class="linkish" data-mode="signin">Back to sign in</button>`;
  } else {
    const signup = authMode === "signup";
    body = `<div class="tabs" role="tablist"><button class="${signup ? "" : "active"}" data-mode="signin">Sign in</button><button class="${signup ? "active" : ""}" data-mode="signup">Create account</button></div>
      <form class="form" id="f-auth">
        ${signup ? `<label class="field">Your name<input name="name" autocomplete="name" required></label>` : ""}
        <label class="field">Email<input name="email" type="email" autocomplete="email" required></label>
        ${signup ? passwordField() : `<label class="field">Password<input name="password" type="password" autocomplete="current-password" required></label>`}
        ${signup ? `<label class="field">Confirm password<input name="confirm" type="password" autocomplete="new-password" required></label>` : ""}
        <div class="error hidden"></div><div class="success hidden"></div>
        <button class="btn block">${signup ? "Create account" : "Sign in"}</button>
      </form>
      ${signup ? "" : `<button class="linkish" data-mode="forgot">Forgot password?</button>`}`;
  }
  root.innerHTML = `<div class="auth"><div class="panel">${brand}${demo}<div class="card stack" style="gap:16px">${body}</div>
    <p class="tiny muted" style="text-align:center">Your password is never stored by WealthPilot. Only a secure hash is kept by our sign-in service.</p></div></div>`;

  root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { authMode = b.dataset.mode; renderAuth(); }));
  const show = (form, cls, msg) => { const el = $(`.${cls}`, form); el.textContent = msg; el.classList.remove("hidden"); };
  const hideMsgs = (form) => form.querySelectorAll(".error,.success").forEach((e) => e.classList.add("hidden"));

  const fAuth = $("#f-auth");
  if (fAuth) {
    const check = authMode === "signup"
      ? bindPasswordRules(fAuth, () => fAuth.email.value, () => fAuth.name.value) : null;
    fAuth.addEventListener("submit", async (e) => {
      e.preventDefault(); hideMsgs(fAuth);
      const btn = $("button", fAuth); btn.disabled = true;
      const { name, email, password, confirm } = Object.fromEntries(new FormData(fAuth).entries());
      try {
        if (authMode === "signup") {
          if (!check().ok) throw new Error("Please choose a stronger password (see the rules above).");
          if (password !== confirm) throw new Error("The two passwords don't match.");
          const r = await api.signUp({ name: name.trim(), email: email.trim(), password });
          if (r.needsConfirm) show(fAuth, "success", "Almost done! We sent a link to " + email + ". Open it to confirm your email, then sign in.");
        } else {
          await api.signIn(email.trim(), password);
        }
      } catch (ex) { show(fAuth, "error", ex.message); } finally { btn.disabled = false; }
    });
  }
  const fForgot = $("#f-forgot");
  fForgot?.addEventListener("submit", async (e) => {
    e.preventDefault(); hideMsgs(fForgot);
    try {
      await api.sendReset(fForgot.email.value.trim());
      show(fForgot, "success", "If that email has an account, a reset link is on its way.");
    } catch (ex) { show(fForgot, "error", ex.message); }
  });
  const fReset = $("#f-reset");
  if (fReset) {
    const check = bindPasswordRules(fReset, () => user?.email || "", () => user?.user_metadata?.full_name || "");
    fReset.addEventListener("submit", async (e) => {
      e.preventDefault(); hideMsgs(fReset);
      try {
        if (!check().ok) throw new Error("Please choose a stronger password.");
        if (fReset.password.value !== fReset.confirm.value) throw new Error("The two passwords don't match.");
        await api.changePassword(fReset.password.value);
        recovering = false;
        toast("Password updated");
        location.hash = "#/home";
        render();
      } catch (ex) { show(fReset, "error", ex.message); }
    });
  }
}

// ---------------------------------------------------------------------------
// app shell
// ---------------------------------------------------------------------------
const TABS = [["home", "Home"], ["money", "Money"], ["dues", "Dues"], ["grow", "Goals"], ["ai", "Ask AI"]];
const route = () => (location.hash.replace(/^#\/?/, "").split("?")[0] || "home");

async function render() {
  if (!user) return renderAuth();
  if (recovering) return renderAuth();
  const r = route();
  const views = { home: viewHome, money: viewMoney, dues: viewDues, grow: viewGrow, ai: viewAi, settings: viewSettings };
  const view = views[r] || viewHome;
  const root = $("#root");
  if (!$(".app", root)) {
    root.innerHTML = `<div class="app"><header class="topbar"><div><h1 id="title"></h1><div class="sub" id="subtitle"></div></div>
      <a class="icon-btn" href="#/settings" aria-label="Settings">${ICON.gear}</a></header>
      ${api.demo ? `<div class="demo-banner">Demo mode with sample numbers. Nothing is saved.</div>` : ""}
      <main id="view" aria-live="polite"></main></div>
      <button class="fab" id="fab" aria-label="Quick add expense or income">${ICON.plus}</button>
      <nav class="bottom-nav" aria-label="Main"><div class="inner">${TABS.map(([k, l]) => `<a href="#/${k}" data-tab="${k}">${ICON[k]}<span>${l}</span></a>`).join("")}</div></nav>`;
    $("#fab").addEventListener("click", quickAdd);
  }
  document.querySelectorAll(".bottom-nav a").forEach((a) => a.classList.toggle("active", a.dataset.tab === r));
  $("#fab").classList.toggle("hidden", r === "ai" || r === "settings");
  const main = $("#view");
  try {
    await view(main);
  } catch (ex) {
    console.error(ex);
    main.innerHTML = `<div class="card error">Something went wrong: ${esc(ex.message)}</div>`;
  }
}

function setTitle(t, sub = "") { $("#title").textContent = t; $("#subtitle").textContent = sub; document.title = `${t} · WealthPilot`; }

async function refreshCache() {
  [cache.categories, cache.accounts] = await Promise.all([api.categories(), api.accounts()]);
}

function quickAdd(kind = "expense") {
  if (typeof kind !== "string") kind = "expense";
  sheet("Quick add", `<div class="tabs" style="margin-bottom:14px"><button data-k="expense" class="${kind === "expense" ? "active" : ""}">Expense</button><button data-k="income" class="${kind === "income" ? "active" : ""}">Income</button></div><div id="qa"></div>`, (root, close) => {
    root.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { close(); quickAdd(b.dataset.k); }));
    $("#qa", root).innerHTML = formHtml([
      { name: "amount", label: "Amount", type: "money", required: true },
      { name: "category_id", label: "Category", type: "select", options: categoryOptions(kind), required: true },
      { name: "merchant", label: kind === "income" ? "From" : "Where / what", hint: kind === "income" ? "e.g. Salary, client name" : "e.g. DMart, petrol, school canteen" },
      { name: "account_id", label: "Account", type: "select", options: accountOptions((a) => a.kind !== "loan" && a.kind !== "investment"), required: true },
      { name: "txn_date", label: "Date", type: "date", value: todayIso(), required: true },
    ], kind === "income" ? "Add income" : "Add expense");
    const form = $("form", root);
    form.amount.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(form).entries());
      const amt = toPaise(v.amount);
      const err = $(".error", form);
      if (amt <= 0) { err.textContent = "Enter an amount more than zero."; err.classList.remove("hidden"); return; }
      try {
        await api.addTransaction({ account_id: v.account_id, txn_date: v.txn_date, amount_paise: kind === "income" ? amt : -amt,
          category_id: Number(v.category_id), merchant: v.merchant || null, source: "manual" });
        close(); toast(kind === "income" ? "Income added" : "Expense added"); render();
      } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
    });
  });
}

function payDue(due) {
  const accs = accountOptions((a) => ["bank", "cash", "wallet"].includes(a.kind));
  sheet(`Pay ${due.name}`, `<p class="muted" style="margin-top:-6px">${rupees(due.amount_paise)} · due ${fmtDate(due.due_date)}</p>
    ${formHtml([{ name: "account", label: "Paid from", type: "select", options: accs, required: true }], "Mark as paid")}`, (root, close) => {
    $("form", root).addEventListener("submit", async (e) => {
      e.preventDefault();
      try { await api.payDue(due, e.target.account.value); close(); toast("Marked as paid"); render(); } catch (ex) {
        const err = $(".error", root); err.textContent = ex.message; err.classList.remove("hidden");
      }
    });
  });
}

function dueItem(d) {
  const late = d.status === "overdue" || daysFrom(d.due_date) < 0;
  const chip = late ? "bad" : daysFrom(d.due_date) <= 3 ? "warn" : "info";
  return `<div class="item"><div class="dot">${TYPE_ICON[d.type]}</div><div class="grow"><div class="title">${esc(d.name)}</div>
    <div class="meta"><span class="chip ${chip}">${whenText(d.due_date)}</span> ${fmtDate(d.due_date)}${d.autopay ? " · autopay" : ""}</div></div>
    <div style="text-align:right"><div class="amount">${rupees(d.amount_paise)}</div><button class="btn small soft" data-pay='${esc(JSON.stringify(d))}'>Pay</button></div></div>`;
}
function bindPay(root) { root.querySelectorAll("[data-pay]").forEach((b) => b.addEventListener("click", () => payDue(JSON.parse(b.dataset.pay)))); }

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------
async function viewHome(main) {
  const h = await api.home();
  const name = (user.user_metadata?.full_name || "").split(" ")[0];
  const hr = new Date().getHours();
  setTitle(`${hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening"}${name ? ", " + esc(name) : ""}`, h.household?.name || "");
  const t = h.target, f = h.freedom;
  const empty = !t || t.monthly_paise === 0;
  const weekPct = pct(h.earned_this_week_paise, t.weekly_paise);
  const duesTotal = h.dues_7d.reduce((s, d) => s + d.amount_paise, 0);

  main.innerHTML = `
    ${empty ? `<div class="card stack"><h3>Let's find your number</h3><p class="muted small" style="margin:0">Add what you pay every month and WealthPilot works out how much you need to earn each day and week.</p>
      <div class="btn-row"><a class="btn small" href="#/dues">1. Add EMIs, cards &amp; bills</a><a class="btn small ghost" href="#/settings">2. Daily spend</a><a class="btn small ghost" href="#/grow">3. Goals &amp; SIPs</a></div></div>` : ""}
    <section class="card hero stack" aria-label="Earning target">
      <h2>Your earning target</h2>
      <div class="split"><div><div class="big num">${rupees(t.daily_paise)}</div><div class="muted small">per day</div></div>
        <div><div class="big num">${rupees(t.weekly_paise)}</div><div class="muted small">per week</div></div></div>
      <div class="bar" aria-label="Earned this week ${weekPct} percent"><span style="width:${weekPct}%"></span></div>
      <div class="row small"><span>Earned this week: <b class="num">${rupees(h.earned_this_week_paise)}</b></span><span>${weekPct}%</span></div>
      <div class="row small"><span class="muted">Per month ${rupees(t.monthly_paise)} · per working day ${rupees(t.working_day_paise)}</span>
        <button class="linkish" style="color:#fff;text-decoration:underline" id="why">Why?</button></div>
    </section>

    <section class="card"><div class="row"><h2>Due in the next 7 days</h2><span class="amount">${rupees(duesTotal)}</span></div>
      <div class="list">${h.dues_7d.length ? h.dues_7d.map(dueItem).join("") : `<div class="empty">Nothing due this week 🎉</div>`}</div>
      <a class="btn small ghost block" href="#/dues" style="margin-top:8px">See all dues</a></section>

    <section class="card stack"><h2>Financial freedom</h2>
      <div class="row"><div class="mid num">${f.pct}%</div><div style="text-align:right"><div class="small muted">Freedom date</div><b>${f.freedom_date ? fmtDate(f.freedom_date, { month: "short", year: "numeric" }) : "—"}</b></div></div>
      <div class="bar"><span style="width:${f.pct}%"></span></div>
      <div class="small muted">${rupees(f.corpus_paise)} of ${rupees(f.fi_number_paise)} invested · ${yearsText(f.years)} to go</div>
      ${f.fi_number_paise > 0 ? `<label class="field" style="margin-top:6px">What if I earn and invest more each day? <b id="wi-amt">+₹0 / day</b>
        <input type="range" id="wi" min="0" max="3000" step="100" value="0" aria-label="Extra rupees per day"></label>
        <div class="small" id="wi-out">Move the slider to see your new freedom date.</div>` : ""}
    </section>

    <section class="card"><div class="row"><h2>AI tips</h2><a class="linkish small" href="#/ai">Ask AI</a></div>
      <div class="list">${h.insights.length ? h.insights.map((i) => `<div class="item"><div class="dot">${i.severity >= 3 ? "⚠️" : "💡"}</div>
        <div class="grow"><div class="title" style="white-space:normal">${esc(i.title)}</div><div class="meta">${esc(i.body)}</div>
        ${i.saving_paise ? `<div class="chip ok" style="margin-top:4px">Save ${rupees(i.saving_paise)}/month</div>` : ""}
        <div class="btn-row" style="margin-top:8px"><button class="btn small soft" data-ins="${i.id}" data-st="accepted">Done</button><button class="btn small ghost" data-ins="${i.id}" data-st="dismissed">Dismiss</button></div></div></div>`).join("")
        : `<div class="empty">No tips yet. Open Ask AI and tap "Find savings".</div>`}</div></section>`;

  bindPay(main);
  $("#why", main).addEventListener("click", () => {
    const b = t.breakdown_paise;
    sheet("Why this number?", `<div class="list">${Object.entries(BUCKET_LABEL).map(([k, l]) => `<div class="item"><div class="dot">${BUCKET_ICON[k]}</div><div class="grow"><div class="title">${l}</div>
      ${k === "fixed" && b.emi ? `<div class="meta">includes EMIs ${rupees(b.emi)}</div>` : ""}</div><div class="amount">${rupees(b[k])}</div></div>`).join("")}
      <div class="item"><div class="dot">🛟</div><div class="grow"><div class="title">Safety buffer ${t.buffer_pct}%</div></div>
      <div class="amount">${rupees(t.monthly_paise - Object.keys(BUCKET_LABEL).reduce((s, k) => s + b[k], 0))}</div></div>
      <div class="item"><div class="grow"><div class="title">Needed per month</div><div class="meta">÷ 365 × 12 = per day, × 7 = per week</div></div><div class="amount">${rupees(t.monthly_paise)}</div></div></div>`);
  });
  const wi = $("#wi", main);
  wi?.addEventListener("input", () => {
    const extra = Number(wi.value) * 100;
    $("#wi-amt", main).textContent = `+₹${Number(wi.value).toLocaleString("en-IN")} / day`;
    const r = whatIf(f, extra);
    $("#wi-out", main).innerHTML = !extra ? "Move the slider to see your new freedom date."
      : r ? `Freedom in <b>${r.years} years</b> (${r.date.toLocaleDateString("en-IN", { month: "short", year: "numeric" })})${f.years != null ? `, <b>${Math.max(0, Math.round((f.years - r.years) * 10) / 10)} years sooner</b>` : ""}.` : "Add investments to see this.";
  });
  main.querySelectorAll("[data-ins]").forEach((b) => b.addEventListener("click", async () => { await api.setInsight(b.dataset.ins, b.dataset.st); render(); }));
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------
async function viewMoney(main) {
  setTitle("Money", new Date().toLocaleDateString("en-IN", { month: "long", year: "numeric" }));
  const [h, spend, txns] = await Promise.all([api.home(), api.monthSpend(), api.transactions()]);
  const maxSpend = Math.max(1, ...spend.map((s) => s.spend_paise));
  const catName = (id) => cache.categories.find((c) => c.id === id);
  const txHtml = (list) => list.map((t) => {
    const c = catName(t.category_id);
    return `<div class="item"><div class="dot">${BUCKET_ICON[c?.bucket] || "•"}</div><div class="grow"><div class="title">${esc(t.merchant || c?.name || "Transaction")}</div>
      <div class="meta">${esc(c?.name || "Uncategorised")} · ${fmtDate(t.txn_date)}</div></div>
      <div class="amount ${t.amount_paise > 0 ? "pos" : "neg"}">${t.amount_paise > 0 ? "+" : "−"}${rupees(Math.abs(t.amount_paise))}</div>
      <button class="icon-btn" style="width:32px;height:32px;border:0" aria-label="Delete" data-del='${esc(JSON.stringify({ id: t.id, txn_date: t.txn_date }))}'>✕</button></div>`;
  }).join("");

  main.innerHTML = `
    <section class="split">
      <div class="card"><h2>Earned</h2><div class="mid num pos">${rupees(h.earned_this_month_paise)}</div><div class="tiny muted">this month</div></div>
      <div class="card"><h2>Spent</h2><div class="mid num">${rupees(h.spent_this_month_paise)}</div><div class="tiny muted">this month</div></div>
    </section>
    <section class="card"><h2>Where the money went</h2><div class="stack">${spend.length ? spend.slice(0, 8).map((s) => `<div class="spend-bar"><span class="small">${BUCKET_ICON[s.bucket] || ""} ${esc(s.category)}</span>
      <span class="small amount">${rupees(s.spend_paise)}</span><div class="bar"><span style="width:${pct(s.spend_paise, maxSpend)}%"></span></div></div>`).join("")
      : `<div class="empty">No spending yet this month.</div>`}</div></section>
    <section class="card"><div class="row"><h2>Transactions</h2><div class="btn-row"><button class="btn small soft" id="add-inc">+ Income</button><button class="btn small soft" id="add-exp">+ Expense</button></div></div>
      <div class="list" id="tx">${txns.length ? txHtml(txns) : `<div class="empty">No transactions yet. Tap + to add your first one.</div>`}</div>
      ${txns.length >= 30 ? `<button class="btn small ghost block" id="more">Load more</button>` : ""}</section>`;

  let last = txns[txns.length - 1];
  const bindDel = (root) => root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Delete this transaction?")) return;
    await api.deleteTransaction(JSON.parse(b.dataset.del)); toast("Deleted"); render();
  }));
  bindDel(main);
  $("#add-inc", main).addEventListener("click", () => quickAdd("income"));
  $("#add-exp", main).addEventListener("click", () => quickAdd("expense"));
  $("#more", main)?.addEventListener("click", async (e) => {
    const more = await api.transactions(last);
    if (more.length) { const frag = document.createElement("div"); frag.innerHTML = txHtml(more); bindDel(frag); $("#tx", main).append(...frag.children); last = more[more.length - 1]; }
    if (more.length < 30) e.target.remove();
  });
}

// ---------------------------------------------------------------------------
// Dues: bills, EMIs, credit cards
// ---------------------------------------------------------------------------
async function viewDues(main) {
  setTitle("Dues", "Bills, EMIs and card payments");
  const [dues, bills, loans, cards] = await Promise.all([api.dues(30), api.bills(), api.loans(), api.cards()]);
  const late = dues.filter((d) => daysFrom(d.due_date) < 0);
  const week = dues.filter((d) => daysFrom(d.due_date) >= 0 && daysFrom(d.due_date) <= 7);
  const later = dues.filter((d) => daysFrom(d.due_date) > 7);
  const group = (title, list, cls = "") => list.length ? `<section class="card ${cls}"><div class="row"><h2>${title}</h2><span class="amount">${rupees(list.reduce((s, d) => s + d.amount_paise, 0))}</span></div><div class="list">${list.map(dueItem).join("")}</div></section>` : "";
  const freqLabel = { weekly: "Weekly", monthly: "Monthly", quarterly: "Every 3 months", half_yearly: "Every 6 months", yearly: "Yearly" };

  main.innerHTML = `
    <div class="btn-row"><button class="btn small" id="add-bill">+ Bill</button><button class="btn small" id="add-loan">+ Loan / EMI</button>
      <button class="btn small" id="add-card">+ Credit card</button>${cards.length ? `<button class="btn small soft" id="add-stmt">+ Card bill</button>` : ""}</div>
    ${group("Overdue", late)}${group("This week", week)}${group("Later this month", later)}
    ${dues.length ? "" : `<div class="card empty">Nothing due in the next 30 days.</div>`}
    <section class="card"><h2>EMIs</h2><div class="list">${loans.length ? loans.map((l) => `<div class="item"><div class="dot">🏦</div><div class="grow"><div class="title">${esc(l.lender)} · ${esc(l.loan_type)} loan</div>
      <div class="meta">${rupees(l.emi_paise)} on day ${l.emi_day} · ${(l.interest_rate_bps / 100).toFixed(2)}% · ${rupees(l.outstanding_paise)} left</div></div></div>`).join("") : `<div class="empty">No loans added.</div>`}</div></section>
    <section class="card"><h2>Credit cards</h2><div class="list">${cards.length ? cards.map((c) => `<div class="item"><div class="dot">💳</div><div class="grow"><div class="title">${esc(c.issuer)} ••${esc(c.last4)}</div>
      <div class="meta">Limit ${rupees(c.credit_limit_paise)} · statement day ${c.statement_day} · due day ${c.due_day}</div></div></div>`).join("") : `<div class="empty">No cards added.</div>`}</div></section>
    <section class="card"><h2>Regular bills</h2><div class="list">${bills.length ? bills.map((b) => `<div class="item"><div class="dot">🧾</div><div class="grow"><div class="title">${esc(b.name)}</div>
      <div class="meta">${freqLabel[b.frequency]} · next ${fmtDate(b.next_due_date)}</div></div><div class="amount">${rupees(b.amount_paise)}</div></div>`).join("") : `<div class="empty">No bills added.</div>`}</div></section>`;
  bindPay(main);

  const nonIncome = cache.categories.filter((c) => !["income", "transfer"].includes(c.bucket)).map((c) => [c.id, `${c.name} (${BUCKET_LABEL[c.bucket] || c.bucket})`]);
  $("#add-bill", main).addEventListener("click", () => formSheet("Add a regular bill", [
    { name: "name", label: "Name", required: true, hint: "e.g. Electricity, School fees – Aarav, Netflix, Holiday fund" },
    { name: "amount", label: "Amount", type: "money", required: true },
    { name: "frequency", label: "How often", type: "select", value: "monthly", options: Object.entries(freqLabel) },
    { name: "category_id", label: "Category", type: "select", options: nonIncome, required: true, hint: "Decides where it counts in your earning target" },
    { name: "next_due_date", label: "Next due date", type: "date", required: true, value: todayIso() },
    { name: "autopay", label: "Paid automatically?", type: "select", options: [["false", "No"], ["true", "Yes, autopay"]] },
  ], "Add bill", (v) => api.addBill({ name: v.name, amount_paise: toPaise(v.amount), frequency: v.frequency, category_id: Number(v.category_id),
    next_due_date: v.next_due_date, due_day: new Date(v.next_due_date).getDate(), autopay: v.autopay === "true" })));

  $("#add-loan", main).addEventListener("click", () => formSheet("Add a loan / EMI", [
    { name: "loan_type", label: "Type", type: "select", options: [["home", "Home"], ["car", "Car"], ["personal", "Personal"], ["education", "Education"], ["gold", "Gold"], ["business", "Business"], ["other", "Other"]] },
    { name: "lender", label: "Bank / lender", required: true },
    { name: "emi", label: "EMI amount", type: "money", required: true },
    { name: "emi_day", label: "EMI date (day of month)", type: "number", min: 1, max: 31, required: true },
    { name: "principal", label: "Original loan amount", type: "money", required: true },
    { name: "outstanding", label: "Amount still to pay", type: "money", hint: "From your loan statement; leave empty if new" },
    { name: "rate", label: "Interest rate % per year", type: "number", step: "0.01", required: true },
    { name: "tenure", label: "Tenure (months)", type: "number", min: 1, required: true },
    { name: "start_date", label: "Loan start date", type: "date", required: true },
  ], "Add loan", (v) => api.addLoan({ loan_type: v.loan_type, lender: v.lender, emi_paise: toPaise(v.emi), emi_day: Number(v.emi_day),
    principal_paise: toPaise(v.principal), outstanding_paise: v.outstanding ? toPaise(v.outstanding) : toPaise(v.principal),
    interest_rate_bps: Math.round(Number(v.rate) * 100), tenure_months: Number(v.tenure), start_date: v.start_date })));

  $("#add-card", main).addEventListener("click", () => formSheet("Add a credit card", [
    { name: "issuer", label: "Bank", required: true, hint: "e.g. HDFC, SBI, ICICI" },
    { name: "last4", label: "Last 4 digits only", required: true, hint: "Never enter the full card number" },
    { name: "limit", label: "Credit limit", type: "money", required: true },
    { name: "statement_day", label: "Statement day of month", type: "number", min: 1, max: 31, required: true },
    { name: "due_day", label: "Payment due day of month", type: "number", min: 1, max: 31, required: true },
  ], "Add card", (v) => {
    if (!/^\d{4}$/.test(v.last4)) throw new Error("Enter exactly the last 4 digits.");
    return api.addCard({ issuer: v.issuer, last4: v.last4, credit_limit_paise: toPaise(v.limit), statement_day: Number(v.statement_day), due_day: Number(v.due_day) });
  }));

  $("#add-stmt", main)?.addEventListener("click", () => formSheet("Add a card bill", [
    { name: "card_id", label: "Card", type: "select", options: cards.map((c) => [c.id, `${c.issuer} ••${c.last4}`]) },
    { name: "total", label: "Total amount due", type: "money", required: true },
    { name: "min", label: "Minimum due", type: "money", required: true },
    { name: "statement_date", label: "Statement date", type: "date", required: true, value: todayIso() },
    { name: "due_date", label: "Pay by", type: "date", required: true },
  ], "Add card bill", (v) => api.addStatement({ card_id: v.card_id, total_due_paise: toPaise(v.total), min_due_paise: toPaise(v.min), statement_date: v.statement_date, due_date: v.due_date })));
}

// ---------------------------------------------------------------------------
// Goals & investments
// ---------------------------------------------------------------------------
let growTab = "goals";
async function viewGrow(main) {
  setTitle("Goals & investments", "Kids' school, holidays, freedom");
  const [goals, holdings] = await Promise.all([api.goals(), api.holdings()]);
  const kindIcon = { financial_freedom: "🕊️", emergency: "🛟", education: "🎓", holiday: "🏖️", festival: "🪔", purchase: "🛍️", debt_free: "🔓", other: "🎯" };
  const tabs = `<div class="tabs"><button data-t="goals" class="${growTab === "goals" ? "active" : ""}">Goals</button><button data-t="invest" class="${growTab === "invest" ? "active" : ""}">Investments</button></div>`;
  let body;
  if (growTab === "goals") {
    body = `<button class="btn small" id="add-goal">+ New goal</button>
      ${goals.length ? goals.map((g) => {
        const left = Math.max(g.target_paise - g.saved_paise, 0);
        const perMonth = g.target_date ? left / monthsUntil(g.target_date) : 0;
        return `<section class="card stack"><div class="row"><h3>${kindIcon[g.kind] || "🎯"} ${esc(g.name)}</h3>${g.status === "achieved" ? `<span class="chip ok">Reached</span>` : ""}</div>
          <div class="bar"><span style="width:${pct(g.saved_paise, g.target_paise)}%"></span></div>
          <div class="row small"><span><b class="num">${rupees(g.saved_paise)}</b> of ${rupees(g.target_paise)}</span><span class="muted">${g.target_date ? "by " + fmtDate(g.target_date, { month: "short", year: "numeric" }) : ""}</span></div>
          ${left > 0 && g.target_date ? `<div class="small">Save <b>${rupees(perMonth)}</b> a month (${rupees(perMonth * 12 / 365)} a day)</div>` : ""}
          ${g.status !== "achieved" ? `<button class="btn small soft" data-add="${g.id}">+ Add money</button>` : ""}</section>`;
      }).join("") : `<div class="card empty">No goals yet. Add your kids' education, a holiday or an emergency fund.</div>`}`;
  } else {
    const cur = holdings.reduce((s, h) => s + h.current_paise, 0), inv = holdings.reduce((s, h) => s + h.invested_paise, 0);
    const sip = holdings.reduce((s, h) => s + (h.sip_paise || 0), 0);
    const gain = cur - inv;
    body = `<section class="split"><div class="card"><h2>Value today</h2><div class="mid num">${rupees(cur)}</div>
        <div class="tiny ${gain >= 0 ? "pos" : ""}">${gain >= 0 ? "+" : "−"}${rupees(Math.abs(gain))} (${inv ? Math.round((gain / inv) * 1000) / 10 : 0}%)</div></div>
        <div class="card"><h2>SIPs</h2><div class="mid num">${rupees(sip)}</div><div class="tiny muted">per month</div></div></section>
      <button class="btn small" id="add-hold">+ Investment</button>
      <section class="card"><div class="list">${holdings.length ? holdings.map((h) => `<div class="item"><div class="dot">📈</div><div class="grow"><div class="title">${esc(h.name)}</div>
        <div class="meta">${esc(h.asset_class.replace("_", " "))}${h.sip_paise ? ` · SIP ${rupees(h.sip_paise)}` : ""}${h.goal_id ? ` · for ${esc(goals.find((g) => g.id === h.goal_id)?.name || "a goal")}` : ""}</div></div>
        <div style="text-align:right"><div class="amount">${rupees(h.current_paise)}</div><button class="btn small ghost" data-upd="${h.id}">Update</button></div></div>`).join("")
        : `<div class="empty">Add your mutual funds, PPF, FD, gold and more.</div>`}</div></section>
      <p class="tiny muted">Investments not linked to a goal count towards financial freedom. Real estate is not counted.</p>`;
  }
  main.innerHTML = tabs + body;
  main.querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => { growTab = b.dataset.t; render(); }));

  $("#add-goal", main)?.addEventListener("click", () => formSheet("New goal", [
    { name: "kind", label: "Type", type: "select", options: [["education", "Kids' education"], ["holiday", "Holiday"], ["emergency", "Emergency fund"], ["festival", "Festival / wedding"], ["purchase", "Big purchase"], ["debt_free", "Become debt-free"], ["financial_freedom", "Financial freedom"], ["other", "Other"]] },
    { name: "name", label: "Name", required: true, hint: "e.g. Goa trip May 2027, Aarav college 2036" },
    { name: "target", label: "Amount needed", type: "money", required: true },
    { name: "target_date", label: "Needed by", type: "date", required: true },
    { name: "saved", label: "Already saved", type: "money" },
  ], "Add goal", (v) => api.addGoal({ kind: v.kind, name: v.name, target_paise: toPaise(v.target), target_date: v.target_date, saved_paise: toPaise(v.saved || 0) })));

  main.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => formSheet("Add money to goal", [
    { name: "amount", label: "Amount", type: "money", required: true },
  ], "Add", (v) => api.contribute(b.dataset.add, toPaise(v.amount)))));

  $("#add-hold", main)?.addEventListener("click", () => formSheet("Add an investment", [
    { name: "asset_class", label: "Type", type: "select", options: [["equity_mf", "Equity mutual fund"], ["debt_mf", "Debt mutual fund"], ["stock", "Stocks"], ["fd", "Fixed deposit"], ["rd", "Recurring deposit"], ["ppf", "PPF"], ["epf", "EPF"], ["nps", "NPS"], ["gold", "Gold"], ["real_estate", "Real estate"], ["other", "Other"]] },
    { name: "name", label: "Name", required: true },
    { name: "invested", label: "Amount invested", type: "money", required: true },
    { name: "current", label: "Value today", type: "money", required: true },
    { name: "sip", label: "Monthly SIP (if any)", type: "money" },
    { name: "goal_id", label: "For a goal?", type: "select", options: [["", "No, for financial freedom"], ...goals.filter((g) => g.kind !== "financial_freedom").map((g) => [g.id, g.name])] },
  ], "Add investment", (v) => api.addHolding({ asset_class: v.asset_class, name: v.name, invested_paise: toPaise(v.invested), current_paise: toPaise(v.current),
    sip_paise: toPaise(v.sip || 0), goal_id: v.goal_id || null })));

  main.querySelectorAll("[data-upd]").forEach((b) => b.addEventListener("click", () => {
    const h = holdings.find((x) => x.id === b.dataset.upd);
    formSheet(`Update ${h.name}`, [
      { name: "current", label: "Value today", type: "money", value: h.current_paise / 100, required: true },
      { name: "sip", label: "Monthly SIP", type: "money", value: h.sip_paise / 100 },
    ], "Save", (v) => api.updateHolding(h.id, { current_paise: toPaise(v.current), sip_paise: toPaise(v.sip || 0) }));
  }));
}

// ---------------------------------------------------------------------------
// Ask AI
// ---------------------------------------------------------------------------
const chatHistory = [];
async function viewAi(main) {
  setTitle("Ask AI", "Your personal finance assistant");
  const profile = await api.profile();
  if (!profile?.ai_consent) {
    main.innerHTML = `<section class="card stack"><h3>Switch on AI help?</h3>
      <p class="small muted" style="margin:0">The assistant reads your totals (targets, dues, spending by category) to answer questions and find savings.
      It never sees your password or full account numbers. Advice is educational, not licensed investment advice.</p>
      <button class="btn" id="consent">Yes, switch on AI help</button></section>`;
    $("#consent", main).addEventListener("click", async () => { await api.updateProfile({ ai_consent: true }); render(); });
    return;
  }
  main.innerHTML = `
    <section class="card stack"><div class="row"><h3>Find ways to save</h3><button class="btn small" id="savings">Find savings</button></div>
      <p class="small muted" style="margin:0">Checks subscriptions, card interest, late fees and overspending.</p><div id="ins"></div></section>
    <section class="chat" id="chat">${chatHistory.length ? chatHistory.map((m) => `<div class="bubble ${m.role === "user" ? "me" : "ai"}">${esc(m.content)}</div>`).join("") : ""}</section>
    ${chatHistory.length ? "" : `<div class="suggest">${["How much should I earn per day?", "Can I afford a ₹1.2 lakh Goa trip in May?", "Which loan should I prepay first?", "How do I reach freedom sooner?"].map((q) => `<button>${esc(q)}</button>`).join("")}</div>`}
    <form class="chat-input" id="ask"><input name="q" placeholder="Ask about your money…" autocomplete="off" aria-label="Your question"><button class="btn">Ask</button></form>`;
  const chat = $("#chat", main);
  const ask = async (q) => {
    if (!q.trim()) return;
    $(".suggest", main)?.remove();
    chat.insertAdjacentHTML("beforeend", `<div class="bubble me">${esc(q)}</div><div class="bubble ai muted" id="typing">Thinking…</div>`);
    try {
      const answer = await api.ask(q, chatHistory.slice(-8));
      chatHistory.push({ role: "user", content: q }, { role: "assistant", content: answer });
      $("#typing").outerHTML = `<div class="bubble ai">${esc(answer)}</div>`;
    } catch (ex) { $("#typing").outerHTML = `<div class="bubble ai error">${esc(ex.message)}</div>`; }
  };
  main.querySelectorAll(".suggest button").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
  $("#ask", main).addEventListener("submit", (e) => { e.preventDefault(); const q = e.target.q.value; e.target.q.value = ""; ask(q); });
  $("#savings", main).addEventListener("click", async (e) => {
    e.target.disabled = true; $("#ins", main).innerHTML = `<div class="empty">Looking through your spending…</div>`;
    try {
      const list = await api.findSavings();
      $("#ins", main).innerHTML = `<div class="list">${list.length ? list.map((i) => `<div class="item"><div class="dot">${i.severity >= 3 ? "⚠️" : "💡"}</div><div class="grow">
        <div class="title" style="white-space:normal">${esc(i.title)}</div><div class="meta">${esc(i.body)}</div>
        ${i.saving_paise ? `<span class="chip ok">Save ${rupees(i.saving_paise)}/month</span>` : ""}</div></div>`).join("") : `<div class="empty">Nothing to cut right now. Nice work!</div>`}</div>`;
    } catch (ex) { $("#ins", main).innerHTML = `<div class="error">${esc(ex.message)}</div>`; } finally { e.target.disabled = false; }
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
async function viewSettings(main) {
  setTitle("Settings", user.email || "");
  const [profile, hh, events] = await Promise.all([api.profile(), api.household(), api.loginEvents().catch(() => [])]);
  const st = hh.settings || {};
  const evLabel = { login_ok: "Signed in", login_failed: "Wrong password", locked: "Account locked", unlocked: "Unlocked", password_reset: "Password reset",
    password_changed: "Password changed", mfa_enabled: "2FA on", mfa_disabled: "2FA off", new_device: "New device", logout_all: "Signed out everywhere" };
  const device = (ua) => /android/i.test(ua) ? "Android" : /iphone|ipad/i.test(ua) ? "iPhone / iPad" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "Browser";

  main.innerHTML = `
    <section class="card"><h2>Your numbers</h2><form class="form" id="f-set">
      <label class="field">Daily needs per day (groceries, milk, fuel, medicine)<input name="daily" inputmode="decimal" value="${(st.daily_needs_per_day_paise || 0) / 100 || ""}" placeholder="₹ e.g. 550">
        <span class="hint">Leave empty to use your average from the last 3 months of expenses</span></label>
      <div class="split"><label class="field">Safety buffer %<input name="buffer" type="number" min="0" max="50" value="${st.buffer_pct ?? 5}"></label>
        <label class="field">Working days / month<input name="wd" type="number" min="1" max="31" value="${st.working_days_per_month ?? 26}"></label></div>
      <div class="split"><label class="field">Return after inflation %<input name="rr" type="number" step="0.5" min="0" max="15" value="${st.real_return_pct ?? 5}"></label>
        <label class="field">Freedom multiple<input name="swr" type="number" min="15" max="50" value="${st.swr_multiple ?? 25}"><span class="hint">25 = the 4% rule</span></label></div>
      <button class="btn">Save</button></form></section>

    <section class="card"><h2>Profile</h2><form class="form" id="f-prof">
      <label class="field">Name<input name="full_name" value="${esc(profile?.full_name || "")}"></label>
      <label class="check"><input type="checkbox" name="ai" ${profile?.ai_consent ? "checked" : ""}> Allow AI help to read my totals</label>
      <button class="btn ghost">Save profile</button></form></section>

    <section class="card"><h2>Accounts</h2><div class="list">${cache.accounts.map((a) => `<div class="item"><div class="dot">${{ bank: "🏦", cash: "💵", wallet: "👛", credit_card: "💳", loan: "📄", investment: "📈" }[a.kind]}</div>
      <div class="grow"><div class="title">${esc(a.name)}${a.last4 ? ` ••${esc(a.last4)}` : ""}</div><div class="meta">${esc(a.kind.replace("_", " "))}</div></div></div>`).join("")}</div>
      <button class="btn small soft" id="add-acc">+ Account</button></section>

    <section class="card stack"><h2>Security</h2>
      <button class="btn ghost" id="chg">Change password</button>
      <div class="btn-row"><button class="btn ghost" id="out">Sign out</button><button class="btn danger" id="out-all">Sign out on all devices</button></div>
      <h2 style="margin-top:10px">Recent activity</h2><div class="list">${events.length ? events.map((e) => `<div class="item"><div class="grow"><div class="title">${evLabel[e.event] || e.event}</div>
        <div class="meta">${device(e.device || "")} · ${new Date(e.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div></div></div>`).join("") : `<div class="empty">No activity yet.</div>`}</div></section>

    <section class="card"><h2>Plan</h2><div class="row"><div><b>${esc((hh.plan_code || "free").replace(/^./, (c) => c.toUpperCase()))}</b><div class="small muted">${esc(hh.name)}</div></div></div></section>`;

  $("#f-set", main).addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(e.target).entries());
    await api.updateSettings({ ...st, daily_needs_per_day_paise: v.daily ? toPaise(v.daily) : 0, buffer_pct: Number(v.buffer), working_days_per_month: Number(v.wd),
      real_return_pct: Number(v.rr), swr_multiple: Number(v.swr) });
    toast("Saved. Your targets are updated.");
  });
  $("#f-prof", main).addEventListener("submit", async (e) => {
    e.preventDefault();
    await api.updateProfile({ full_name: e.target.full_name.value.trim(), ai_consent: e.target.ai.checked });
    toast("Profile saved");
  });
  $("#add-acc", main).addEventListener("click", () => formSheet("Add an account", [
    { name: "kind", label: "Type", type: "select", options: [["bank", "Bank account"], ["cash", "Cash"], ["wallet", "Wallet (Paytm, PhonePe…)"]] },
    { name: "name", label: "Name", required: true, hint: "e.g. SBI savings" },
    { name: "last4", label: "Last 4 digits (optional)" },
  ], "Add account", async (v) => {
    if (v.last4 && !/^\d{4}$/.test(v.last4)) throw new Error("Enter exactly 4 digits, or leave it empty.");
    await api.addAccount({ kind: v.kind, name: v.name, last4: v.last4 || null }); await refreshCache();
  }));
  $("#chg", main).addEventListener("click", () => {
    sheet("Change password", `<form class="form" id="f-chg"><label class="field">Current password<input name="current" type="password" autocomplete="current-password" required></label>
      ${passwordField("password", "New password")}<label class="field">Confirm new password<input name="confirm" type="password" autocomplete="new-password" required></label>
      <div class="error hidden"></div><button class="btn block">Change password</button></form>`, (root, close) => {
      const form = $("form", root);
      const check = bindPasswordRules(form, () => user.email || "", () => profile?.full_name || "");
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = $(".error", form);
        try {
          if (!check().ok) throw new Error("Please choose a stronger password.");
          if (form.password.value !== form.confirm.value) throw new Error("The two new passwords don't match.");
          await api.verifyPassword(user.email, form.current.value);
          await api.changePassword(form.password.value);
          close(); toast("Password changed");
        } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
      });
    });
  });
  $("#out", main).addEventListener("click", () => api.signOut(false));
  $("#out-all", main).addEventListener("click", () => { if (confirm("Sign out on every phone and computer?")) api.signOut(true); });
}

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
async function onSignedIn(session) {
  user = session?.user ?? null;
  if (!user) { $("#root").innerHTML = ""; return render(); }
  await api.init(user);
  await refreshCache();
  render();
}

async function start() {
  api = await createApi(config);
  api.onAuth(async (event, session) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; user = session?.user ?? null; return renderAuth(); }
    if (event === "SIGNED_OUT") { user = null; cache = { categories: [], accounts: [] }; $("#root").innerHTML = ""; return renderAuth(); }
    if (event === "SIGNED_IN" && (!user || user.id !== session?.user?.id)) await onSignedIn(session);
  });
  const s = await api.session();
  if (s?.user && !user) await onSignedIn(s); else if (!user) renderAuth();
  window.addEventListener("hashchange", render);
  if ("serviceWorker" in navigator && !api.demo) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

start().catch((ex) => { $("#root").innerHTML = `<div class="auth"><div class="card error">Could not start: ${esc(ex.message)}</div></div>`; });

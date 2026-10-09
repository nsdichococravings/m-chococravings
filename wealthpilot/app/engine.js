// The same money maths as migrations/0008_functions.sql, in JavaScript.
// Used by demo mode and by the "what if I earn more?" slider on the Home screen.
// The real app always takes its numbers from the database; this only mirrors it.

export const monthlyFactor = (f) =>
  ({ weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, half_yearly: 1 / 6, yearly: 1 / 12 })[f] ?? 1 / 12;

export function monthsUntil(dateStr, from = new Date()) {
  const d = new Date(dateStr);
  let m = (d.getFullYear() - from.getFullYear()) * 12 + (d.getMonth() - from.getMonth());
  if (d.getDate() < from.getDate()) m -= 1;
  return Math.max(1, m);
}

export function computeTarget({ bills, categories, loans, holdings, goals, settings, dailyHistoryMonthly = 0 }) {
  const bucketOf = (id) => categories.find((c) => c.id === id)?.bucket ?? "fixed";
  const sum = (bucketList) => bills.filter((b) => b.is_active && bucketList.includes(bucketOf(b.category_id)))
    .reduce((s, b) => s + b.amount_paise * monthlyFactor(b.frequency), 0);
  const fixedBills = sum(["fixed", "discretionary", "income", "transfer"]);
  const emi = loans.filter((l) => l.status === "active").reduce((s, l) => s + l.emi_paise, 0);
  const kids = sum(["kids"]);
  const daily = settings.daily_needs_per_day_paise > 0 ? (settings.daily_needs_per_day_paise * 365) / 12 : dailyHistoryMonthly;
  const sinkingBills = sum(["sinking"]);
  const today = new Date();
  const goalNeed = goals.filter((g) => g.status === "active" && g.kind !== "financial_freedom" && g.target_date && new Date(g.target_date) > today)
    .reduce((s, g) => s + Math.max(g.target_paise - g.saved_paise, 0) / monthsUntil(g.target_date, today), 0);
  const invest = sum(["invest"]) + holdings.reduce((s, h) => s + (h.sip_paise || 0), 0);
  const buffer = settings.buffer_pct ?? 5;
  const wd = settings.working_days_per_month ?? 26;
  const subtotal = fixedBills + emi + kids + daily + sinkingBills + goalNeed + invest;
  const monthly = subtotal * (1 + buffer / 100);
  const dailyTarget = Math.ceil((monthly * 12) / 365);
  return {
    breakdown_paise: {
      fixed: Math.round(fixedBills + emi), emi: Math.round(emi), kids: Math.round(kids), daily: Math.round(daily),
      sinking: Math.round(sinkingBills + goalNeed), invest: Math.round(invest),
    },
    living_paise: Math.round(fixedBills + daily + sinkingBills),
    invest_paise: Math.round(invest),
    buffer_pct: buffer,
    monthly_paise: Math.round(monthly),
    daily_paise: dailyTarget,
    weekly_paise: dailyTarget * 7,
    working_day_paise: Math.ceil(monthly / wd),
  };
}

export function yearsToFreedom(fi, corpus, investYearly, r) {
  if (fi <= 0) return null;
  if (corpus >= fi) return 0;
  if (r > 0 && corpus + investYearly / r > 0) return Math.log((fi + investYearly / r) / (corpus + investYearly / r)) / Math.log(1 + r);
  if (investYearly > 0) return (fi - corpus) / investYearly;
  return null;
}

export function computeFreedom({ target, holdings, goals, settings }) {
  const r = (settings.real_return_pct ?? 5) / 100;
  const mult = settings.swr_multiple ?? 25;
  const fi = target.living_paise * 12 * mult;
  const forFreedom = holdings.filter((h) => h.asset_class !== "real_estate" &&
    (!h.goal_id || goals.find((g) => g.id === h.goal_id)?.kind === "financial_freedom"));
  const corpus = forFreedom.reduce((s, h) => s + h.current_paise, 0);
  const c = forFreedom.reduce((s, h) => s + (h.sip_paise || 0), 0) * 12;
  const yrs = yearsToFreedom(fi, corpus, c, r);
  return {
    fi_number_paise: Math.round(fi),
    corpus_paise: corpus,
    pct: fi > 0 ? Math.round(Math.min(corpus / fi, 1) * 1000) / 10 : 0,
    years: yrs == null ? null : Math.round(yrs * 10) / 10,
    freedom_date: yrs == null ? null : addDays(new Date(), Math.round(yrs * 365.25)).toISOString().slice(0, 10),
    freedom_invest_monthly_paise: Math.round(c / 12),
    real_return_pct: r * 100,
    swr_multiple: mult,
  };
}

// "What if I earn ₹X more per day and invest it?"
export function whatIf(freedom, extraPerDayPaise) {
  const r = freedom.real_return_pct / 100;
  const c = (freedom.freedom_invest_monthly_paise * 12) + extraPerDayPaise * 365;
  const yrs = yearsToFreedom(freedom.fi_number_paise, freedom.corpus_paise, c, r);
  return yrs == null ? null : { years: Math.round(yrs * 10) / 10, date: addDays(new Date(), Math.round(yrs * 365.25)) };
}

export function nextDayOfMonth(day, from) {
  const f = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const clamp = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  const d0 = clamp(f.getFullYear(), f.getMonth());
  return d0 >= f ? d0 : clamp(f.getFullYear(), f.getMonth() + 1);
}

export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function nextDue(dateStr, frequency) {
  const d = new Date(dateStr);
  if (frequency === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + (({ monthly: 1, quarterly: 3, half_yearly: 6 })[frequency] ?? 12));
  return d;
}

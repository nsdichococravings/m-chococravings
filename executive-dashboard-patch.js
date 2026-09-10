/**
 * executive-dashboard-patch.js — ChocoCravings On Store
 * Feature: Executive Dashboard for Super Admin — aggregates revenue,
 * profit, cash position, and growth across ALL channels (walk-in/table
 * orders, custom cake bookings, stall events) into one high-level view.
 *
 * Built in 5 sections, added incrementally:
 *   1. Hero KPIs           <- this file, section 1
 *   2. Revenue & Profitability
 *   3. Customer & Bookings
 *   4. Operational Alerts
 *   5. Growth Trend
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="executive-dashboard-patch.js"></script>
 *
 * Requires: `db`, `showStoreToast()` — already global.
 * Access: Super Admin only — checked the same way as Sales Reports
 * (isAdmin confirmed first, then customers.is_super_user).
 */

var _edSuperUser = false;
var _edPeriod = 'today'; // 'today' | 'week' | 'month'

document.addEventListener('DOMContentLoaded', function () {
  buildExecutiveDashboardUI();
  waitForSuperAdminThenInjectDashboard();
});

function waitForSuperAdminThenInjectDashboard() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      checkSuperUserForDashboard().then(function (allowed) {
        _edSuperUser = allowed;
        if (allowed) injectDashboardMenuEntry();
      });
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

async function checkSuperUserForDashboard() {
  try {
    var s = await db.auth.getSession();
    var user = s.data && s.data.session ? s.data.session.user : null;
    if (!user) return false;
    var res = await db.from('customers').select('is_super_user').eq('email', user.email).single();
    return !!(res.data && res.data.is_super_user);
  } catch (e) {
    return false;
  }
}

function injectDashboardMenuEntry() {
  if (document.getElementById('ed-menu-entry')) return;
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.id = 'ed-menu-entry';
  entry.onclick = function () { openExecutiveDashboard(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(245,196,48,0.15);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📊</div>'
    + '<div><div style="font-size:13px;font-weight:600;color:#1a0820">Executive Dashboard</div>'
    + '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Full business overview — Super Admin</div></div>';

  // Insert near the top, right after the first item, so it's prominent.
  fabMenu.insertBefore(entry, fabMenu.children[1] || null);
}

// ══════════════════════════════════════════════════════════════
// Shell
// ══════════════════════════════════════════════════════════════
function buildExecutiveDashboardUI() {
  var page = document.createElement('div');
  page.id = 'ed-page';
  page.style.cssText = 'display:none;position:fixed;inset:0;background:#0e0716;z-index:5200;'
    + 'overflow-y:auto;font-family:\'DM Sans\',sans-serif';
  page.innerHTML =
      '<div style="position:sticky;top:0;z-index:10;background:#0e0716;border-bottom:1px solid rgba(255,255,255,.08);'
    + 'padding:16px 20px;display:flex;align-items:center;justify-content:space-between">'
    +   '<div style="display:flex;align-items:center;gap:12px">'
    +     '<div onclick="closeExecutiveDashboard()" style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.06);'
    +       'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font-size:16px">←</div>'
    +     '<div>'
    +       '<div style="font-size:9px;letter-spacing:3px;color:#c084fc;font-weight:700">CHOCOCRAVINGS</div>'
    +       '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#fff">Executive Dashboard</div>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '<div style="padding:16px 20px 0;display:flex;gap:8px" id="ed-period-tabs">'
    +   edPeriodTab('today', 'Today')
    +   edPeriodTab('week', 'This Week')
    +   edPeriodTab('month', 'This Month')
    + '</div>'
    + '<div id="ed-content" style="padding:20px;max-width:1100px;margin:0 auto"></div>';
  document.body.appendChild(page);
}

function edPeriodTab(key, label) {
  return '<div id="ed-tab-' + key + '" onclick="edSetPeriod(\'' + key + '\')" style="padding:9px 18px;'
    + 'border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;'
    + (key === _edPeriod ? 'background:#6e0977;color:#fff' : 'background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)')
    + '">' + label + '</div>';
}

function openExecutiveDashboard() {
  document.getElementById('ed-page').style.display = 'block';
  loadDashboard();
}
function closeExecutiveDashboard() {
  document.getElementById('ed-page').style.display = 'none';
}

function edSetPeriod(period) {
  _edPeriod = period;
  ['today', 'week', 'month'].forEach(function (k) {
    var el = document.getElementById('ed-tab-' + k);
    if (!el) return;
    el.style.background = k === period ? '#6e0977' : 'rgba(255,255,255,.05)';
    el.style.color = k === period ? '#fff' : 'rgba(255,255,255,.5)';
  });
  loadDashboard();
}

function edGetPeriodRange(period) {
  var now = new Date();
  var start;
  if (period === 'today') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    start = new Date(now.getTime() - 7 * 86400000);
  } else {
    start = new Date(now.getTime() - 30 * 86400000);
  }
  var days = Math.max(1, Math.round((now - start) / 86400000));
  var prevStart = new Date(start.getTime() - days * 86400000);
  return { start: start, end: now, prevStart: prevStart, prevEnd: start };
}

// ══════════════════════════════════════════════════════════════
// SECTION 1 — Hero KPIs
// ══════════════════════════════════════════════════════════════
async function loadDashboard() {
  var content = document.getElementById('ed-content');
  content.innerHTML = '<div style="text-align:center;padding:60px;color:rgba(255,255,255,.4);font-size:13px">Loading…</div>';

  var range = edGetPeriodRange(_edPeriod);

  // Combined revenue across every sales channel — store_orders covers
  // BOTH walk-in and table orders already (table_code is just a column
  // on the same table), plus custom_bookings (cake/party orders) and
  // stall_orders (pop-up event sales) as separate channels entirely.
  var storeRes = await db.from('store_orders').select('total, created_at')
    .gte('created_at', range.start.toISOString())
    .not('status', 'eq', 'cancelled');
  var storePrevRes = await db.from('store_orders').select('total')
    .gte('created_at', range.prevStart.toISOString())
    .lt('created_at', range.prevEnd.toISOString())
    .not('status', 'eq', 'cancelled');

  var bookingsRes = await db.from('custom_bookings').select('total_amount, booking_date')
    .gte('booking_date', range.start.toISOString().slice(0, 10))
    .lte('booking_date', range.end.toISOString().slice(0, 10))
    .not('status', 'eq', 'cancelled');

  var stallRes = await db.from('stall_orders').select('total, created_at')
    .gte('created_at', range.start.toISOString())
    .not('status', 'eq', 'cancelled')
    .then(function (r) { return r; }).catch(function () { return { data: [] }; }); // table may not exist for every deployment

  var expensesRes = await db.from('daily_expenses').select('amount')
    .gte('expense_date', range.start.toISOString().slice(0, 10))
    .lte('expense_date', range.end.toISOString().slice(0, 10))
    .then(function (r) { return r; }).catch(function () { return { data: [] }; });

  var cashRes = await db.from('cash_counter_entries').select('amount')
    .then(function (r) { return r; }).catch(function () { return { data: [] }; });

  var storeOrders = storeRes.data || [];
  var storePrevOrders = storePrevRes.data || [];
  var bookings = bookingsRes.data || [];
  var stallOrders = (stallRes && stallRes.data) || [];
  var expenses = (expensesRes && expensesRes.data) || [];
  var cashEntries = (cashRes && cashRes.data) || [];

  var storeRevenue = storeOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var bookingRevenue = bookings.reduce(function (s, b) { return s + (b.total_amount || 0); }, 0);
  var stallRevenue = stallOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var totalRevenue = storeRevenue + bookingRevenue + stallRevenue;

  var totalOrders = storeOrders.length + bookings.length + stallOrders.length;

  var expensesTotal = expenses.reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  var netProfit = totalRevenue - expensesTotal;

  var prevRevenue = storePrevOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var revenueChange = prevRevenue > 0 ? ((storeRevenue - prevRevenue) / prevRevenue) * 100 : null;

  var cashBalance = cashEntries.reduce(function (s, e) { return s + (e.amount || 0); }, 0);

  renderHeroKpis(content, {
    totalRevenue: totalRevenue, totalOrders: totalOrders, netProfit: netProfit,
    revenueChange: revenueChange, cashBalance: cashBalance,
    storeRevenue: storeRevenue, bookingRevenue: bookingRevenue, stallRevenue: stallRevenue
  });
}

function renderHeroKpis(content, d) {
  var changeHtml = d.revenueChange === null
    ? '<span style="color:rgba(255,255,255,.3)">No prior data</span>'
    : (d.revenueChange >= 0
        ? '<span style="color:#4ade80">▲ ' + d.revenueChange.toFixed(1) + '% vs previous period</span>'
        : '<span style="color:#f87171">▼ ' + Math.abs(d.revenueChange).toFixed(1) + '% vs previous period</span>');

  content.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:20px">'
    + edHeroCard('💰 TOTAL REVENUE', '₹' + d.totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 }), changeHtml, '#f5c430')
    + edHeroCard('🧾 TOTAL ORDERS', d.totalOrders.toLocaleString('en-IN'), 'Across all channels', '#c084fc')
    + edHeroCard('📈 NET PROFIT', '₹' + d.netProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 }),
        d.netProfit >= 0 ? '<span style="color:#4ade80">Profitable</span>' : '<span style="color:#f87171">Loss this period</span>', d.netProfit >= 0 ? '#4ade80' : '#f87171')
    + edHeroCard('💵 CASH ON HAND', '₹' + d.cashBalance.toLocaleString('en-IN', { maximumFractionDigits: 0 }), 'Live Cash Counter balance', '#b87410')
    + '</div>'

    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px;margin-bottom:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">REVENUE BY CHANNEL</div>'
    + edChannelRow('🏪 Store Orders (Walk-in + Tables)', d.storeRevenue, d.totalRevenue, '#6e0977')
    + edChannelRow('🎂 Custom Bookings (Cakes/Parties)', d.bookingRevenue, d.totalRevenue, '#d6336c')
    + edChannelRow('🎪 Stall Events', d.stallRevenue, d.totalRevenue, '#15803d')
    + '</div>'

    + '<div style="text-align:center;padding:16px;color:rgba(255,255,255,.3);font-size:11px;font-family:Fraunces,Georgia,serif">'
    + '📊 Revenue & Profitability, Customer Insights, Operational Alerts, and Growth Trend sections coming next</div>';
}

function edHeroCard(label, value, sub, accentColor) {
  return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:18px">'
    + '<div style="font-size:10px;letter-spacing:1.5px;color:rgba(255,255,255,.4);font-weight:700">' + label + '</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:900;color:' + accentColor + ';margin:8px 0 4px">' + value + '</div>'
    + '<div style="font-size:11px;font-weight:600">' + sub + '</div></div>';
}

function edChannelRow(label, amt, total, color) {
  var pct = total > 0 ? Math.round((amt / total) * 100) : 0;
  return '<div style="margin-bottom:12px">'
    + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">'
    + '<span style="color:rgba(255,255,255,.7)">' + label + '</span>'
    + '<span style="font-weight:700;color:#fff">₹' + amt.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' (' + pct + '%)</span></div>'
    + '<div style="height:8px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:' + color + '"></div></div></div>';
}

// ══════════════════════════════════════════════════════════════
// All-Time Sales, Growth Roadmap, Expense Breakdown, Smart Insights
// ══════════════════════════════════════════════════════════════
var _edExpensePeriod = 'daily'; // 'daily' | 'weekly' | 'monthly'

// Called after the existing hero KPIs render — appends the additional
// sections below them in the same scroll, rather than replacing anything.
var _origRenderHeroKpis = renderHeroKpis;
renderHeroKpis = function (content, d) {
  _origRenderHeroKpis(content, d);
  loadAllTimeAndRoadmap();
  loadExpenseBreakdown();
};

// ── All-Time Sales + Growth Roadmap ──
async function loadAllTimeAndRoadmap() {
  var storeRes = await db.from('store_orders').select('total, created_at').not('status', 'eq', 'cancelled').order('created_at', { ascending: true });
  var bookingsRes = await db.from('custom_bookings').select('total_amount').not('status', 'eq', 'cancelled');
  var stallRes = await db.from('stall_orders').select('total').not('status', 'eq', 'cancelled')
    .then(function (r) { return r; }).catch(function () { return { data: [] }; });

  var storeOrders = storeRes.data || [];
  var bookings = bookingsRes.data || [];
  var stallOrders = (stallRes && stallRes.data) || [];

  var allTimeRevenue = storeOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0)
    + bookings.reduce(function (s, b) { return s + (b.total_amount || 0); }, 0)
    + stallOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);

  var launchDate = storeOrders.length ? new Date(storeOrders[0].created_at) : new Date();
  var daysSinceLaunch = Math.max(1, Math.round((new Date() - launchDate) / 86400000));
  var monthsSinceLaunch = Math.max(1, daysSinceLaunch / 30);

  // Growth rate: compare the last 30 days to the 30 days before that.
  // With limited history this is a rough signal, not a precise model —
  // the roadmap below is clearly labeled as a trend-based estimate.
  var now = new Date();
  var last30Start = new Date(now.getTime() - 30 * 86400000);
  var prev30Start = new Date(now.getTime() - 60 * 86400000);

  var last30Revenue = storeOrders.filter(function (o) { return new Date(o.created_at) >= last30Start; })
    .reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var prev30Revenue = storeOrders.filter(function (o) { return new Date(o.created_at) >= prev30Start && new Date(o.created_at) < last30Start; })
    .reduce(function (s, o) { return s + (o.total || 0); }, 0);

  var monthlyGrowthRate = prev30Revenue > 0 ? (last30Revenue - prev30Revenue) / prev30Revenue : 0.05; // default 5%/mo assumption if no prior data
  monthlyGrowthRate = Math.max(-0.3, Math.min(0.5, monthlyGrowthRate)); // clamp to a sane range so one wild month doesn't produce an absurd projection

  var currentMonthlyRevenue = allTimeRevenue / monthsSinceLaunch;

  function projectYear(years) {
    var months = years * 12;
    var total = 0;
    var monthly = currentMonthlyRevenue;
    for (var i = 0; i < months; i++) {
      monthly = monthly * (1 + monthlyGrowthRate / 12);
      total += monthly;
    }
    return total;
  }

  renderAllTimeAndRoadmap({
    allTimeRevenue: allTimeRevenue, launchDate: launchDate, daysSinceLaunch: daysSinceLaunch,
    monthlyGrowthRate: monthlyGrowthRate,
    year1: projectYear(1), year2: projectYear(2), year3: projectYear(3),
    hasEnoughData: storeOrders.length >= 20 && daysSinceLaunch >= 14
  });
}

function renderAllTimeAndRoadmap(d) {
  var content = document.getElementById('ed-content');
  var existing = document.getElementById('ed-alltime-section');
  if (existing) existing.remove();

  var section = document.createElement('div');
  section.id = 'ed-alltime-section';

  var growthLabel = d.monthlyGrowthRate >= 0
    ? '<span style="color:#4ade80">+' + (d.monthlyGrowthRate * 100).toFixed(1) + '%/month trend</span>'
    : '<span style="color:#f87171">' + (d.monthlyGrowthRate * 100).toFixed(1) + '%/month trend</span>';

  section.innerHTML =
      '<div style="background:linear-gradient(135deg,rgba(245,196,48,0.12),rgba(245,196,48,0.02));'
    + 'border:1.5px solid rgba(245,196,48,0.3);border-radius:18px;padding:20px;text-align:center;margin-bottom:20px">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#f5c430">TOTAL SALES SINCE LAUNCH</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:32px;font-weight:900;color:#f5c430;margin:6px 0 4px">₹' + d.allTimeRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + '</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.4)">Since ' + d.launchDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ' · ' + d.daysSinceLaunch + ' days</div>'
    + '</div>'

    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px;margin-bottom:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:4px">🗺️ GROWTH ROADMAP — 1 TO 3 YEARS</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:14px">Projected using your recent ' + growthLabel + '. This is a trend-based estimate, not a guarantee — accuracy improves as more history builds up.</div>'
    + (!d.hasEnoughData
        ? '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:12px;padding:12px;'
          + 'font-size:11px;color:#fbbf24;margin-bottom:14px">⚠️ Limited history so far — treat this projection as a rough directional guide until you have a few months of consistent data.</div>'
        : '')
    + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">'
    + edRoadmapCard('YEAR 1', d.year1)
    + edRoadmapCard('YEAR 2', d.year2)
    + edRoadmapCard('YEAR 3', d.year3)
    + '</div></div>';

  content.appendChild(section);
}

function edRoadmapCard(label, value) {
  return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;text-align:center">'
    + '<div style="font-size:9px;font-weight:700;letter-spacing:1px;color:rgba(255,255,255,.4)">' + label + '</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:17px;font-weight:900;color:#c084fc;margin-top:4px">₹' + value.toLocaleString('en-IN', { maximumFractionDigits: 0 }) + '</div></div>';
}

// ── Expense Breakdown (Daily/Weekly/Monthly) + Smart Cost Insights ──
async function loadExpenseBreakdown() {
  var content = document.getElementById('ed-content');
  var existing = document.getElementById('ed-expense-section');
  if (existing) existing.remove();

  var section = document.createElement('div');
  section.id = 'ed-expense-section';
  section.innerHTML =
      '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px;margin-bottom:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">EXPENSE BREAKDOWN</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:16px" id="ed-exp-tabs">'
    + edExpenseTab('daily', 'Daily') + edExpenseTab('weekly', 'Weekly') + edExpenseTab('monthly', 'Monthly')
    + '</div>'
    + '<div id="ed-exp-body"><div style="text-align:center;padding:20px;color:rgba(255,255,255,.4);font-size:12px">Loading…</div></div>'
    + '</div>'
    + '<div id="ed-insights-section"></div>';

  content.appendChild(section);
  await renderExpenseBreakdown();
}

function edExpenseTab(key, label) {
  var on = key === _edExpensePeriod;
  return '<div id="ed-exp-tab-' + key + '" onclick="edSetExpensePeriod(\'' + key + '\')" style="padding:8px 16px;border-radius:20px;'
    + 'font-size:11px;font-weight:700;cursor:pointer;'
    + (on ? 'background:#6e0977;color:#fff' : 'background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)')
    + '">' + label + '</div>';
}

function edSetExpensePeriod(period) {
  _edExpensePeriod = period;
  ['daily', 'weekly', 'monthly'].forEach(function (k) {
    var el = document.getElementById('ed-exp-tab-' + k);
    if (!el) return;
    el.style.background = k === period ? '#6e0977' : 'rgba(255,255,255,.05)';
    el.style.color = k === period ? '#fff' : 'rgba(255,255,255,.5)';
  });
  renderExpenseBreakdown();
}

function edExpenseRangeFor(period) {
  var now = new Date();
  var start;
  if (period === 'daily') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'weekly') start = new Date(now.getTime() - 7 * 86400000);
  else start = new Date(now.getTime() - 30 * 86400000);
  var prevStart = new Date(start.getTime() - (now - start));
  return { start: start, end: now, prevStart: prevStart, prevEnd: start };
}

async function renderExpenseBreakdown() {
  var range = edExpenseRangeFor(_edExpensePeriod);
  var startStr = range.start.toISOString().slice(0, 10);
  var endStr = range.end.toISOString().slice(0, 10);
  var prevStartStr = range.prevStart.toISOString().slice(0, 10);
  var prevEndStr = range.prevEnd.toISOString().slice(0, 10);

  var curRes = await db.from('daily_expenses').select('category, amount').gte('expense_date', startStr).lte('expense_date', endStr);
  var prevRes = await db.from('daily_expenses').select('category, amount').gte('expense_date', prevStartStr).lt('expense_date', prevEndStr);

  var current = curRes.data || [];
  var previous = prevRes.data || [];

  var byCategory = {};
  current.forEach(function (e) {
    if (!byCategory[e.category]) byCategory[e.category] = { total: 0, count: 0 };
    byCategory[e.category].total += e.amount || 0;
    byCategory[e.category].count += 1;
  });

  var prevByCategory = {};
  previous.forEach(function (e) {
    prevByCategory[e.category] = (prevByCategory[e.category] || 0) + (e.amount || 0);
  });

  var totalExpenses = current.reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  var categories = Object.keys(byCategory).sort(function (a, b) { return byCategory[b].total - byCategory[a].total; });

  var body = document.getElementById('ed-exp-body');
  if (!categories.length) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:rgba(255,255,255,.4);font-size:12px">No expenses logged in this period.</div>';
  } else {
    body.innerHTML = '<div style="text-align:center;margin-bottom:14px">'
      + '<span style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#dc2626">₹' + totalExpenses.toFixed(0) + '</span>'
      + '<span style="font-size:11px;color:rgba(255,255,255,.4);margin-left:6px">total this ' + _edExpensePeriod.replace('ly', '') + '</span></div>'
      + categories.map(function (cat) {
          var pct = totalExpenses > 0 ? Math.round((byCategory[cat].total / totalExpenses) * 100) : 0;
          return '<div style="margin-bottom:10px">'
            + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">'
            + '<span style="color:rgba(255,255,255,.7)">' + cat + '</span>'
            + '<span style="font-weight:700;color:#fff">₹' + byCategory[cat].total.toFixed(0) + ' (' + pct + '%)</span></div>'
            + '<div style="height:7px;border-radius:4px;background:rgba(255,255,255,.06);overflow:hidden">'
            + '<div style="height:100%;width:' + pct + '%;background:#dc2626"></div></div></div>';
        }).join('');
  }

  renderSmartInsights(byCategory, prevByCategory, totalExpenses);
}

// ── Smart Cost-Reduction Insights (rule-based, no external AI call) ──
function renderSmartInsights(byCategory, prevByCategory, totalExpenses) {
  var insightsSection = document.getElementById('ed-insights-section');
  var insights = [];

  Object.keys(byCategory).forEach(function (cat) {
    var current = byCategory[cat].total;
    var prev = prevByCategory[cat] || 0;
    var count = byCategory[cat].count;

    // Rule 1: notable increase vs previous comparable period
    if (prev > 0) {
      var changePct = ((current - prev) / prev) * 100;
      if (changePct >= 15) {
        insights.push({
          icon: '⚠️', color: '#fbbf24',
          text: cat + ' costs are up ' + changePct.toFixed(0) + '% vs the previous period. Worth checking if supplier prices changed, or comparing quotes from another supplier.'
        });
      }
    }

    // Rule 2: frequent small purchases — bulk buying opportunity
    var avgPerPurchase = current / count;
    if (count >= 4 && avgPerPurchase < 200) {
      insights.push({
        icon: '🔄', color: '#60a5fa',
        text: 'You bought ' + cat + ' ' + count + ' separate times this period (avg ₹' + avgPerPurchase.toFixed(0) + ' each). Buying in bulk less often could reduce per-unit cost and save trips.'
      });
    }
  });

  // Rule 3: single biggest category — always worth calling out
  var categories = Object.keys(byCategory);
  if (categories.length) {
    var biggest = categories.reduce(function (a, b) { return byCategory[a].total > byCategory[b].total ? a : b; });
    var biggestPct = totalExpenses > 0 ? Math.round((byCategory[biggest].total / totalExpenses) * 100) : 0;
    if (biggestPct >= 30) {
      insights.push({
        icon: '💡', color: '#c084fc',
        text: biggest + ' alone makes up ' + biggestPct + '% of your total expenses this period. Even a small negotiated discount here has outsized impact on overall costs.'
      });
    }
  }

  if (!insights.length) {
    insightsSection.innerHTML = '';
    return;
  }

  insightsSection.innerHTML =
      '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px;margin-bottom:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:4px">🤖 SMART COST INSIGHTS</div>'
    + '<div style="font-size:11px;color:rgba(255,255,255,.35);margin-bottom:14px">Rule-based analysis of your expense patterns — not a live AI call, just pattern detection on your actual data.</div>'
    + insights.map(function (i) {
        return '<div style="display:flex;gap:10px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.06)">'
          + '<span style="font-size:16px;flex-shrink:0">' + i.icon + '</span>'
          + '<span style="font-size:12px;color:rgba(255,255,255,.75);line-height:1.5">' + i.text + '</span></div>';
      }).join('')
    + '</div>';
}

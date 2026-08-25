/**
 * sales-reports-patch.js — ChocoCravings On Store
 * Feature: Sales Reports — a dedicated full-screen dashboard, separate
 * from Day Close. Five period tabs (Daily/Weekly/Monthly/Quarterly/
 * Yearly) plus a Custom date range, each showing a revenue trend chart,
 * top-selling items, payment method breakdown, Peak Hours, Best Days of
 * Week, and Total Expenses/Net Profit — with % change vs the previous
 * period. Downloadable as a styled PDF snapshot.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="sales-reports-patch.js"></script>
 *
 * Requires: `db`, `showStoreToast()` — already global. Also uses
 * `getExpensesTotal()` from daily-expenses-patch.js if loaded (falls
 * back to 0 gracefully if not). Loads Chart.js, html2canvas, and jsPDF
 * dynamically from CDN on first use.
 *
 * Access: this whole feature is only ever opened via openReports(),
 * which reports-hub-patch.js only calls for confirmed Super User
 * accounts — this file itself doesn't need its own gating.
 *
 * NOTE on periods: Weekly/Monthly/Quarterly/Yearly use ROLLING windows
 * (last 7/30/90/365 days) rather than exact calendar boundaries. Only
 * "Daily" is a true calendar day.
 */

var REPORT_PERIODS = {
  daily:     { label: 'Daily',     days: 1,   bucket: 'hour'  },
  weekly:    { label: 'Weekly',    days: 7,   bucket: 'day'   },
  monthly:   { label: 'Monthly',   days: 30,  bucket: 'day'   },
  quarterly: { label: 'Quarterly', days: 90,  bucket: 'week'  },
  yearly:    { label: 'Yearly',    days: 365, bucket: 'month' }
};
var _srPeriod = 'daily';
var _srCharts = {};
var _srCurrentLabel = 'Daily';

document.addEventListener('DOMContentLoaded', function () {
  buildReportsUI();
});

function loadScriptOnce(src) {
  return new Promise(function (resolve, reject) {
    var existing = document.querySelector('script[src="' + src + '"]');
    if (existing) { existing.dataset.loaded === 'true' ? resolve() : existing.addEventListener('load', resolve); return; }
    var s = document.createElement('script');
    s.src = src;
    s.onload = function () { s.dataset.loaded = 'true'; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function ensureReportLibs() {
  if (typeof Chart === 'undefined') await loadScriptOnce('https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js');
  if (typeof html2canvas === 'undefined') await loadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
  if (typeof window.jspdf === 'undefined') await loadScriptOnce('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js');
}

function buildReportsUI() {
  var page = document.createElement('div');
  page.id = 'sr-page';
  page.style.cssText = 'display:none;position:fixed;inset:0;background:#0e0716;z-index:5000;'
    + 'overflow-y:auto;font-family:\'DM Sans\',sans-serif';
  page.innerHTML =
      '<div style="position:sticky;top:0;z-index:10;background:#0e0716;border-bottom:1px solid rgba(255,255,255,.08);'
    + 'padding:16px 20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">'
    +   '<div style="display:flex;align-items:center;gap:12px">'
    +     '<div onclick="closeReports()" style="width:38px;height:38px;border-radius:50%;background:rgba(255,255,255,.06);'
    +       'display:flex;align-items:center;justify-content:center;cursor:pointer;color:#fff;font-size:16px">←</div>'
    +     '<div>'
    +       '<div style="font-size:9px;letter-spacing:3px;color:#c084fc;font-weight:700">CHOCOCRAVINGS</div>'
    +       '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#fff">Sales Reports</div>'
    +     '</div>'
    +   '</div>'
    +   '<button onclick="downloadReportPdf()" style="padding:11px 20px;border-radius:12px;'
    +     'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:12px;font-weight:700;'
    +     'border:none;cursor:pointer;display:flex;align-items:center;gap:6px">📥 Download PDF</button>'
    + '</div>'
    + '<div style="padding:16px 20px 0;display:flex;gap:8px;flex-wrap:wrap" id="sr-tabs"></div>'
    + '<div id="sr-custom-range" style="display:none;padding:14px 20px 0;align-items:center;'
    +   'gap:10px;flex-wrap:wrap">'
    +   '<input type="date" id="sr-custom-start" style="padding:9px 12px;border-radius:10px;'
    +     'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#fff;font-family:inherit;font-size:12px">'
    +   '<span style="color:rgba(255,255,255,.4);font-size:12px">to</span>'
    +   '<input type="date" id="sr-custom-end" style="padding:9px 12px;border-radius:10px;'
    +     'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.05);color:#fff;font-family:inherit;font-size:12px">'
    +   '<button onclick="srApplyCustomRange()" style="padding:9px 18px;border-radius:10px;'
    +     'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:12px;font-weight:700;'
    +     'border:none;cursor:pointer">Apply</button>'
    + '</div>'
    + '<div id="sr-report-content" style="padding:20px;max-width:1100px;margin:0 auto"></div>';
  document.body.appendChild(page);

  var tabsEl = document.getElementById('sr-tabs');
  Object.keys(REPORT_PERIODS).forEach(function (key) {
    var t = document.createElement('div');
    t.id = 'sr-tab-' + key;
    t.onclick = function () { srSetPeriod(key); };
    t.style.cssText = 'padding:9px 18px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;'
      + (key === _srPeriod ? 'background:#6e0977;color:#fff' : 'background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)');
    t.textContent = REPORT_PERIODS[key].label;
    tabsEl.appendChild(t);
  });
  var customTab = document.createElement('div');
  customTab.id = 'sr-tab-custom';
  customTab.onclick = function () { srSetPeriod('custom'); };
  customTab.style.cssText = 'padding:9px 18px;border-radius:20px;font-size:12px;font-weight:700;cursor:pointer;'
    + 'background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.08)';
  customTab.textContent = '📅 Custom';
  tabsEl.appendChild(customTab);

  var today = new Date().toISOString().slice(0, 10);
  document.getElementById('sr-custom-end').value = today;
  document.getElementById('sr-custom-start').value = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
}

function openReports() {
  document.getElementById('sr-page').style.display = 'block';
  loadReport(_srPeriod);
}
function closeReports() {
  document.getElementById('sr-page').style.display = 'none';
  if (typeof openReportsHub === 'function') openReportsHub();
}

function srSetPeriod(key) {
  _srPeriod = key;
  var allKeys = Object.keys(REPORT_PERIODS).concat(['custom']);
  allKeys.forEach(function (k) {
    var t = document.getElementById('sr-tab-' + k);
    if (!t) return;
    t.style.background = k === key ? '#6e0977' : 'rgba(255,255,255,.05)';
    t.style.color = k === key ? '#fff' : 'rgba(255,255,255,.5)';
  });

  var rangeBar = document.getElementById('sr-custom-range');
  if (key === 'custom') {
    rangeBar.style.display = 'flex';
    srApplyCustomRange();
  } else {
    rangeBar.style.display = 'none';
    loadReport(key);
  }
}

function srApplyCustomRange() {
  var startStr = document.getElementById('sr-custom-start').value;
  var endStr = document.getElementById('sr-custom-end').value;
  if (!startStr || !endStr) { showStoreToast('Pick both a start and end date'); return; }

  var start = new Date(startStr + 'T00:00:00.000Z');
  var end = new Date(endStr + 'T23:59:59.999Z');
  if (start > end) { showStoreToast('Start date must be before end date'); return; }

  loadCustomReport(start, end);
}

async function loadReport(periodKey) {
  var content = document.getElementById('sr-report-content');
  content.innerHTML = '<div style="text-align:center;padding:60px;color:rgba(255,255,255,.4);font-size:13px">Loading report…</div>';

  await ensureReportLibs();

  var period = REPORT_PERIODS[periodKey];
  var now = new Date();
  var rangeStart = new Date(now.getTime() - period.days * 24 * 60 * 60 * 1000);
  var prevStart = new Date(rangeStart.getTime() - period.days * 24 * 60 * 60 * 1000);

  var curRes = await db.from('store_orders')
    .select('total, created_at, payment_method, payment_status, items')
    .gte('created_at', rangeStart.toISOString())
    .not('status', 'eq', 'cancelled');
  var prevRes = await db.from('store_orders')
    .select('total')
    .gte('created_at', prevStart.toISOString())
    .lt('created_at', rangeStart.toISOString())
    .not('status', 'eq', 'cancelled');

  var current = curRes.data || [];
  var previous = prevRes.data || [];

  _srCurrentLabel = period.label;
  var expensesTotal = typeof getExpensesTotal === 'function'
    ? await getExpensesTotal(rangeStart.toISOString().slice(0, 10), now.toISOString().slice(0, 10))
    : 0;
  renderReport(period, periodKey, current, previous, expensesTotal);
}

async function loadCustomReport(start, end) {
  var content = document.getElementById('sr-report-content');
  content.innerHTML = '<div style="text-align:center;padding:60px;color:rgba(255,255,255,.4);font-size:13px">Loading report…</div>';

  await ensureReportLibs();

  var rangeDays = Math.max(1, Math.round((end - start) / 86400000));
  var bucket = rangeDays <= 2 ? 'hour' : (rangeDays <= 60 ? 'day' : (rangeDays <= 180 ? 'week' : 'month'));
  var prevStart = new Date(start.getTime() - (end - start));

  var curRes = await db.from('store_orders')
    .select('total, created_at, payment_method, payment_status, items')
    .gte('created_at', start.toISOString())
    .lte('created_at', end.toISOString())
    .not('status', 'eq', 'cancelled');
  var prevRes = await db.from('store_orders')
    .select('total')
    .gte('created_at', prevStart.toISOString())
    .lt('created_at', start.toISOString())
    .not('status', 'eq', 'cancelled');

  var current = curRes.data || [];
  var previous = prevRes.data || [];

  var startLbl = start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  var endLbl = end.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  var customPeriod = { label: startLbl + ' – ' + endLbl, bucket: bucket };
  _srCurrentLabel = customPeriod.label;

  var expensesTotal = typeof getExpensesTotal === 'function'
    ? await getExpensesTotal(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10))
    : 0;
  renderReport(customPeriod, 'custom', current, previous, expensesTotal);
}

function bucketLabel(date, bucketType) {
  if (bucketType === 'hour') return date.toLocaleTimeString('en-IN', { hour: '2-digit', hour12: true }).replace(' ', '');
  if (bucketType === 'day') return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  if (bucketType === 'week') return 'Wk of ' + date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  return date.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
}

function bucketKey(date, bucketType) {
  if (bucketType === 'hour') return date.toISOString().slice(0, 13);
  if (bucketType === 'day') return date.toISOString().slice(0, 10);
  if (bucketType === 'week') {
    var d = new Date(date);
    d.setDate(d.getDate() - d.getDay());
    return d.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 7);
}

function renderReport(period, periodKey, orders, prevOrders, expensesTotal) {
  expensesTotal = expensesTotal || 0;
  var totalRevenue = orders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var totalOrders = orders.length;
  var avgOrder = totalOrders ? totalRevenue / totalOrders : 0;
  var netProfit = totalRevenue - expensesTotal;
  var prevRevenue = prevOrders.reduce(function (s, o) { return s + (o.total || 0); }, 0);
  var revenueChange = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : null;

  var buckets = {};
  orders.forEach(function (o) {
    var d = new Date(o.created_at);
    var k = bucketKey(d, period.bucket);
    if (!buckets[k]) buckets[k] = { total: 0, date: d };
    buckets[k].total += o.total || 0;
  });
  var sortedKeys = Object.keys(buckets).sort();
  var trendLabels = sortedKeys.map(function (k) { return bucketLabel(buckets[k].date, period.bucket); });
  var trendData = sortedKeys.map(function (k) { return buckets[k].total; });

  var itemTotals = {};
  orders.forEach(function (o) {
    var items = Array.isArray(o.items) ? o.items : (typeof o.items === 'string' ? JSON.parse(o.items || '[]') : []);
    items.forEach(function (i) {
      var rev = (i.price || 0) * (i.qty || 1);
      itemTotals[i.name] = (itemTotals[i.name] || 0) + rev;
    });
  });
  var topItems = Object.keys(itemTotals).map(function (n) { return { name: n, revenue: itemTotals[n] }; })
    .sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 8);

  var payTotals = { Cash: 0, UPI: 0, 'Other Digital': 0, Complimentary: 0 };
  orders.forEach(function (o) {
    var amt = o.total || 0;
    var pm = (o.payment_method || '').toLowerCase();
    if (o.payment_status === 'complimentary') payTotals['Complimentary'] += amt;
    else if (pm === 'cash') payTotals['Cash'] += amt;
    else if (pm === 'upi' || pm === 'upi_qr') payTotals['UPI'] += amt;
    else payTotals['Other Digital'] += amt;
  });

  // ── Peak Hours — aggregate revenue by hour-of-day (0-23), regardless
  // of which specific date, across the whole selected period.
  var hourTotals = new Array(24).fill(0);
  orders.forEach(function (o) {
    var h = new Date(o.created_at).getHours();
    hourTotals[h] += o.total || 0;
  });
  var hourLabels = hourTotals.map(function (_, h) {
    return h === 0 ? '12am' : h < 12 ? h + 'am' : h === 12 ? '12pm' : (h - 12) + 'pm';
  });
  var peakHourIdx = hourTotals.indexOf(Math.max.apply(null, hourTotals));
  var peakHourLabel = hourLabels[peakHourIdx];

  // ── Best Days of Week — aggregate revenue by day-of-week (Sun-Sat).
  var dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var dayTotals = new Array(7).fill(0);
  orders.forEach(function (o) {
    var d = new Date(o.created_at).getDay();
    dayTotals[d] += o.total || 0;
  });
  var bestDayIdx = dayTotals.indexOf(Math.max.apply(null, dayTotals));
  var bestDayLabel = dayNames[bestDayIdx];

  var content = document.getElementById('sr-report-content');
  var compareLabel = periodKey === 'custom' ? 'previous period' : ('previous ' + period.label.toLowerCase().replace('ly', ''));
  var changeHtml = revenueChange === null
    ? '<span style="color:rgba(255,255,255,.3)">No prior data</span>'
    : (revenueChange >= 0
        ? '<span style="color:#4ade80">▲ ' + revenueChange.toFixed(1) + '% vs ' + compareLabel + '</span>'
        : '<span style="color:#f87171">▼ ' + Math.abs(revenueChange).toFixed(1) + '% vs ' + compareLabel + '</span>');

  content.innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">'
    + srStatCard('TOTAL REVENUE', '₹' + totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 0 }), changeHtml)
    + srStatCard('TOTAL ORDERS', totalOrders.toLocaleString('en-IN'), '')
    + srStatCard('AVG ORDER VALUE', '₹' + avgOrder.toFixed(0), '')
    + srStatCard('TOTAL EXPENSES', '₹' + expensesTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 }), '')
    + srStatCard('NET PROFIT', '₹' + netProfit.toLocaleString('en-IN', { maximumFractionDigits: 0 }),
        netProfit >= 0 ? '<span style="color:#4ade80">Profitable</span>' : '<span style="color:#f87171">Loss</span>')
    + '</div>'

    + '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:200px;background:linear-gradient(135deg,rgba(245,196,48,0.15),rgba(245,196,48,0.03));'
    + 'border:1px solid rgba(245,196,48,0.3);border-radius:16px;padding:16px;text-align:center">'
    + '<div style="font-size:10px;letter-spacing:1.5px;color:#f5c430;font-weight:700">🔥 PEAK HOUR</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin-top:4px">' + peakHourLabel + '</div>'
    + '</div>'
    + '<div style="flex:1;min-width:200px;background:linear-gradient(135deg,rgba(192,132,252,0.15),rgba(192,132,252,0.03));'
    + 'border:1px solid rgba(192,132,252,0.3);border-radius:16px;padding:16px;text-align:center">'
    + '<div style="font-size:10px;letter-spacing:1.5px;color:#c084fc;font-weight:700">📅 BEST DAY</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#fff;margin-top:4px">' + bestDayLabel + '</div>'
    + '</div></div>'

    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;'
    + 'padding:20px;margin-bottom:16px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">REVENUE TREND</div>'
    + '<canvas id="sr-trend-chart" height="90"></canvas></div>'

    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'
    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">PEAK HOURS</div>'
    + '<canvas id="sr-hours-chart" height="180"></canvas></div>'
    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">BEST DAYS OF WEEK</div>'
    + '<canvas id="sr-days-chart" height="180"></canvas></div>'
    + '</div>'

    + '<div style="display:grid;grid-template-columns:1.3fr 1fr;gap:16px" id="sr-grid-2col">'
    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">TOP SELLING ITEMS</div>'
    + '<canvas id="sr-items-chart" height="200"></canvas></div>'
    + '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px">'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c084fc;font-weight:700;margin-bottom:14px">PAYMENT METHODS</div>'
    + '<canvas id="sr-payment-chart" height="200"></canvas></div>'
    + '</div>';

  Object.keys(_srCharts).forEach(function (k) { if (_srCharts[k]) _srCharts[k].destroy(); });

  var purple = '#9c0ca1', gridColor = 'rgba(255,255,255,.06)', textColor = 'rgba(255,255,255,.5)';

  _srCharts.trend = new Chart(document.getElementById('sr-trend-chart'), {
    type: 'line',
    data: {
      labels: trendLabels,
      datasets: [{
        data: trendData, borderColor: purple, backgroundColor: 'rgba(156,12,161,.15)',
        fill: true, tension: 0.35, pointRadius: 3, pointBackgroundColor: purple
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
      }
    }
  });

  _srCharts.hours = new Chart(document.getElementById('sr-hours-chart'), {
    type: 'bar',
    data: {
      labels: hourLabels,
      datasets: [{
        data: hourTotals,
        backgroundColor: hourTotals.map(function (_, i) { return i === peakHourIdx ? '#f5c430' : 'rgba(245,196,48,0.25)'; }),
        borderRadius: 4
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, font: { size: 8 }, maxRotation: 90, minRotation: 90 }, grid: { display: false } },
        y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
      }
    }
  });

  _srCharts.days = new Chart(document.getElementById('sr-days-chart'), {
    type: 'bar',
    data: {
      labels: dayNames,
      datasets: [{
        data: dayTotals,
        backgroundColor: dayTotals.map(function (_, i) { return i === bestDayIdx ? '#c084fc' : 'rgba(192,132,252,0.25)'; }),
        borderRadius: 6
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, font: { size: 11 } }, grid: { display: false } },
        y: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } }
      }
    }
  });

  _srCharts.items = new Chart(document.getElementById('sr-items-chart'), {
    type: 'bar',
    data: {
      labels: topItems.map(function (i) { return i.name; }),
      datasets: [{ data: topItems.map(function (i) { return i.revenue; }), backgroundColor: '#b87410', borderRadius: 6 }]
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor, font: { size: 10 } }, grid: { color: gridColor } },
        y: { ticks: { color: '#fff', font: { size: 11 } }, grid: { display: false } }
      }
    }
  });

  _srCharts.payment = new Chart(document.getElementById('sr-payment-chart'), {
    type: 'doughnut',
    data: {
      labels: Object.keys(payTotals),
      datasets: [{ data: Object.values(payTotals), backgroundColor: ['#15803d', '#6e0977', '#b87410', '#c084fc'], borderWidth: 0 }]
    },
    options: { plugins: { legend: { position: 'bottom', labels: { color: '#fff', font: { size: 10 }, padding: 12 } } } }
  });
}

function srStatCard(label, value, sub) {
  return '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:16px">'
    + '<div style="font-size:10px;letter-spacing:1.5px;color:rgba(255,255,255,.4);font-weight:700">' + label + '</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:900;color:#fff;margin:6px 0 4px">' + value + '</div>'
    + '<div style="font-size:11px;font-weight:600">' + sub + '</div></div>';
}

async function downloadReportPdf() {
  showStoreToast('📥 Preparing PDF…');
  await ensureReportLibs();

  var target = document.getElementById('sr-report-content');
  try {
    var canvas = await html2canvas(target, { backgroundColor: '#0e0716', scale: 2 });
    var imgData = canvas.toDataURL('image/png');
    var jsPDF = window.jspdf.jsPDF;
    var pdf = new jsPDF({ orientation: 'p', unit: 'pt', format: 'a4' });

    var pageWidth = pdf.internal.pageSize.getWidth();
    var pageHeight = pdf.internal.pageSize.getHeight();
    var imgWidth = pageWidth - 40;
    var imgHeight = (canvas.height * imgWidth) / canvas.width;

    pdf.setFillColor(14, 7, 22);
    pdf.rect(0, 0, pageWidth, pageHeight, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(16);
    pdf.text('NSDI ChocoCravings — ' + _srCurrentLabel + ' Sales Report', 20, 30);
    pdf.setFontSize(9);
    pdf.setTextColor(200, 180, 220);
    pdf.text(new Date().toLocaleString('en-IN'), 20, 44);

    var y = 56;
    if (imgHeight > pageHeight - y - 20) {
      var scale = (pageHeight - y - 20) / imgHeight;
      imgHeight *= scale;
      imgWidth *= scale;
    }
    pdf.addImage(imgData, 'PNG', 20, y, imgWidth, imgHeight);

    pdf.save('chococravings-' + _srPeriod + '-report-' + new Date().toISOString().slice(0, 10) + '.pdf');
    showStoreToast('✅ PDF downloaded');
  } catch (e) {
    showStoreToast('PDF error: ' + e.message);
  }
}

/**
 * daily-summary-patch.js — ChocoCravings On Store
 * Feature: owner's daily summary (Reports > Today's summary).
 *
 *  - Shows one day's sales (store + online), cash / UPI split, top items,
 *    wastage, materials to buy and staff still clocked in, with ‹ › to
 *    look at earlier days. Data: cc_daily_summary (migrations/20260968).
 *  - "Send to this phone at 10 pm" subscribes this device for push; the
 *    database sends the summary every night at 22:00 IST.
 *  - Opening the notification lands on store.html?open=daily-summary.
 *
 * Owner (customers.is_super_user) only — the RPC refuses anyone else.
 * Load AFTER reports-hub-patch.js.
 */

var _dsumDay = null;

function dsumToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dsumShift(day, delta) {
  var d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + delta); return d.toISOString().slice(0, 10);
}
function dsumEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function dsumRs(v) { return '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN'); }

function buildDailySummaryUI() {
  if (document.getElementById('dsum-sheet')) return;
  var overlay = document.createElement('div');
  overlay.id = 'dsum-overlay'; overlay.onclick = closeDailySummary;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:3950;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);
  var sheet = document.createElement('div');
  sheet.id = 'dsum-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', "Today's summary");
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:560px;background:#fffbf2;'
    + 'border-radius:24px 24px 0 0;z-index:3951;max-height:90vh;overflow-y:auto;font-family:\'Instrument Sans\',\'DM Sans\',sans-serif;'
    + 'padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))';
  sheet.innerHTML =
      '<div style="position:sticky;top:0;background:#fffbf2;z-index:1;padding:14px 20px 12px;border-bottom:1px solid #f0e4d4">'
    +   '<div style="width:40px;height:4px;border-radius:2px;background:#e6d6c4;margin:0 auto 12px"></div>'
    +   '<div style="display:flex;align-items:center;gap:10px">'
    +     '<div style="flex:1"><div style="font-size:9px;font-weight:700;letter-spacing:2.5px;color:#9c0ca1;text-transform:uppercase">Owner</div>'
    +     '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#1a0820">Daily summary</div></div>'
    +     '<button type="button" onclick="dsumGo(-1)" aria-label="Previous day" style="width:36px;height:36px;border-radius:50%;border:1px solid #e6d6c4;background:#fff;font-size:18px;color:#6e0977;cursor:pointer">‹</button>'
    +     '<div id="dsum-date" style="min-width:92px;text-align:center;font-size:12px;font-weight:700;color:#3b1a08"></div>'
    +     '<button type="button" id="dsum-next" onclick="dsumGo(1)" aria-label="Next day" style="width:36px;height:36px;border-radius:50%;border:1px solid #e6d6c4;background:#fff;font-size:18px;color:#6e0977;cursor:pointer">›</button>'
    +     '<button type="button" onclick="closeDailySummary()" aria-label="Close" style="width:36px;height:36px;border-radius:50%;border:0;background:rgba(18,10,30,.06);font-size:16px;color:#3b1a08;cursor:pointer">✕</button>'
    +   '</div></div>'
    + '<div id="dsum-body" style="padding:16px 20px"></div>'
    + '<div id="dsum-push" style="padding:0 20px"></div>';
  document.body.appendChild(sheet);
}

function openDailySummary(day) {
  buildDailySummaryUI();
  _dsumDay = day || dsumToday();
  document.getElementById('dsum-overlay').style.display = 'block';
  document.getElementById('dsum-sheet').style.display = 'block';
  loadDailySummary();
  dsumRenderPush();
}
function closeDailySummary() {
  var o = document.getElementById('dsum-overlay'), s = document.getElementById('dsum-sheet');
  if (o) o.style.display = 'none'; if (s) s.style.display = 'none';
}
function dsumGo(delta) {
  var next = dsumShift(_dsumDay, delta);
  if (next > dsumToday()) return;
  _dsumDay = next; loadDailySummary();
}

function dsumChips(list, tone) {
  var bg = tone === 'warn' ? 'rgba(245,158,11,.12)' : 'rgba(110,9,119,.08)', fg = tone === 'warn' ? '#8a5a00' : '#6e0977';
  return list.map(function (n) { return '<span style="display:inline-block;margin:0 6px 6px 0;padding:5px 10px;border-radius:999px;background:' + bg + ';color:' + fg + ';font-size:12px;font-weight:600">' + dsumEsc(n) + '</span>'; }).join('');
}
function dsumSection(title, html) {
  return '<div style="margin-top:18px"><div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#c2607a;text-transform:uppercase;margin-bottom:8px">' + title + '</div>' + html + '</div>';
}

async function loadDailySummary() {
  var body = document.getElementById('dsum-body');
  var isToday = _dsumDay === dsumToday();
  document.getElementById('dsum-date').textContent = isToday ? 'Today' : new Date(_dsumDay + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  document.getElementById('dsum-next').disabled = isToday;
  document.getElementById('dsum-next').style.opacity = isToday ? '.35' : '1';
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:12px">Loading…</div>';
  var day = _dsumDay;
  var res = await db.rpc('cc_daily_summary', { p_day: day });
  if (day !== _dsumDay) return;
  if (res.error) {
    var msg = res.error.message || '';
    body.innerHTML = '<div style="padding:20px;border-radius:14px;background:#fff3f3;color:#991b1b;font-size:13px">'
      + (/cc_daily_summary|schema cache/i.test(msg) ? 'The database update is missing. Run migrations/20260968_daily_summary.sql in Supabase.' : dsumEsc(msg)) + '</div>';
    return;
  }
  var s = res.data || {}, st = s.store || {}, on = s.online || {}, w = s.wastage || {};
  var last = Number(s.last_week_revenue) || 0, rev = Number(s.revenue) || 0;
  var change = last > 0 ? Math.round((rev / last - 1) * 100) : null;
  var weekday = new Date(day + 'T12:00:00Z').toLocaleDateString('en-IN', { weekday: 'long' });
  var pay = [['UPI', st.upi], ['Cash collected', st.cash], ['Cash not yet paid', st.cash_pending], ['Other', st.other], ['Online orders', on.revenue], ['Complimentary', st.complimentary]]
    .filter(function (p) { return Number(p[1]) > 0; });
  var top = s.top_items || [];
  var maxQty = top.reduce(function (m, t) { return Math.max(m, Number(t.qty) || 0); }, 0) || 1;

  body.innerHTML =
      '<div style="border-radius:20px;padding:20px;color:#f5eadc;background:linear-gradient(150deg,#3b1a08,#6e0977)">'
    +   '<div style="font-size:10px;letter-spacing:2px;font-weight:700;opacity:.7">SALES</div>'
    +   '<div style="font-family:Fraunces,Georgia,serif;font-size:38px;font-weight:900;line-height:1.1;margin-top:4px">' + dsumRs(rev) + '</div>'
    +   '<div style="font-size:13px;opacity:.85;margin-top:4px">' + (s.orders || 0) + ' orders'
    +     (change == null ? '' : ' · <span style="font-weight:700;color:' + (change >= 0 ? '#86efac' : '#fca5a5') + '">' + (change >= 0 ? '▲ ' : '▼ ') + Math.abs(change) + '%</span> vs last ' + weekday + ' (' + dsumRs(last) + ')')
    +   '</div></div>'
    + (pay.length ? dsumSection('Payments', '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">'
        + pay.map(function (p) { return '<div style="background:#fff;border:1px solid #f0e4d4;border-radius:12px;padding:10px 12px"><div style="font-size:11px;color:#9a8aaa">' + p[0] + '</div><div style="font-size:16px;font-weight:800;color:#1a0820">' + dsumRs(p[1]) + '</div></div>'; }).join('') + '</div>') : '')
    + dsumSection('Top items', top.length ? top.map(function (t) {
        var pct = Math.max(4, Math.round((Number(t.qty) || 0) / maxQty * 100));
        return '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;color:#1a0820"><span>' + dsumEsc(t.name) + '</span><b>×' + Number(t.qty) + '</b></div>'
          + '<div style="height:6px;border-radius:3px;background:#f0e4d4;margin-top:4px"><div style="width:' + pct + '%;height:100%;border-radius:3px;background:#6e0977"></div></div></div>';
      }).join('') : '<div style="font-size:13px;color:#9a8aaa">No counter sales yet.</div>')
    + dsumSection('Wastage', Number(w.pieces) > 0 ? '<div style="font-size:13px;color:#1a0820">🗑 ' + Number(w.pieces) + ' pcs thrown away · ' + dsumRs(w.cost) + '</div>' : '<div style="font-size:13px;color:#15803d">Nothing thrown away 👍</div>')
    + dsumSection('To buy (at or below reorder level)', (s.to_buy || []).length ? dsumChips(s.to_buy, 'warn') : '<div style="font-size:13px;color:#15803d">Nothing low 👍</div>')
    + ((s.still_clocked_in || []).length ? dsumSection('Not clocked out', dsumChips(s.still_clocked_in, 'warn')) : '');
}

// ── Push: send this summary to this phone at 10 pm ──
async function dsumPushState() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { ok: false, why: 'This browser cannot receive notifications.' };
  var key = await dsumVapidKey();
  if (!key) return { ok: false, why: 'Push notifications are not set up yet (vapid_public_key in app_settings).' };
  try {
    var reg = await navigator.serviceWorker.register('/sw.js');
    var sub = Notification.permission === 'granted' ? await reg.pushManager.getSubscription() : null;
    return { ok: true, on: !!sub, blocked: Notification.permission === 'denied', key: key };
  } catch (e) { return { ok: false, why: 'Could not start notifications on this device.' }; }
}
async function dsumVapidKey() {
  try { var r = await db.from('app_settings').select('value').eq('key', 'vapid_public_key').maybeSingle(); return (r.data && r.data.value) || ''; } catch (e) { return ''; }
}
function dsumB64(b64) {
  var pad = '='.repeat((4 - b64.length % 4) % 4), raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function dsumRenderPush() {
  var box = document.getElementById('dsum-push'); if (!box) return;
  var st = await dsumPushState();
  var btn = 'padding:12px 16px;border-radius:12px;font-size:13px;font-weight:700;cursor:pointer;';
  box.innerHTML = '<div style="margin-top:20px;border-top:1px solid #f0e4d4;padding-top:16px">'
    + (!st.ok ? '<div style="font-size:12px;color:#9a8aaa">' + dsumEsc(st.why) + '</div>'
      : st.on ? '<div style="font-size:13px;color:#15803d;font-weight:700;margin-bottom:10px">🔔 This phone gets the summary every night at 10 pm.</div>'
      : st.blocked ? '<div style="font-size:12px;color:#991b1b">Notifications are blocked for this app. Allow them in your phone settings to get the 10 pm summary.</div>'
      : '<button type="button" onclick="dsumEnablePush()" style="' + btn + 'width:100%;border:0;color:#fff;background:linear-gradient(135deg,#6e0977,#9c0ca1)">🔔 Send this to my phone every night at 10 pm</button>')
    + '<button type="button" onclick="dsumSendTest()" style="' + btn + 'width:100%;margin-top:8px;background:#fff;border:1px solid #e6d6c4;color:#6e0977">Send today\'s summary now (test)</button></div>';
}
async function dsumEnablePush() {
  try {
    var st = await dsumPushState(); if (!st.ok) { showStoreToast(st.why); return; }
    if (await Notification.requestPermission() !== 'granted') { showStoreToast('Notifications not allowed'); dsumRenderPush(); return; }
    var reg = await navigator.serviceWorker.ready;
    var sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: dsumB64(st.key) });
    var j = sub.toJSON();
    var res = await db.rpc('cc_push_subscribe', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_user_agent: navigator.userAgent });
    if (res.error) throw res.error;
    showStoreToast('🔔 You will get the summary at 10 pm');
  } catch (e) {
    showStoreToast('Could not turn on: ' + (e.message || e));
  }
  dsumRenderPush();
}
async function dsumSendTest() {
  var res = await db.rpc('cc_send_daily_summary');
  if (res.error) { showStoreToast('Not sent: ' + (/cc_send_daily_summary|schema cache/i.test(res.error.message || '') ? 'run migrations/20260968_daily_summary.sql' : res.error.message)); return; }
  showStoreToast(res.data && res.data.sent ? '📨 Sent — check your phone in a few seconds' : 'Not sent: ' + ((res.data && res.data.reason) || 'push not set up'));
}

// Notification tap: store.html?open=daily-summary
(function () {
  try {
    if (new URLSearchParams(location.search).get('open') !== 'daily-summary') return;
    var tries = 0, t = setInterval(function () {
      tries++;
      if (typeof db !== 'undefined' && db && typeof isAdmin !== 'undefined' && isAdmin) { clearInterval(t); openDailySummary(); }
      else if (tries > 40) clearInterval(t);
    }, 300);
  } catch (e) {}
})();

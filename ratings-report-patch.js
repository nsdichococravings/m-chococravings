/**
 * ratings-report-patch.js — ChocoCravings On Store
 * Staff-facing "Customer Ratings" report: average stars, star split,
 * per-product scores and every recent rating with its comment. Low
 * ratings (1–2★) are flagged with a Call / WhatsApp button so staff can
 * follow up, and the Command Center badge shows how many came in over
 * the last 7 days.
 *
 * Data: cc_ratings_report() from migrations/20260948_order_ratings.sql
 * (admin/staff only). Customers rate delivered orders from My Orders.
 *
 * Requires: db, showStoreToast(), registerAdminTool(), ccUpdateBadge()
 * — already global by the time this loads (see checkadminbadge-override.js).
 */

var _rrDialog = null;
var _rrReport = null;
var _rrDays = 30;

function rrEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function rrStars(n) {
  n = Math.round(Number(n) || 0);
  return '<span style="color:#e0a526">' + '★'.repeat(n) + '</span><span style="color:#e3d6e6">' + '★'.repeat(5 - n) + '</span>';
}

async function rrLoad(notify) {
  try {
    var res = await db.rpc('cc_ratings_report', { p_days: _rrDays });
    if (res.error) throw res.error;
    _rrReport = res.data;
    if (typeof ccUpdateBadge === 'function') ccUpdateBadge('ratings-report', _rrReport.low_7d || 0);
    if (notify && _rrReport.low_7d && typeof showStoreToast === 'function') {
      showStoreToast('⚠️ ' + _rrReport.low_7d + ' low customer rating' + (_rrReport.low_7d === 1 ? '' : 's') + ' this week — check Customer Ratings');
    }
  } catch (e) {
    console.warn('ratings report:', e.message);
    _rrReport = { error: e.message };
  }
  if (_rrDialog && _rrDialog.open) rrRender();
}

function rrInit() {
  if (_rrDialog) return;
  var d = document.createElement('dialog');
  d.id = 'rr-dialog';
  d.style.cssText = 'width:min(560px,calc(100% - 24px));max-height:92dvh;padding:0;border:1px solid #eadfeb;'
    + 'border-radius:22px;background:#fffaf3;color:#291830;font:14px \'DM Sans\',Arial,sans-serif';
  d.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;'
    +   'position:sticky;top:0;background:#fffaf3;border-bottom:1px solid #eadfeb;z-index:1">'
    +   '<div><div style="font-size:10px;letter-spacing:2px;color:#8c647f">CHOCOCRAVINGS</div>'
    +     '<h2 style="font:27px Georgia,serif;margin:5px 0 0">⭐ Customer Ratings</h2></div>'
    +   '<button type="button" onclick="rrClose()" style="font-size:26px;border:0;background:transparent;cursor:pointer">×</button>'
    + '</div>'
    + '<div id="rr-body" style="padding:0 24px 24px"></div>';
  d.addEventListener('cancel', function (e) { e.preventDefault(); rrClose(); });
  document.body.appendChild(d);
  _rrDialog = d;
}

function rrOpen() {
  rrInit();
  if (!_rrDialog.open) _rrDialog.showModal();
  rrRender();
  rrLoad(false);
}

function rrClose() {
  if (_rrDialog && _rrDialog.open) _rrDialog.close();
}

function rrSetDays(days) {
  _rrDays = days;
  _rrReport = null;
  rrRender();
  rrLoad(false);
}

function rrRender() {
  var body = document.getElementById('rr-body');
  if (!body) return;
  var tabs = '<div style="display:flex;gap:8px;margin:16px 0">' + [7, 30, 90].map(function (d) {
    var on = d === _rrDays;
    return '<button type="button" onclick="rrSetDays(' + d + ')" style="flex:1;padding:8px;border-radius:10px;cursor:pointer;font-weight:700;'
      + 'border:1px solid ' + (on ? '#6e0977' : '#eadfeb') + ';background:' + (on ? '#6e0977' : '#fff') + ';color:' + (on ? '#fff' : '#6e0977') + '">'
      + d + ' days</button>';
  }).join('') + '</div>';

  if (!_rrReport) { body.innerHTML = tabs + '<p style="text-align:center;color:#79677e;padding:30px 0">Loading…</p>'; return; }
  if (_rrReport.error) {
    body.innerHTML = tabs + '<p style="text-align:center;color:#b42318;padding:30px 0">Could not load ratings: ' + rrEsc(_rrReport.error) + '</p>';
    return;
  }
  var r = _rrReport;
  if (!r.count) {
    body.innerHTML = tabs + '<div style="text-align:center;padding:40px 0"><div style="font-size:32px;margin-bottom:8px">⭐</div>'
      + '<div style="font:19px Georgia,serif">No ratings in the last ' + r.days + ' days</div>'
      + '<div style="font-size:12px;color:#a08b9f;margin-top:4px">Customers can rate delivered orders from My Orders.</div></div>';
    return;
  }

  var split = '';
  for (var s = 5; s >= 1; s--) {
    var n = (r.split && r.split[s]) || 0, pct = Math.round(n * 100 / r.count);
    split += '<div style="display:flex;align-items:center;gap:8px;font-size:12px;margin:3px 0">'
      + '<span style="width:22px">' + s + '★</span>'
      + '<div style="flex:1;height:8px;background:#f1e7f2;border-radius:4px;overflow:hidden"><div style="width:' + pct + '%;height:100%;background:' + (s <= 2 ? '#d9534f' : '#e0a526') + '"></div></div>'
      + '<span style="width:28px;text-align:right;color:#79677e">' + n + '</span></div>';
  }

  var summary = '<div style="display:flex;gap:18px;align-items:center;background:#fff;border:1px solid #eadfeb;border-radius:16px;padding:16px">'
    + '<div style="text-align:center;min-width:90px"><div style="font:36px Georgia,serif">' + Number(r.avg).toFixed(1) + '</div>'
    + '<div>' + rrStars(r.avg) + '</div><div style="font-size:11px;color:#79677e;margin-top:4px">' + r.count + ' rating' + (r.count === 1 ? '' : 's') + '</div></div>'
    + '<div style="flex:1">' + split + '</div></div>';

  var products = (r.products || []).length
    ? '<h3 style="font-size:15px;margin:18px 0 8px">By product</h3>' + r.products.map(function (p) {
        return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1e7f2">'
          + '<span>' + rrEsc(p.name) + '</span><span>' + rrStars(p.avg) + ' <b>' + Number(p.avg).toFixed(1) + '</b> <span style="color:#79677e;font-size:12px">(' + p.count + ')</span></span></div>';
      }).join('')
    : '';

  var recent = '<h3 style="font-size:15px;margin:18px 0 8px">Recent ratings</h3>' + (r.recent || []).map(rrCard).join('');
  body.innerHTML = tabs + summary + products + recent;
}

function rrCard(x) {
  var low = x.stars <= 2;
  var digits = String(x.phone || '').replace(/\D/g, '');
  var when = x.at ? new Date(x.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '';
  var followUp = low && digits
    ? '<div style="display:flex;gap:8px;margin-top:10px">'
      + '<a href="tel:+' + digits + '" style="flex:1;text-align:center;padding:8px;border-radius:10px;border:1px solid #eadfeb;color:#291830;text-decoration:none;font-weight:700">📞 Call</a>'
      + '<a href="https://wa.me/' + digits + '?text=' + encodeURIComponent('Hi ' + (x.name || '') + ', this is ChocoCravings. We saw your rating for order ' + x.order_number + ' and we\'re sorry it wasn\'t perfect. Could you tell us what went wrong so we can make it right?')
      + '" target="_blank" style="flex:1;text-align:center;padding:8px;border-radius:10px;background:#25d366;color:#fff;text-decoration:none;font-weight:700">💬 WhatsApp</a></div>'
    : '';
  return '<div style="background:' + (low ? '#fff1f0' : '#fff') + ';border:1px solid ' + (low ? '#f5c2bd' : '#eadfeb') + ';border-radius:14px;padding:12px 14px;margin-bottom:10px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center">'
    + '<div><b>' + rrEsc(x.name) + '</b> <span style="color:#79677e;font-size:12px">· ' + rrEsc(x.order_number) + ' · ' + when + '</span></div>'
    + '<div>' + rrStars(x.stars) + '</div></div>'
    + (x.items ? '<div style="font-size:12px;color:#79677e;margin-top:4px">' + rrEsc(x.items) + '</div>' : '')
    + (x.comment ? '<div style="margin-top:8px;font-style:italic">“' + rrEsc(x.comment) + '”</div>' : '')
    + followUp + '</div>';
}

function _rrRegister() {
  if (window.registerAdminTool) {
    window.registerAdminTool('Growth & Insights', {
      icon: '⭐', iconBg: 'rgba(224,165,38,0.14)',
      title: 'Customer Ratings', subtitle: 'Stars, comments & low-rating follow-ups',
      badgeId: 'ratings-report',
      onClick: rrOpen
    });
  }
  rrLoad(true);
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _rrRegister); } else { _rrRegister(); }
window.openRatingsReport = rrOpen;

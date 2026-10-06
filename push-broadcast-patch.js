/**
 * push-broadcast-patch.js — ChocoCravings On Store
 * Admin tool "Send Notification": pushes an offer or announcement to every
 * customer device that has turned on notifications.
 *
 * Sends through the send-push Edge Function (supabase/functions/send-push),
 * which re-checks customers.is_admin for the signed-in user — hiding this
 * tool is not the only protection. Setup: migrations/20260950_push_notifications.sql.
 *
 * Requires: db, registerAdminTool() — already global by the time this
 * loads (see checkadminbadge-override.js). Admin-only.
 */

var _pbDialog = null;

function pbInit() {
  if (_pbDialog) return;
  var d = document.createElement('dialog');
  d.id = 'pb-dialog';
  d.style.cssText = 'width:min(480px,calc(100% - 24px));padding:0;border:1px solid #eadfeb;'
    + 'border-radius:22px;background:#fffaf3;color:#291830;font:14px \'DM Sans\',Arial,sans-serif';
  var field = 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #eadfeb;border-radius:12px;font:inherit;background:#fff;color:#291830';
  d.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #eadfeb">'
    +   '<div><div style="font-size:10px;letter-spacing:2px;color:#8c647f">CHOCOCRAVINGS</div>'
    +     '<h2 style="font:25px Georgia,serif;margin:5px 0 0">🔔 Send Notification</h2></div>'
    +   '<button type="button" onclick="pbClose()" style="font-size:26px;border:0;background:transparent;cursor:pointer">×</button>'
    + '</div>'
    + '<div style="padding:18px 24px 24px;display:flex;flex-direction:column;gap:12px">'
    +   '<div style="font-size:12px;color:#79677e">Goes to every customer who turned on notifications. Use it for offers and news — order updates are sent automatically.</div>'
    +   '<label style="font-size:12px;font-weight:700">Title<input id="pb-title" maxlength="60" placeholder="Weekend special 🍫" style="' + field + ';margin-top:4px"></label>'
    +   '<label style="font-size:12px;font-weight:700">Message<textarea id="pb-body" maxlength="180" rows="3" placeholder="Buy 2 boxes, get 1 classic brownie free — today only!" style="' + field + ';margin-top:4px;resize:none"></textarea></label>'
    +   '<label style="font-size:12px;font-weight:700">When tapped, open'
    +     '<select id="pb-url" style="' + field + ';margin-top:4px">'
    +       '<option value="/index.html">Home</option>'
    +       '<option value="/index.html?open=orders">My Orders</option>'
    +     '</select></label>'
    +   '<div id="pb-reach" style="font-size:12px;color:#4b2a55;background:#f4ecf7;border-radius:10px;padding:9px 11px"></div>'
    +   '<div id="pb-status" style="font-size:12px;color:#79677e;min-height:16px"></div>'
    +   '<button type="button" id="pb-send" onclick="pbSend()" style="padding:13px;border:0;border-radius:14px;background:#6e0977;color:#fff;font-weight:700;font-size:14px;cursor:pointer">Send to all customers</button>'
    + '</div>';
  d.addEventListener('cancel', function (e) { e.preventDefault(); pbClose(); });
  document.body.appendChild(d);
  _pbDialog = d;
}

function pbOpen() {
  pbInit();
  document.getElementById('pb-status').textContent = '';
  if (!_pbDialog.open) _pbDialog.showModal();
  pbLoadReach();
}

// "Reaches N customers" line (cc_push_reach, migrations/20260974_push_reach.sql).
async function pbLoadReach() {
  var el = document.getElementById('pb-reach'); if (!el) return;
  el.textContent = 'Checking how many customers this reaches…';
  try {
    var res = await db.rpc('cc_push_reach');
    if (res.error) throw res.error;
    var r = res.data || {};
    el.innerHTML = r.customers
      ? '📱 Reaches <b>' + r.customers + ' customer' + (r.customers === 1 ? '' : 's') + '</b> on ' + r.devices + ' device' + (r.devices === 1 ? '' : 's')
        + (r.new_7d ? ' · +' + r.new_7d + ' this week' : '')
      : '📱 <b>No customer has turned on notifications yet.</b> Customers turn them on in the customer app (after ordering, or Profile → Order Notifications). Use WhatsApp for offers until more join.';
  } catch (e) {
    el.textContent = /cc_push_reach|schema cache/i.test(String(e.message || e)) ? 'Run migrations/20260974_push_reach.sql to see how many customers this reaches.' : '';
  }
}

function pbClose() {
  if (_pbDialog && _pbDialog.open) _pbDialog.close();
}

async function pbSend() {
  var title = document.getElementById('pb-title').value.trim();
  var body = document.getElementById('pb-body').value.trim();
  var url = document.getElementById('pb-url').value;
  var status = document.getElementById('pb-status');
  var btn = document.getElementById('pb-send');
  if (!title || !body) { status.textContent = 'Enter a title and a message.'; return; }
  if (!confirm('Send "' + title + '" to all customers with notifications on?')) return;
  btn.disabled = true; btn.textContent = 'Sending…'; status.textContent = '';
  try {
    var res = await db.functions.invoke('send-push', { body: { type: 'broadcast', title: title, body: body, url: url } });
    if (res.error) throw res.error;
    var r = res.data || {};
    status.textContent = r.sent
      ? '✅ Sent to ' + r.sent + ' device' + (r.sent === 1 ? '' : 's') + (r.removed ? ' (' + r.removed + ' expired removed)' : '') + '.'
      : 'Sent to 0 devices — no customer phone has notifications on yet' + (r.removed ? ' (' + r.removed + ' expired removed)' : '') + '.';
    pbLoadReach();
    document.getElementById('pb-title').value = '';
    document.getElementById('pb-body').value = '';
  } catch (e) {
    status.textContent = '❌ Could not send: ' + (e.message || e) + ' — is the send-push function deployed?';
  }
  btn.disabled = false; btn.textContent = 'Send to all customers';
}

function _pbRegister() {
  if (window.registerAdminTool) {
    window.registerAdminTool('Growth & Insights', {
      icon: '🔔', iconBg: 'rgba(110,9,119,0.12)',
      title: 'Send Notification', subtitle: 'Push an offer to customers\' phones',
      onClick: pbOpen
    });
  }
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _pbRegister); } else { _pbRegister(); }
window.openPushBroadcast = pbOpen;

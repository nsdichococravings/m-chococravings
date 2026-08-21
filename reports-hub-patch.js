/**
 * reports-hub-patch.js — ChocoCravings On Store
 * Feature: Consolidated "Reports" entry point. Replaces separate Day
 * Close and Sales Reports FAB entries with a single "📈 Reports" entry
 * that opens a hub screen listing both (plus room for future reports),
 * gated behind a real super-user flag — stricter than regular is_admin.
 *
 * Load AFTER day-close-patch.js and sales-reports-patch.js, right
 * before </body>:
 *   <script src="reports-hub-patch.js"></script>
 *
 * Requires DB setup: run add-super-user-column.sql once in Supabase.
 * Requires: `db`, `openDayClose()` (from day-close-patch.js),
 * `openReports()` (from sales-reports-patch.js) — all already loaded.
 *
 * NOTE: day-close-patch.js and sales-reports-patch.js no longer inject
 * their own FAB menu entries — only this file does. Their own
 * `openDayClose()` / `openReports()` functions are still what actually
 * builds and shows each report; this file just owns the single shared
 * entry point and the super-user check.
 */

document.addEventListener('DOMContentLoaded', function () {
  buildReportsHubUI();
  waitForSuperUserThenInject();
});

function waitForSuperUserThenInject() {
  var attempts = 0;
  var poll = setInterval(async function () {
    attempts++;
    // A super user is always an admin too — so wait for BOTH db and a
    // confirmed isAdmin=true before running the extra is_super_user
    // query. This means regular customers (the vast majority of
    // visitors) never trigger this check at all, only the much smaller
    // pool of already-confirmed admin accounts do.
    if (typeof db !== 'undefined' && db && typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      var allowed = await checkSuperUserAccess();
      if (allowed) injectReportsHubMenuEntry();
    } else if (attempts >= 30) {
      clearInterval(poll); // not an admin session, or checks never resolved — skip entirely
    }
  }, 300);
}

async function checkSuperUserAccess() {
  try {
    // getSession() reads from local cache — no forced network round-trip,
    // same reasoning as the earlier staff-access performance fix.
    var s = await db.auth.getSession();
    var user = s.data && s.data.session ? s.data.session.user : null;
    if (!user) return false;
    var res = await db.from('customers').select('is_super_user').eq('email', user.email).single();
    return !!(res.data && res.data.is_super_user);
  } catch (e) {
    return false;
  }
}

function injectReportsHubMenuEntry() {
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.onclick = function () { openReportsHub(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(110,9,119,0.1);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📈</div>'
    + '<div><div style="font-size:13px;font-weight:600;color:#1a0820">Reports</div>'
    + '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Business reports & dashboards</div></div>';

  fabMenu.appendChild(entry);
}

function buildReportsHubUI() {
  var overlay = document.createElement('div');
  overlay.id = 'rh-overlay';
  overlay.onclick = closeReportsHub;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3900;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'rh-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3901;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:80vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:4px">Super User</div>'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Reports</div>'
    +   '</div>'
    +   '<div onclick="closeReportsHub()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">'

    +   '<div onclick="rhOpen(\'daily-close\')" style="display:flex;align-items:center;gap:14px;'
    +     'background:#f5eeff;border:1.5px solid #e0c8f0;border-radius:16px;padding:16px;cursor:pointer">'
    +     '<div style="width:44px;height:44px;border-radius:12px;background:rgba(110,9,119,0.12);'
    +       'display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🧾</div>'
    +     '<div style="flex:1">'
    +       '<div style="font-size:14px;font-weight:700;color:#1a0820">Daily Close Reports</div>'
    +       '<div style="font-size:12px;color:#9a8aaa;margin-top:2px">Cash reconciliation & payment breakdown</div>'
    +     '</div>'
    +     '<div style="color:#6e0977;font-size:18px">›</div>'
    +   '</div>'

    +   '<div onclick="rhOpen(\'sales-reports\')" style="display:flex;align-items:center;gap:14px;'
    +     'background:#f5eeff;border:1.5px solid #e0c8f0;border-radius:16px;padding:16px;cursor:pointer">'
    +     '<div style="width:44px;height:44px;border-radius:12px;background:rgba(110,9,119,0.12);'
    +       'display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">📊</div>'
    +     '<div style="flex:1">'
    +       '<div style="font-size:14px;font-weight:700;color:#1a0820">Sales Reports</div>'
    +       '<div style="font-size:12px;color:#9a8aaa;margin-top:2px">Dashboards, trends & PDF export</div>'
    +     '</div>'
    +     '<div style="color:#6e0977;font-size:18px">›</div>'
    +   '</div>'

    +   '<div style="display:flex;align-items:center;gap:14px;background:#faf7fb;'
    +     'border:1.5px dashed #ddd0ea;border-radius:16px;padding:16px;opacity:.6">'
    +     '<div style="width:44px;height:44px;border-radius:12px;background:rgba(18,10,30,0.05);'
    +       'display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">➕</div>'
    +     '<div style="flex:1">'
    +       '<div style="font-size:14px;font-weight:700;color:#6a5a7a">More reports coming soon</div>'
    +       '<div style="font-size:12px;color:#9a8aaa;margin-top:2px">Staff performance, wastage, margins & more</div>'
    +     '</div>'
    +   '</div>'

    + '</div>';
  document.body.appendChild(sheet);
}

function openReportsHub() {
  document.getElementById('rh-overlay').style.display = 'block';
  document.getElementById('rh-sheet').style.display   = 'block';
}
function closeReportsHub() {
  document.getElementById('rh-overlay').style.display = 'none';
  document.getElementById('rh-sheet').style.display   = 'none';
}

function rhOpen(which) {
  closeReportsHub();
  if (which === 'daily-close') {
    if (typeof openDayClose === 'function') openDayClose();
    else alert('Day Close module not loaded — check that day-close-patch.js is included.');
  } else if (which === 'sales-reports') {
    if (typeof openReports === 'function') openReports();
    else alert('Sales Reports module not loaded — check that sales-reports-patch.js is included.');
  }
}

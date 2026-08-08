/**
 * staff-order-patch.js — ChocoCravings On Store
 * Feature: Standalone "Staff" role for employees — mobile access to the
 * Tables ordering board ONLY. Fully independent of the HRM/employees
 * system (which isn't functional yet) — uses its own store_staff table
 * and rpc_staff_login RPC.
 *
 * Also adds a "🧑‍🍳 Manage Staff" entry to the Admin FAB so you can add,
 * deactivate, or remove staff yourself without touching Supabase directly.
 *
 * Load AFTER table-service-patch.js, right before </body>:
 *   <script src="staff-order-patch.js"></script>
 *
 * Requires DB setup: run create-store-staff.sql once in Supabase.
 * Requires: `db` (Supabase client), `openTablesBoard()`,
 * `showStoreToast()` — all already global on this page.
 */

var STAFF_SESSION_KEY = 'cc_staff_session';
var _staffSession = null;

document.addEventListener('DOMContentLoaded', function () {
  buildStaffLoginUI();
  buildManageStaffUI();
  injectManageStaffMenuEntry();
  restoreStaffSession();
});

// ══════════════════════════════════════════════════════════════
// PART 1 — Staff login (for employees taking table orders)
// ══════════════════════════════════════════════════════════════

function buildStaffLoginUI() {
  var loginBtn = document.createElement('div');
  loginBtn.id = 'staff-login-btn';
  loginBtn.onclick = openStaffLoginSheet;
  loginBtn.style.cssText = 'position:fixed;bottom:24px;left:14px;z-index:400;'
    + 'background:#fff;border:1px solid rgba(18,10,30,0.12);border-radius:22px;'
    + 'padding:8px 14px;display:flex;align-items:center;gap:6px;cursor:pointer;'
    + 'box-shadow:0 4px 16px rgba(18,10,30,0.12);font-family:\'Instrument Sans\',sans-serif';
  loginBtn.innerHTML = '<span style="font-size:14px">👤</span>'
    + '<span style="font-size:11px;font-weight:700;color:#6e0977;letter-spacing:.3px">Staff Login</span>';
  document.body.appendChild(loginBtn);

  var badge = document.createElement('div');
  badge.id = 'staff-logged-badge';
  badge.style.cssText = 'display:none;position:fixed;bottom:24px;left:14px;z-index:400;'
    + 'background:#fff;border:1px solid rgba(34,197,94,0.3);border-radius:22px;'
    + 'padding:8px 14px;align-items:center;gap:8px;cursor:pointer;'
    + 'box-shadow:0 4px 16px rgba(18,10,30,0.12);font-family:\'Instrument Sans\',sans-serif';
  badge.onclick = staffLogout;
  document.body.appendChild(badge);

  var tablesFab = document.createElement('div');
  tablesFab.id = 'staff-tables-fab';
  tablesFab.onclick = function () { if (typeof openTablesBoard === 'function') openTablesBoard(); };
  tablesFab.style.cssText = 'display:none;position:fixed;bottom:24px;right:20px;z-index:400;'
    + 'width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,#b87410,#d4930e);'
    + 'align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(184,116,16,0.4);'
    + 'cursor:pointer;font-size:24px';
  tablesFab.innerHTML = '🍽️';
  document.body.appendChild(tablesFab);

  var overlay = document.createElement('div');
  overlay.id = 'staff-login-overlay';
  overlay.onclick = closeStaffLoginSheet;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3200;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'staff-login-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3201;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between">'
    +     '<div>'
    +       '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +         'color:#9c0ca1;margin-bottom:4px">Employee Access</div>'
    +       '<div style="font-size:18px;font-weight:700;color:#1a0820">Staff Sign In</div>'
    +     '</div>'
    +     '<div onclick="closeStaffLoginSheet()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">'
    +   '<div style="font-size:11px;color:#9a8aaa;line-height:1.5">'
    +     'Pick your name and enter your PIN to take table orders. This only unlocks the Tables board.</div>'
    +   '<select id="staff-login-name" style="width:100%;padding:13px 14px;border-radius:12px;'
    +     'border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;'
    +     'box-sizing:border-box;background:#fff;cursor:pointer">'
    +     '<option value="">Loading staff…</option>'
    +   '</select>'
    +   '<input id="staff-login-pin" type="password" inputmode="numeric" maxlength="6" placeholder="PIN" '
    +     'style="width:100%;padding:13px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);'
    +     'font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    +   '<div id="staff-login-error" style="font-size:12px;color:#c24545;min-height:16px"></div>'
    +   '<button id="staff-login-btn-submit" onclick="staffAttemptLogin()" style="width:100%;padding:15px;'
    +     'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;'
    +     'border:none;border-radius:14px;cursor:pointer;letter-spacing:1px">Sign In</button>'
    + '</div>';
  document.body.appendChild(sheet);

  document.getElementById('staff-login-pin').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') staffAttemptLogin();
  });
}

async function openStaffLoginSheet() {
  document.getElementById('staff-login-pin').value = '';
  document.getElementById('staff-login-error').textContent = '';
  document.getElementById('staff-login-overlay').style.display = 'block';
  document.getElementById('staff-login-sheet').style.display   = 'block';

  var sel = document.getElementById('staff-login-name');
  sel.innerHTML = '<option value="">Loading staff…</option>';
  try {
    var res = await db.from('store_staff').select('name').eq('active', true).order('name');
    var staff = res.data || [];
    sel.innerHTML = staff.length
      ? '<option value="">Select your name...</option>' + staff.map(function (s) {
          return '<option value="' + s.name.replace(/"/g, '&quot;') + '">' + s.name + '</option>';
        }).join('')
      : '<option value="">No staff added yet — ask admin</option>';
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load staff list</option>';
  }
}

function closeStaffLoginSheet() {
  document.getElementById('staff-login-overlay').style.display = 'none';
  document.getElementById('staff-login-sheet').style.display   = 'none';
}

async function staffAttemptLogin() {
  var name = document.getElementById('staff-login-name').value;
  var pin  = (document.getElementById('staff-login-pin').value || '').trim();
  var errEl = document.getElementById('staff-login-error');
  errEl.textContent = '';

  if (!name)  { errEl.textContent = 'Select your name'; return; }
  if (!pin)   { errEl.textContent = 'Enter your PIN'; return; }

  var submitBtn = document.getElementById('staff-login-btn-submit');
  submitBtn.disabled = true; submitBtn.textContent = 'Signing in…';

  try {
    var res = await db.rpc('rpc_staff_login', { p_name: name, p_pin: pin });
    var data = res.data, error = res.error;
    if (error || !data || !data.ok) {
      errEl.textContent = (data && data.error) || 'Login failed. Try again.';
      return;
    }
    _staffSession = { name: data.name, id: data.id };
    sessionStorage.setItem(STAFF_SESSION_KEY, JSON.stringify(_staffSession));
    closeStaffLoginSheet();
    showStaffLoggedInUI();
    if (typeof showStoreToast === 'function') showStoreToast('✅ Welcome, ' + _staffSession.name + '!');
  } catch (e) {
    errEl.textContent = 'Something went wrong. Try again.';
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Sign In';
  }
}

function staffLogout() {
  if (!confirm('Sign out of staff mode?')) return;
  sessionStorage.removeItem(STAFF_SESSION_KEY);
  _staffSession = null;
  document.getElementById('staff-login-btn').style.display   = 'flex';
  document.getElementById('staff-logged-badge').style.display = 'none';
  document.getElementById('staff-tables-fab').style.display   = 'none';
}

function restoreStaffSession() {
  var saved = sessionStorage.getItem(STAFF_SESSION_KEY);
  if (!saved) return;
  try {
    _staffSession = JSON.parse(saved);
    showStaffLoggedInUI();
  } catch (e) {}
}

function showStaffLoggedInUI() {
  document.getElementById('staff-login-btn').style.display = 'none';

  var badge = document.getElementById('staff-logged-badge');
  badge.innerHTML = '<span style="font-size:13px">👤</span>'
    + '<span style="font-size:11px;font-weight:700;color:#15803d">' + _staffSession.name + '</span>'
    + '<span style="font-size:10px;color:#9a8aaa">· Sign out</span>';
  badge.style.display = 'flex';

  document.getElementById('staff-tables-fab').style.display = 'flex';
}

// ══════════════════════════════════════════════════════════════
// PART 2 — Admin: Manage Staff (add / deactivate / delete)
// ══════════════════════════════════════════════════════════════

function injectManageStaffMenuEntry() {
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.onclick = function () { openManageStaff(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(110,9,119,0.1);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🧑‍🍳</div>'
    + '<div>'
    +   '<div style="font-size:13px;font-weight:600;color:#1a0820">Manage Staff</div>'
    +   '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Add or remove servers</div>'
    + '</div>';

  fabMenu.insertBefore(entry, fabMenu.children[2] || null);
}

function buildManageStaffUI() {
  var overlay = document.createElement('div');
  overlay.id = 'mstaff-overlay';
  overlay.onclick = closeManageStaff;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3300;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'mstaff-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3301;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:88vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:4px">Admin</div>'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Manage Staff</div>'
    +   '</div>'
    +   '<div onclick="closeManageStaff()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">'
    +   '<div style="display:flex;gap:8px">'
    +     '<input id="mstaff-name" placeholder="Staff name" style="flex:2;padding:12px 14px;'
    +       'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +       'font-size:13px;outline:none;box-sizing:border-box">'
    +     '<input id="mstaff-pin" placeholder="PIN" maxlength="6" style="flex:1;padding:12px 14px;'
    +       'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +       'font-size:13px;outline:none;box-sizing:border-box">'
    +   '</div>'
    +   '<button onclick="mstaffAdd()" style="width:100%;padding:13px;background:linear-gradient(135deg,'
    +     '#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;'
    +     'cursor:pointer">➕ Add Staff</button>'
    +   '<div id="mstaff-list" style="display:flex;flex-direction:column;gap:8px;margin-top:6px"></div>'
    + '</div>';
  document.body.appendChild(sheet);
}

function openManageStaff() {
  document.getElementById('mstaff-overlay').style.display = 'block';
  document.getElementById('mstaff-sheet').style.display   = 'block';
  mstaffLoadList();
}
function closeManageStaff() {
  document.getElementById('mstaff-overlay').style.display = 'none';
  document.getElementById('mstaff-sheet').style.display   = 'none';
}

async function mstaffLoadList() {
  var list = document.getElementById('mstaff-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';
  var res = await db.from('store_staff').select('*').order('created_at', { ascending: false });
  var staff = res.data || [];
  if (!staff.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">No staff added yet</div>';
    return;
  }
  list.innerHTML = staff.map(function (s) {
    var pillBg = s.active ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.08)';
    var pillColor = s.active ? '#15803d' : '#c24545';
    var pillLabel = s.active ? 'Active' : 'Inactive';
    return '<div style="display:flex;align-items:center;justify-content:space-between;'
      + 'background:#f5eeff;border:1px solid #e0c8f0;border-radius:12px;padding:12px 14px">'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:700;color:#1a0820">' + s.name + '</div>'
      + '<div style="font-size:11px;color:#9c0ca1;margin-top:2px">PIN: ' + s.pin + '</div>'
      + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px">'
      + '<div onclick="mstaffToggle(\'' + s.id + '\',' + s.active + ')" style="font-size:10px;font-weight:700;'
      + 'padding:4px 10px;border-radius:20px;background:' + pillBg + ';color:' + pillColor + ';cursor:pointer">'
      + pillLabel + '</div>'
      + '<div onclick="mstaffDelete(\'' + s.id + '\')" style="width:28px;height:28px;border-radius:50%;'
      + 'background:rgba(220,38,38,0.08);display:flex;align-items:center;justify-content:center;'
      + 'cursor:pointer;font-size:13px">🗑</div>'
      + '</div></div>';
  }).join('');
}

async function mstaffAdd() {
  var name = (document.getElementById('mstaff-name').value || '').trim();
  var pin  = (document.getElementById('mstaff-pin').value  || '').trim();
  if (!name) { showStoreToast('Enter a staff name'); return; }
  if (!pin)  { showStoreToast('Enter a PIN'); return; }

  var res = await db.from('store_staff').insert([{ name: name, pin: pin, active: true }]);
  if (res.error) { showStoreToast('Error: ' + res.error.message); return; }

  document.getElementById('mstaff-name').value = '';
  document.getElementById('mstaff-pin').value  = '';
  showStoreToast('✅ ' + name + ' added');
  mstaffLoadList();
}

async function mstaffToggle(id, current) {
  await db.from('store_staff').update({ active: !current }).eq('id', id);
  mstaffLoadList();
}

async function mstaffDelete(id) {
  if (!confirm('Remove this staff member? They will no longer be able to sign in.')) return;
  await db.from('store_staff').delete().eq('id', id);
  showStoreToast('Staff removed');
  mstaffLoadList();
}

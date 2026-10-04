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

function _soInit() {
  buildStaffLoginUI();
  buildManageStaffUI();
  injectManageStaffMenuEntry();
  restoreStaffSession();
  refreshStaffButtonVisibility();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _soInit); } else { _soInit(); }

// The Staff Login button is only shown to customers whose own account
// (customers.is_employee) has been flagged by an admin. A regular
// customer, or someone not logged in at all, never sees this button.
// This is checked against the SAME Supabase auth session used elsewhere
// in the app (db.auth.getUser()) — separate from the store_staff PIN
// login, which is the second, actual sign-in step once this button is
// visible and tapped.
async function checkEmployeeAccess() {
  try {
    // getSession() reads from local storage — no network round-trip.
    // getUser() always calls out to the Auth server to revalidate the
    // token, which is unnecessary here and adds latency for EVERY
    // visitor on EVERY page load, most of whom aren't even logged in.
    var s = await db.auth.getSession();
    var user = s.data && s.data.session ? s.data.session.user : null;
    if (!user) return false;
    var res = await db.from('customers').select('is_employee').eq('email', user.email).single();
    return !!(res.data && res.data.is_employee);
  } catch (e) {
    return false;
  }
}

// Re-evaluates whether the login button should show. Skips the check
// entirely if a staff PIN session is already active (that badge/UI takes
// over instead — see restoreStaffSession/showStaffLoggedInUI).
async function refreshStaffButtonVisibility() {
  if (_staffSession) return; // already logged in via PIN — button stays hidden regardless

  // `db` (the Supabase client) is created in store.html's own script
  // inside a window 'load' event, which fires AFTER our DOMContentLoaded
  // handler runs. Without this wait, db is still null the first time we
  // get here, db.auth.getUser() throws, and the button silently never
  // shows — even though the underlying is_employee data is correct.
  var waited = 0;
  while ((typeof db === 'undefined' || !db) && waited < 5000) {
    await new Promise(function (r) { setTimeout(r, 200); });
    waited += 200;
  }

  var allowed = await checkEmployeeAccess();
  var btn = document.getElementById('staff-login-btn');
  if (btn) btn.style.display = allowed ? 'flex' : 'none';
}

// ══════════════════════════════════════════════════════════════
// PART 1 — Staff login (for employees taking table orders)
// ══════════════════════════════════════════════════════════════

function buildStaffLoginUI() {
  var loginBtn = document.createElement('div');
  loginBtn.id = 'staff-login-btn';
  loginBtn.onclick = openStaffLoginSheet;
  loginBtn.style.cssText = 'display:none;position:fixed;bottom:24px;left:14px;z-index:400;'
    + 'background:#fff;border:1px solid rgba(18,10,30,0.12);border-radius:22px;'
    + 'padding:8px 14px;align-items:center;gap:6px;cursor:pointer;'
    + 'box-shadow:0 4px 16px rgba(18,10,30,0.12);font-family:\'Instrument Sans\',sans-serif';
  loginBtn.innerHTML = '<span style="font-size:14px">👤</span>'
    + '<span style="font-size:11px;font-weight:700;color:#6e0977;letter-spacing:.3px">Staff Login</span>';
  document.body.appendChild(loginBtn);
  // Starts hidden — refreshStaffButtonVisibility() decides whether to show
  // it, based on the logged-in customer's is_employee flag.

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
  tablesFab.onclick = function () {
    // Staff open Tables first thing — make sure they've clocked in before taking orders.
    ensureClockedIn('tables', function () { if (typeof openTablesBoard === 'function') openTablesBoard(); });
  };
  // Sits higher than the admin-only kitchen-fab (bottom:24px) as a safety
  // net — the two shouldn't both be visible at once (see showStaffLoggedInUI),
  // but this keeps them from visually overlapping even if that check races.
  tablesFab.style.cssText = 'display:none;position:fixed;bottom:88px;right:20px;z-index:400;'
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
    var res = await db.from('store_staff').select('name').eq('active', true)
      .in('role', ['Admin', 'Employee']).order('name');
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
    refreshStaffShift(true);
  } catch (e) {
    errEl.textContent = 'Something went wrong. Try again.';
  } finally {
    submitBtn.disabled = false; submitBtn.textContent = 'Sign In';
  }
}

async function staffLogout() {
  if (!confirm('Sign out of staff mode?')) return;
  if (_staffShift && confirm('Also clock out for today, ' + _staffSession.name + '?')) await staffClockOut();
  _staffShift = null;
  sessionStorage.removeItem(STAFF_SESSION_KEY);
  _staffSession = null;
  document.getElementById('staff-logged-badge').style.display = 'none';
  document.getElementById('staff-tables-fab').style.display   = 'none';
  await refreshStaffButtonVisibility();
}

function restoreStaffSession() {
  var saved = sessionStorage.getItem(STAFF_SESSION_KEY);
  if (!saved) return;
  try {
    _staffSession = JSON.parse(saved);
    showStaffLoggedInUI();
    refreshStaffShift(true);
  } catch (e) {}
}

function showStaffLoggedInUI() {
  document.getElementById('staff-login-btn').style.display = 'none';

  var badge = document.getElementById('staff-logged-badge');
  renderStaffBadge();
  badge.style.display = 'flex';

  // If this device is ALSO an admin session, the admin's own kitchen-fab
  // (🍳) sits at the exact same spot as our Tables fab (🍽️), and admins
  // already reach Tables via the Admin FAB menu — so skip showing a
  // second, redundant button here instead of stacking on top of it.
  // checkAdminBadge() in store.html resolves asynchronously, so poll
  // briefly rather than assuming it's settled by the time we get here.
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    var kFab = document.getElementById('kitchen-fab');
    var adminVisible = kFab && kFab.style.display === 'flex';
    if (adminVisible) {
      document.getElementById('staff-tables-fab').style.display = 'none';
      clearInterval(poll);
      return;
    }
    if (attempts >= 1) {
      // Not an admin session (or admin check hasn't granted access) —
      // safe to show our own Tables fab.
      document.getElementById('staff-tables-fab').style.display = 'flex';
    }
    if (attempts >= 10) clearInterval(poll); // give up polling after ~3s
  }, 300);
}

function renderStaffBadge() {
  var badge = document.getElementById('staff-logged-badge');
  if (!badge || !_staffSession) return;
  // Shift chip has its own tap target: clock in if not on shift. Rest of the badge = sign out.
  var shift = _staffShift === undefined ? ''
    : _staffShift
      ? '<span style="font-size:10px;font-weight:700;color:#15803d;background:rgba(34,197,94,0.12);border-radius:10px;padding:2px 7px">🟢 On shift</span>'
      : '<span onclick="event.stopPropagation();openShiftSheet(\'badge\')" style="font-size:10px;font-weight:700;color:#b91c1c;background:rgba(239,68,68,0.12);border-radius:10px;padding:2px 7px">🔴 Clock in</span>';
  badge.innerHTML = '<span style="font-size:13px">👤</span>'
    + '<span style="font-size:11px;font-weight:700;color:#15803d">' + _staffSession.name + '</span>'
    + shift
    + '<span style="font-size:10px;color:#9a8aaa">· Sign out</span>';
  badge.style.borderColor = _staffShift === null ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.3)';
}

// ══════════════════════════════════════════════════════════════
// PART 1b — Attendance: clock in from the order app
// Staff open this app to take orders and forget the separate attendance
// page. Same store_staff name + staff_attendance table as attendance.html,
// so clocking in here shows up there (and in payroll) exactly the same.
// ══════════════════════════════════════════════════════════════

var _staffShift;          // undefined = not checked yet, null = not clocked in, row = on shift
var _shiftAfter = null;   // what to do after the sheet closes (e.g. open Tables)

// Same date convention as attendance.html so both pages see the same rows.
function shiftToday() { return new Date().toISOString().slice(0, 10); }
function shiftSkipKey() { return 'cc_shift_skip_' + (_staffSession ? _staffSession.name : '') + '_' + shiftToday(); }
function shiftSkipped() { try { return localStorage.getItem(shiftSkipKey()) === '1'; } catch (e) { return false; } }

async function refreshStaffShift(promptIfOut) {
  if (!_staffSession) return;
  try {
    var res = await db.from('staff_attendance').select('*')
      .eq('staff_name', _staffSession.name).eq('work_date', shiftToday()).is('clock_out', null)
      .order('clock_in', { ascending: false }).limit(1);
    if (res.error) throw res.error;
    _staffShift = (res.data && res.data[0]) || null;
  } catch (e) {
    console.warn('shift status:', e.message);
    _staffShift = undefined; // unknown — never nag on a failed check
  }
  renderStaffBadge();
  if (promptIfOut && _staffShift === null && !shiftSkipped()) openShiftSheet('login');
}

// Runs `then` right away if on shift (or the person said they're not working
// today); otherwise asks them to clock in first.
function ensureClockedIn(reason, then) {
  if (!_staffSession || _staffShift || _staffShift === undefined || shiftSkipped()) { then(); return; }
  _shiftAfter = then;
  openShiftSheet(reason);
}

function buildShiftSheet() {
  if (document.getElementById('shift-sheet')) return;
  var overlay = document.createElement('div');
  overlay.id = 'shift-overlay';
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:3500;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);
  var sheet = document.createElement('div');
  sheet.id = 'shift-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3501;'
    + 'padding:22px 20px 28px;font-family:\'DM Sans\',sans-serif;text-align:center';
  sheet.innerHTML =
      '<div style="font-size:40px;margin-bottom:6px">⏰</div>'
    + '<div id="shift-title" style="font-size:19px;font-weight:700;color:#1a0820"></div>'
    + '<div id="shift-sub" style="font-size:13px;color:#7a6a8a;margin:6px 0 18px"></div>'
    + '<button id="shift-in-btn" onclick="staffClockIn()" style="width:100%;padding:16px;border:0;border-radius:16px;'
    +   'background:linear-gradient(135deg,#22c55e,#15803d);color:#fff;font-size:16px;font-weight:700;cursor:pointer;'
    +   'box-shadow:0 8px 22px rgba(21,128,61,0.3)">🟢 Clock in now</button>'
    + '<div onclick="skipShiftToday()" style="margin-top:14px;font-size:12px;color:#9a8aaa;cursor:pointer;text-decoration:underline">'
    +   'I\'m not working a shift today</div>';
  document.body.appendChild(sheet);
}

function openShiftSheet(reason) {
  if (!_staffSession) return;
  buildShiftSheet();
  var now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('shift-title').textContent = 'Hi ' + _staffSession.name + ', you haven\'t clocked in today';
  document.getElementById('shift-sub').textContent = reason === 'tables'
    ? 'Clock in before taking orders so your hours count. It\'s ' + now + '.'
    : 'Tap below to start your shift — it\'s ' + now + '.';
  var btn = document.getElementById('shift-in-btn');
  btn.disabled = false; btn.textContent = '🟢 Clock in now';
  document.getElementById('shift-overlay').style.display = 'block';
  document.getElementById('shift-sheet').style.display = 'block';
}

function closeShiftSheet() {
  var o = document.getElementById('shift-overlay'), s = document.getElementById('shift-sheet');
  if (o) o.style.display = 'none';
  if (s) s.style.display = 'none';
  var then = _shiftAfter; _shiftAfter = null;
  if (then) then();
}

async function staffClockIn() {
  var btn = document.getElementById('shift-in-btn');
  btn.disabled = true; btn.textContent = 'Clocking in…';
  try {
    // Re-check first so a double tap or a clock-in from attendance.html can't create a second open row.
    await refreshStaffShift(false);
    if (!_staffShift) {
      var res = await db.from('staff_attendance').insert([{ staff_name: _staffSession.name, work_date: shiftToday() }]).select('*').single();
      if (res.error) throw res.error;
      _staffShift = res.data;
    }
    renderStaffBadge();
    if (typeof showStoreToast === 'function') showStoreToast('🟢 Clocked in — have a great shift, ' + _staffSession.name + '!');
    closeShiftSheet();
  } catch (e) {
    btn.disabled = false; btn.textContent = '🟢 Clock in now';
    if (typeof showStoreToast === 'function') showStoreToast('Could not clock in: ' + e.message);
  }
}

function skipShiftToday() {
  try { localStorage.setItem(shiftSkipKey(), '1'); } catch (e) {}
  closeShiftSheet();
}

async function staffClockOut() {
  if (!_staffShift) return;
  try {
    var res = await db.from('staff_attendance').update({ clock_out: new Date().toISOString() }).eq('id', _staffShift.id);
    if (res.error) throw res.error;
    if (typeof showStoreToast === 'function') showStoreToast('🔴 Clocked out — see you next time!');
  } catch (e) {
    if (typeof showStoreToast === 'function') showStoreToast('Could not clock out: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// PART 2 — Admin: Manage Staff (add / deactivate / delete)
// ══════════════════════════════════════════════════════════════

function injectManageStaffMenuEntry() {
  registerAdminTool('Staff & HR', {
    icon: '🧑‍🍳', iconBg: 'rgba(21,128,61,0.12)',
    title: 'Manage Staff', subtitle: 'Add or remove servers',
    onClick: openManageStaff
  });
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
    +     '<select id="mstaff-role" style="flex:1;padding:12px 10px;border-radius:12px;'
    +       'border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:13px;'
    +       'outline:none;box-sizing:border-box;background:#fff;cursor:pointer">'
    +       '<option value="Employee">Employee</option>'
    +       '<option value="Admin">Admin</option>'
    +     '</select>'
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
    var roleBg = s.role === 'Admin' ? 'rgba(110,9,119,0.1)' : 'rgba(184,116,16,0.1)';
    var roleColor = s.role === 'Admin' ? '#6e0977' : '#b87410';
    return '<div style="display:flex;align-items:center;justify-content:space-between;'
      + 'background:#f5eeff;border:1px solid #e0c8f0;border-radius:12px;padding:12px 14px">'
      + '<div style="flex:1">'
      + '<div style="display:flex;align-items:center;gap:6px">'
      + '<div style="font-size:13px;font-weight:700;color:#1a0820">' + s.name + '</div>'
      + '<div style="font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px;'
      + 'background:' + roleBg + ';color:' + roleColor + '">' + (s.role || 'Employee') + '</div>'
      + '</div>'
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
  var role = document.getElementById('mstaff-role').value || 'Employee';
  if (!name) { showStoreToast('Enter a staff name'); return; }
  if (!pin)  { showStoreToast('Enter a PIN'); return; }

  var res = await db.from('store_staff').insert([{ name: name, pin: pin, role: role, active: true }]);
  if (res.error) { showStoreToast('Error: ' + res.error.message); return; }

  document.getElementById('mstaff-name').value = '';
  document.getElementById('mstaff-pin').value  = '';
  document.getElementById('mstaff-role').value = 'Employee';
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

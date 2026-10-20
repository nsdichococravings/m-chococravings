/**
 * checkadminbadge-override.js — ChocoCravings On Store
 * Overrides the original checkAdminBadge() (defined inline in
 * store.html) with a version that also lazy-loads the 11 admin/staff
 * patch files — only after confirming who's actually looking at the
 * page, instead of shipping them to every visitor unconditionally.
 * Also registers the three tools that used to be hardcoded static HTML
 * (Place Order, Add Menu Item, Store Open/Closed toggle) through the
 * new Command Center instead.
 *
 * Must load AFTER the main inline <script> block in store.html (so
 * `isAdmin`, `db` etc. already exist) and AFTER admin-command-center.js
 * (for `registerAdminTool`), and BEFORE the window 'load' event fires
 * (any static <script> tag satisfies this automatically). Load order:
 *   <script src="admin-command-center.js"></script>
 *   <script src="store-patch.js"></script>
 *   <script src="menu-search-patch.js"></script>
 *   <script src="remember-phone-patch.js"></script>
 *   <script src="checkadminbadge-override.js"></script>
 */

var _adminCheckGeneration=0, _adminAuthListener=null, _adminToolsRegistered=false;
// Who the last successful check was for, and the pending retry after a
// failed check (for example a dropped connection).
var _adminCheckedUserId=null, _adminRetryTimer=null, _adminRetryCount=0;
function resetAdminVisibility() {
  isAdmin=false;
  if(typeof ccSetAccess==='function') ccSetAccess(false);
  ['admin-quick-actions','kitchen-fab','print-invoice-btn','admin-fab-pill','admin-fab-menu','admin-fab-backdrop'].forEach(function(id){var el=document.getElementById(id);if(el)el.style.display='none';});
}
// The last confirmed staff role is saved on the phone, so the Command
// Center and staff tools appear (and start loading) the moment the page
// opens instead of after two server round trips. The server check still
// runs every time and removes access if the role has changed. This only
// controls what is shown; the database decides what each user may do.
var STAFF_ROLE_CACHE_KEY='cc_staff_role_v1';
function readStaffRoleCache(uid){
  try { var c=JSON.parse(localStorage.getItem(STAFF_ROLE_CACHE_KEY)); if(c && uid && c.uid===uid) return c; } catch(e) {}
  return null;
}
function saveStaffRoleCache(uid, admin, employee){
  try {
    if(admin || employee) localStorage.setItem(STAFF_ROLE_CACHE_KEY, JSON.stringify({uid:uid, admin:!!admin, employee:!!employee}));
    else localStorage.removeItem(STAFF_ROLE_CACHE_KEY);
  } catch(e) {}
}
function clearStaffRoleCache(){ try { localStorage.removeItem(STAFF_ROLE_CACHE_KEY); } catch(e) {} }

async function checkAdminBadge(){
  var generation=++_adminCheckGeneration;
  resetAdminVisibility();
  var shown=null; // role shown from the saved copy, if any
  try {
    if(!db) return;

    if(!_adminAuthListener && db.auth.onAuthStateChange) {
      _adminAuthListener=db.auth.onAuthStateChange(function(event, session) {
        if(event==='SIGNED_OUT') {
          ++_adminCheckGeneration; _adminCheckedUserId=null; clearAdminRetry(); clearStaffRoleCache(); resetAdminVisibility();
          return;
        }
        // A token refresh (about once an hour, and whenever the phone wakes
        // up) is the same person. Hiding the tools and asking the server
        // again each time made staff tools disappear on a slow connection.
        if(event==='TOKEN_REFRESHED') return;
        if(event==='SIGNED_IN' || event==='USER_UPDATED') {
          var uid=session && session.user && session.user.id;
          if(uid && uid===_adminCheckedUserId) return;
          ++_adminCheckGeneration; resetAdminVisibility();
          setTimeout(function(){checkAdminBadge();},0);
        }
      });
    }

    // Saved role first: getSession reads the login stored on this phone.
    if(typeof db.auth.getSession==='function') {
      var ss = await db.auth.getSession();
      if(generation!==_adminCheckGeneration) return;
      var su = ss && ss.data && ss.data.session && ss.data.session.user;
      var saved = su && readStaffRoleCache(su.id);
      if(saved) { shown={uid:su.id, admin:saved.admin, employee:saved.employee}; applyStaffRole(saved.admin, saved.employee); }
    }

    // Then confirm with the server. Shares one request with other startup
    // checks on this page instead of asking the login server three times.
    var s = await (typeof getStoreVerifiedUser==='function' ? getStoreVerifiedUser() : db.auth.getUser());
    if(generation!==_adminCheckGeneration) return;
    if(s.error) throw s.error;
    var user = s.data && s.data.user;
    if(!user) { _adminCheckedUserId=null; clearAdminRetry(); clearStaffRoleCache(); if(shown) resetAdminVisibility(); return; }

    // Both flags in one query — avoids a second DB round-trip.
    var chk = await db.from('customers').select('is_admin, is_employee').eq('email', user.email).single();
    if(generation!==_adminCheckGeneration) return;
    if(chk.error) throw chk.error;
    var admin = !!(chk.data && chk.data.is_admin);
    var employee = !!(chk.data && chk.data.is_employee);
    _adminCheckedUserId = user.id;
    clearAdminRetry();
    saveStaffRoleCache(user.id, admin, employee);

    var same = shown && shown.uid===user.id && shown.admin===admin && shown.employee===employee;
    if(!same) {
      if(shown) resetAdminVisibility();
      applyStaffRole(admin, employee);
    }
    if (typeof initializeProductionAccess === 'function') {
      initializeProductionAccess().catch(function (error) { console.warn('Production access:', error.message); });
    }
  } catch(e){
    console.warn('checkAdminBadge error:', e.message);
    // Usually a dropped or slow connection. Tools shown from the saved role
    // stay; try again shortly instead of waiting for a page reload.
    scheduleAdminRetry(generation);
  }
}

function applyStaffRole(admin, employee) {
  if (admin) {
    isAdmin = true;
    if(typeof ccSetAccess==='function') ccSetAccess(true);

    // Show admin-only UI elements
    var adminActions = document.getElementById('admin-quick-actions');
    if (adminActions) adminActions.style.display = 'flex';

    var fab = document.getElementById('kitchen-fab');
    if (fab) fab.style.display = 'flex';

    var pb = document.getElementById('print-invoice-btn');
    if (pb) pb.style.display = 'block';

    // These three were previously hardcoded static HTML inside the old
    // #admin-fab-menu dropdown — now registered through the Command
    // Center like every other tool, instead of living as separate markup.
    if (!_adminToolsRegistered && typeof registerAdminTool === 'function') {
      _adminToolsRegistered=true;
      registerAdminTool('Daily Operations', {
        icon: '👤', iconBg: 'rgba(110,9,119,0.1)',
        title: 'Place Order', subtitle: 'On behalf of customer',
        onClick: function () { if (typeof openAdminOrder === 'function') openAdminOrder(); }
      });
      registerAdminTool('Daily Operations', {
        icon: '➕', iconBg: 'rgba(110,9,119,0.1)',
        title: 'Add Menu Item', subtitle: 'Instant menu update',
        onClick: function () { if (typeof openQaItem === 'function') openQaItem(); }
      });
      registerAdminTool('Daily Operations', {
        icon: function () { return _storeIsOpen ? '🟢' : '🔴'; },
        iconBg: function () { return _storeIsOpen ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'; },
        title: function () { return _storeIsOpen ? 'Store is Open' : 'Store is Closed'; },
        subtitle: function () { return _storeIsOpen ? 'Tap to close store' : 'Tap to open store'; },
        keepOpen: true,
        onClick: function () { if (typeof toggleStoreOpenStatus === 'function') toggleStoreOpenStatus(); }
      });
    }
  }

  // Lazy-load admin/staff-only scripts — regular customers browsing the
  // menu never download or execute any of this. Table Service + Staff
  // Login are needed by BOTH admins and regular employees (is_employee
  // flag, for staff PIN login to the Tables board) — everything else
  // is admin-only.
  if (admin || employee) {
    loadScriptsSequentially(['table-service-patch.js?v=20260952-seat-paid', 'staff-order-patch.js?v=20260952-clock-in', 'birthday-report-patch.js?v=20260946-offer-code', 'ratings-report-patch.js?v=20260948']);
  }
  if (admin) {
    loadScriptsSequentially([
      'inventory-patch.js?v=20260960', 'display-stock-patch.js?v=20260966', 'daily-expenses-patch.js',
      'day-close-patch.js', 'sales-reports-patch.js?v=20260968', 'reports-hub-patch.js?v=20261020-owner-close', 'daily-summary-patch.js?v=20260968', 'customer-returns-patch.js?v=20260970',
      'cash-counter-patch.js', 'custom-bookings-patch.js?v=20260956-kitchen', 'executive-dashboard-patch.js',
      'push-broadcast-patch.js?v=20260974'
    ]);
  }
}

function clearAdminRetry() {
  if (_adminRetryTimer) { clearTimeout(_adminRetryTimer); _adminRetryTimer=null; }
  _adminRetryCount=0;
}

function scheduleAdminRetry(generation) {
  if (_adminRetryTimer || _adminRetryCount >= 5) return;
  var delay = 3000 * Math.pow(2, _adminRetryCount++); // 3s, 6s, 12s, 24s, 48s
  _adminRetryTimer = setTimeout(function () {
    _adminRetryTimer = null;
    if (generation === _adminCheckGeneration) checkAdminBadge();
  }, delay);
}

// Coming back online, or back to the app, retries a failed check at once.
function retryAdminCheckNow() {
  if (!_adminRetryTimer) return;
  clearTimeout(_adminRetryTimer); _adminRetryTimer=null;
  checkAdminBadge();
}
if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', retryAdminCheckNow);
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', function () { if (!document.hidden) retryAdminCheckNow(); });
}

// Loads scripts one at a time, in order — async=false forces each to
// finish executing before the next one starts, same guarantee normal
// parser-inserted <script> tags give you, just triggered later.
function loadScriptsSequentially(srcList) {
  srcList.forEach(function (src) {
    if(Array.prototype.some.call(document.scripts,function(el){return el.getAttribute('src')===src;})) return;
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.body.appendChild(s);
  });
}

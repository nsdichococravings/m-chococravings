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

async function checkAdminBadge(){
  try {
    if(!db) return;

    var s = await db.auth.getUser(); var user = s.data.user;
    if(!user) return;

    // Both flags in one query — avoids a second DB round-trip.
    var chk = await db.from('customers').select('is_admin, is_employee').eq('email', user.email).single();
    var admin = !!(chk.data && chk.data.is_admin);
    var employee = !!(chk.data && chk.data.is_employee);

    if (admin) {
      isAdmin = true;

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
      if (typeof registerAdminTool === 'function') {
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
      loadScriptsSequentially(['table-service-patch.js', 'staff-order-patch.js']);
    }
    if (admin) {
      loadScriptsSequentially([
        'inventory-patch.js', 'display-stock-patch.js', 'daily-expenses-patch.js',
        'day-close-patch.js', 'sales-reports-patch.js', 'reports-hub-patch.js',
        'cash-counter-patch.js', 'custom-bookings-patch.js', 'executive-dashboard-patch.js'
      ]);
    }
  } catch(e){ console.warn('checkAdminBadge error:', e.message); }
}

// Loads scripts one at a time, in order — async=false forces each to
// finish executing before the next one starts, same guarantee normal
// parser-inserted <script> tags give you, just triggered later.
function loadScriptsSequentially(srcList) {
  srcList.forEach(function (src) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.body.appendChild(s);
  });
}

/**
 * checkadminbadge-override.js — ChocoCravings On Store
 * Overrides the original checkAdminBadge() (defined inline in
 * store.html) with a version that also lazy-loads the 11 admin/staff
 * patch files — only after confirming who's actually looking at the
 * page, instead of shipping them to every visitor unconditionally.
 *
 * Must load AFTER the main inline <script> block in store.html (so
 * `isAdmin`, `db` etc. already exist), and BEFORE the window 'load'
 * event fires (any static <script> tag satisfies this automatically).
 * Load it as one of the remaining static tags near </body>:
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

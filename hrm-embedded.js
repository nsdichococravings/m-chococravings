/* ============================================================================
   NSDI ChocoCravings — HRM EMBEDDED (for index.html)
   Adds a "My Workspace" entry to your existing hamburger menu. Tapping it
   slides up a full-screen sheet with the whole employee experience (login,
   attendance, leaves, benefits) — no separate URL, no bookmarking required.

   Same standalone-patch pattern as store-patch.js / hrm-admin-patch.js:
   one <script> tag before </body> in index.html, touches nothing else.
   ============================================================================ */

(function () {
  "use strict";

  const SUPABASE_URL = "https://yjbfditboewwpgyqzryd.supabase.co"; // confirm matches config.js
  const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYmZkaXRib2V3d3BneXF6cnlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTgwNjcsImV4cCI6MjA4ODczNDA2N30.08Tvq71w2DBeWZrZb-IaiKfoI-2P_1MPJygzSPiRq24";          // paste from config.js
  let sb;

  const SESSION_KEY = "cc_hrm_session";
  let session = null;

  // --------------------------------------------------------------------------
  // 1. Load hrm.css once (so the sheet matches the portal's own branding)
  // --------------------------------------------------------------------------
  function ensureCss() {
    if (document.getElementById("hrmEmbCss")) return;
    const link = document.createElement("link");
    link.id = "hrmEmbCss";
    link.rel = "stylesheet";
    link.href = "css/hrm.css";
    document.head.appendChild(link);
  }

  // --------------------------------------------------------------------------
  // 2. Inject a menu entry into your existing hamburger drawer
  //    Tries a few common drawer patterns; falls back to a floating tab
  //    pinned under the bell/menu icons if none match — so it's never
  //    invisible even before you point us at your exact markup.
  // --------------------------------------------------------------------------
  function injectMenuEntry() {
    const candidates = [
      ".nav-drawer", ".side-menu", ".drawer-menu", ".menu-items",
      "#sideMenu", "#navDrawer", ".hamburger-menu", ".mobile-menu",
    ];
    let container = null;
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) { container = el; break; }
    }

    const item = document.createElement("div");
    item.id = "hrmMenuEntry";
    item.innerHTML = `<i class="ti ti-users" style="margin-right:7px;font-size:13px;"></i>Staff login`;
    item.style.cssText = `
      display:flex;align-items:center;padding:10px 18px;cursor:pointer;
      font-family:'Instrument Sans',sans-serif;font-weight:500;font-size:12px;
      color:#a89aab;border-top:1px solid rgba(0,0,0,0.06);margin-top:6px;
    `;
    item.onmouseenter = () => (item.style.color = "#6e0977");
    item.onmouseleave = () => (item.style.color = "#a89aab");
    item.onclick = openSheet;

    if (container) {
      // Appended last so it reads as a quiet, tucked-away utility link
      // rather than a primary customer-facing menu option.
      container.appendChild(item);
    } else {
      // Fallback: small muted pill, always reachable regardless of your
      // drawer markup, but still visually de-emphasized vs. customer actions.
      item.style.position = "fixed";
      item.style.bottom = "22px";
      item.style.right = "18px";
      item.style.zIndex = "9998";
      item.style.background = "#fff";
      item.style.borderRadius = "20px";
      item.style.boxShadow = "0 4px 14px rgba(0,0,0,.15)";
      item.style.borderTop = "none";
      item.style.opacity = "0.85";
      document.body.appendChild(item);
    }
  }

  // --------------------------------------------------------------------------
  // 3. Build the full-screen sheet (same content as employee-portal.html,
  //    just embedded instead of a separate page)
  // --------------------------------------------------------------------------
  function buildSheet() {
    const sheet = document.createElement("div");
    sheet.id = "hrmSheet";
    sheet.style.cssText = `
      display:none;position:fixed;inset:0;z-index:99999;overflow-y:auto;
      background:linear-gradient(160deg,#fbf6f0 0%,#fff 55%,#f3d9e0 130%);
    `;
    sheet.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;padding:16px 18px;position:sticky;top:0;background:linear-gradient(135deg,#6e0977,#c2607a);z-index:2;">
        <i class="ti ti-arrow-left" id="hrmSheetClose" style="color:#fff;font-size:20px;cursor:pointer;"></i>
        <span style="color:#fff;font-weight:600;font-family:'Fraunces',serif;font-size:17px;">My workspace</span>
      </div>
      <div class="hrm-shell" style="padding-top:14px;">

        <div id="hrmEmbLoginView" class="login-wrap">
          <div class="cc-card">
            <h2>Welcome back</h2>
            <p class="tag">Sign in with your Employee ID and PIN</p>
            <input id="hrmEmbLoginCode" class="cc-input" placeholder="Employee ID (e.g. EMP001)" autocomplete="off" />
            <input id="hrmEmbLoginPin" class="cc-input" placeholder="4-digit PIN" type="password" inputmode="numeric" maxlength="6" />
            <button class="cc-btn" id="hrmEmbLoginBtn">Sign in</button>
            <div class="cc-error" id="hrmEmbLoginError"></div>
          </div>
        </div>

        <div id="hrmEmbDashView" style="display:none;">
          <div class="cc-card">
            <div class="profile-head">
              <div class="profile-avatar" id="hrmEmbAvatarInitial">E</div>
              <div><div class="name" id="hrmEmbEmpName">-</div><div class="role" id="hrmEmbEmpRole">-</div></div>
            </div>
            <div class="stat-grid">
              <div class="stat-box"><div class="num" id="hrmEmbStatPresent">0</div><div class="lbl">Days present</div></div>
              <div class="stat-box"><div class="num" id="hrmEmbStatHours">0</div><div class="lbl">Hrs this month</div></div>
              <div class="stat-box"><div class="num" id="hrmEmbStatLeaveLeft">0</div><div class="lbl">Leaves left</div></div>
            </div>
          </div>

          <div class="hrm-tabs">
            <div class="hrm-tab active" data-tab="overview">Overview</div>
            <div class="hrm-tab" data-tab="attendance">Attendance</div>
            <div class="hrm-tab" data-tab="leaves">Leaves</div>
            <div class="hrm-tab" data-tab="benefits">Benefits</div>
          </div>

          <div class="hrm-panel active" id="hrmEmb-panel-overview">
            <div class="cc-card"><h3>Today</h3><div id="hrmEmbTodayBlock" class="hrm-empty">Loading...</div></div>
            <div class="cc-card"><h3>Leave balance</h3><div class="leave-grid" id="hrmEmbLeaveGridOverview"></div></div>
          </div>

          <div class="hrm-panel" id="hrmEmb-panel-attendance">
            <div class="cc-card"><h3>This month's attendance</h3><div id="hrmEmbAttendanceList" class="hrm-empty">Loading...</div></div>
          </div>

          <div class="hrm-panel" id="hrmEmb-panel-leaves">
            <div class="cc-card">
              <h3>Apply for leave</h3>
              <select class="cc-select" id="hrmEmbLeaveType">
                <option value="casual">Casual leave</option>
                <option value="sick">Sick leave</option>
                <option value="paid">Paid leave</option>
                <option value="unpaid">Unpaid leave</option>
              </select>
              <div class="date-row">
                <input class="cc-input" type="date" id="hrmEmbLeaveStart" />
                <input class="cc-input" type="date" id="hrmEmbLeaveEnd" />
              </div>
              <input class="cc-input" id="hrmEmbLeaveReason" placeholder="Reason (optional)" />
              <button class="cc-btn" id="hrmEmbApplyLeaveBtn">Submit request</button>
              <div class="cc-error" id="hrmEmbLeaveError"></div>
              <div class="cc-success-msg" id="hrmEmbLeaveSuccess"></div>
            </div>
            <div class="cc-card"><h3>My leave history</h3><div id="hrmEmbLeaveHistoryList" class="hrm-empty">Loading...</div></div>
          </div>

          <div class="hrm-panel" id="hrmEmb-panel-benefits">
            <div class="cc-card"><h3>Salary, bonuses and perks</h3><div id="hrmEmbBenefitsList" class="hrm-empty">Loading...</div></div>
          </div>

          <button class="cc-btn ghost" id="hrmEmbLogoutBtn" style="margin-top:6px;">Sign out</button>
        </div>
      </div>
      <div class="hrm-toast" id="hrmEmbToast"></div>
    `;
    document.body.appendChild(sheet);
    document.getElementById("hrmSheetClose").onclick = closeSheet;
    wireLogic();
  }

  function openSheet() {
    document.getElementById("hrmSheet").style.display = "block";
    document.body.style.overflow = "hidden";
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) {
      session = JSON.parse(saved);
      document.getElementById("hrmEmbLoginView").style.display = "none";
      document.getElementById("hrmEmbDashView").style.display = "block";
      loadDashboard();
    }
  }
  function closeSheet() {
    document.getElementById("hrmSheet").style.display = "none";
    document.body.style.overflow = "";
  }

  // --------------------------------------------------------------------------
  // 4. Logic — identical behavior to hrm-employee.js, scoped to this sheet
  // --------------------------------------------------------------------------
  function showToast(msg) {
    const t = document.getElementById("hrmEmbToast");
    t.textContent = msg;
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2600);
  }
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "-"; }
  function fmtTime(t) { return t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "-"; }
  function money(n) { return "\u20B9" + Number(n || 0).toLocaleString("en-IN"); }

  async function attemptLogin() {
    const code = document.getElementById("hrmEmbLoginCode").value.trim().toUpperCase();
    const pin = document.getElementById("hrmEmbLoginPin").value.trim();
    const errEl = document.getElementById("hrmEmbLoginError");
    errEl.textContent = "";
    if (!code || !pin) { errEl.textContent = "Enter your Employee ID and PIN"; return; }

    const { data, error } = await sb.rpc("rpc_employee_login", { p_code: code, p_pin: pin });
    if (error || !data || !data.ok) { errEl.textContent = (data && data.error) || "Login failed"; return; }

    session = { code, pin };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    document.getElementById("hrmEmbLoginView").style.display = "none";
    document.getElementById("hrmEmbDashView").style.display = "block";
    loadDashboard();
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    session = null;
    document.getElementById("hrmEmbDashView").style.display = "none";
    document.getElementById("hrmEmbLoginView").style.display = "flex";
    document.getElementById("hrmEmbLoginPin").value = "";
  }

  async function loadDashboard() {
    const { data, error } = await sb.rpc("rpc_get_employee_dashboard", { p_code: session.code, p_pin: session.pin });
    if (error || !data || !data.ok) { showToast("Session expired, sign in again"); logout(); return; }

    const emp = data.employee;
    document.getElementById("hrmEmbEmpName").textContent = emp.full_name;
    const typeLabel = emp.employment_type === "part_time" ? "Part-time" : "Full-time";
    document.getElementById("hrmEmbEmpRole").textContent = `${emp.role_title || ""} - ${emp.department || ""} - ${typeLabel}`;
    document.getElementById("hrmEmbAvatarInitial").textContent = (emp.full_name || "E").charAt(0).toUpperCase();

    const today = data.today;
    document.getElementById("hrmEmbTodayBlock").innerHTML = today
      ? `<div class="row-item"><div class="left-col"><div class="primary">Clocked in ${fmtTime(today.clock_in)}</div><div class="secondary">${today.clock_out ? "Clocked out " + fmtTime(today.clock_out) : "Still on shift"}</div></div><span class="badge ${today.status}">${today.status}</span></div>`
      : `<div class="hrm-empty">No attendance yet today - scan the outlet QR when you arrive.</div>`;

    document.getElementById("hrmEmbStatPresent").textContent = (data.attendance_month && data.attendance_month.present) || 0;
    const hoursBox = document.getElementById("hrmEmbStatHours").parentElement;
    if (emp.employment_type === "part_time") {
      hoursBox.querySelector(".num").textContent = money(data.attendance_month.estimated_earnings || 0);
      hoursBox.querySelector(".lbl").textContent = "Est. pay (month)";
    } else {
      hoursBox.querySelector(".num").textContent = data.attendance_month ? Math.round(data.attendance_month.total_hours) : 0;
      hoursBox.querySelector(".lbl").textContent = "Hrs this month";
    }
    const bal = data.leave_balance;
    const left = bal ? (bal.casual_left + bal.sick_left + bal.paid_left) : 0;
    document.getElementById("hrmEmbStatLeaveLeft").textContent = left;

    const noQuota = bal && bal.casual_total === 0 && bal.sick_total === 0 && bal.paid_total === 0;
    document.getElementById("hrmEmbLeaveGridOverview").innerHTML = (emp.employment_type === "part_time" && noQuota)
      ? `<div class="hrm-empty" style="grid-column:1/-1;">Part-time roles don't carry a paid-leave quota. You can still apply for unpaid leave.</div>`
      : `<div class="leave-pill"><div class="left">${bal ? bal.casual_left : 0}</div><div class="of">of ${bal ? bal.casual_total : 0}</div><div class="type">Casual</div></div>
         <div class="leave-pill"><div class="left">${bal ? bal.sick_left : 0}</div><div class="of">of ${bal ? bal.sick_total : 0}</div><div class="type">Sick</div></div>
         <div class="leave-pill"><div class="left">${bal ? bal.paid_left : 0}</div><div class="of">of ${bal ? bal.paid_total : 0}</div><div class="type">Paid</div></div>`;

    const log = data.attendance_log;
    document.getElementById("hrmEmbAttendanceList").innerHTML = (!log || !log.length)
      ? `<div class="hrm-empty">No attendance logged this month yet.</div>`
      : log.map(r => `<div class="row-item"><div class="left-col"><div class="primary">${fmtDate(r.work_date)}</div><div class="secondary">${fmtTime(r.clock_in)} to ${fmtTime(r.clock_out)} ${r.worked_hours ? "- " + r.worked_hours + "h" : ""}</div></div><span class="badge ${r.status}">${r.status}</span></div>`).join("");

    const hist = data.leave_history;
    document.getElementById("hrmEmbLeaveHistoryList").innerHTML = (!hist || !hist.length)
      ? `<div class="hrm-empty">No leave requests yet.</div>`
      : hist.map(l => `<div class="row-item"><div class="left-col"><div class="primary">${l.leave_type.charAt(0).toUpperCase() + l.leave_type.slice(1)} - ${l.total_days}d</div><div class="secondary">${fmtDate(l.start_date)} to ${fmtDate(l.end_date)}</div></div><span class="badge ${l.status}">${l.status}</span></div>`).join("");

    const ben = data.benefits;
    document.getElementById("hrmEmbBenefitsList").innerHTML = (!ben || !ben.length)
      ? `<div class="hrm-empty">No benefit records yet.</div>`
      : ben.map(b => `<div class="row-item"><div class="left-col"><div class="primary">${b.title}</div><div class="secondary">${b.period || ""}</div></div><div class="right-col"><div class="amount">${money(b.amount)}</div><span class="badge ${b.status}">${b.status}</span></div></div>`).join("");
  }

  async function submitLeave() {
    const type = document.getElementById("hrmEmbLeaveType").value;
    const start = document.getElementById("hrmEmbLeaveStart").value;
    const end = document.getElementById("hrmEmbLeaveEnd").value;
    const reason = document.getElementById("hrmEmbLeaveReason").value.trim();
    const errEl = document.getElementById("hrmEmbLeaveError");
    const okEl = document.getElementById("hrmEmbLeaveSuccess");
    errEl.textContent = ""; okEl.textContent = "";
    if (!start || !end) { errEl.textContent = "Choose start and end dates"; return; }

    const { data, error } = await sb.rpc("rpc_apply_leave", {
      p_code: session.code, p_pin: session.pin, p_leave_type: type, p_start: start, p_end: end, p_reason: reason,
    });
    if (error || !data || !data.ok) { errEl.textContent = (data && data.error) || "Could not submit"; return; }
    okEl.textContent = "Leave request submitted";
    showToast("Leave request submitted");
    document.getElementById("hrmEmbLeaveReason").value = "";
    loadDashboard();
  }

  function wireLogic() {
    document.querySelectorAll(".hrm-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".hrm-tab").forEach(t => t.classList.remove("active"));
        document.querySelectorAll(".hrm-panel").forEach(p => p.classList.remove("active"));
        tab.classList.add("active");
        document.getElementById("hrmEmb-panel-" + tab.dataset.tab).classList.add("active");
      });
    });
    document.getElementById("hrmEmbLoginBtn").addEventListener("click", attemptLogin);
    document.getElementById("hrmEmbLoginPin").addEventListener("keydown", e => { if (e.key === "Enter") attemptLogin(); });
    document.getElementById("hrmEmbLogoutBtn").addEventListener("click", logout);
    document.getElementById("hrmEmbApplyLeaveBtn").addEventListener("click", submitLeave);
  }

  // --------------------------------------------------------------------------
  // Init — reuse the app's existing Supabase client if we can find one;
  // otherwise load the SDK ourselves and create a fresh client, so this
  // never silently fails just because config.js wires things up differently
  // than expected.
  // --------------------------------------------------------------------------
  function loadSupabaseSdk(cb) {
    if (window.supabase && typeof window.supabase.createClient === "function") { cb(); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";
    s.onload = cb;
    document.head.appendChild(s);
  }

  function resolveClient() {
    // Case 1: window.supabase is already a ready client (has .rpc) — reuse it.
    if (window.supabase && typeof window.supabase.rpc === "function") {
      return window.supabase;
    }
    // Case 2: window.supabase is still the raw SDK namespace — make our own client.
    if (window.supabase && typeof window.supabase.createClient === "function") {
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return null;
  }

  function init(attemptsLeft) {
    attemptsLeft = attemptsLeft === undefined ? 10 : attemptsLeft;
    const existing = resolveClient();
    if (existing) {
      sb = existing;
      ensureCss();
      buildSheet();
      injectMenuEntry();
      return;
    }
    if (attemptsLeft > 0) {
      // Give config.js a little time to finish setting up window.supabase first.
      setTimeout(() => init(attemptsLeft - 1), 300);
      return;
    }
    // Gave it ~3 seconds — config.js clearly isn't exposing a client the way
    // we expect. Load the SDK ourselves and create a standalone client so
    // the feature still works instead of silently never appearing.
    loadSupabaseSdk(() => {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      ensureCss();
      buildSheet();
      injectMenuEntry();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => init());
  else init();
})();

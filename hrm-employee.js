/* ============================================================================
   NSDI ChocoCravings — Employee HRM Portal Logic
   Uses the same SUPABASE_URL / SUPABASE_ANON_KEY as the rest of the app
   (copy the values from your existing js/config.js).
   ============================================================================ */

const SUPABASE_URL = "https://yjbfditboewwpgyqzryd.supabase.co"; // <-- confirm this matches config.js
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYmZkaXRib2V3d3BneXF6cnlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTgwNjcsImV4cCI6MjA4ODczNDA2N30.08Tvq71w2DBeWZrZb-IaiKfoI-2P_1MPJygzSPiRq24";          // <-- paste from config.js

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const SESSION_KEY = "cc_hrm_session";
let session = null; // { code, pin } kept only in sessionStorage, re-verified server-side every call

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function fmtTime(t) {
  if (!t) return "—";
  return new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}
function money(n) {
  return "₹" + Number(n || 0).toLocaleString("en-IN");
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function attemptLogin() {
  const code = document.getElementById("loginCode").value.trim().toUpperCase();
  const pin = document.getElementById("loginPin").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.textContent = "";

  if (!code || !pin) {
    errEl.textContent = "Please enter your Employee ID and PIN";
    return;
  }

  const { data, error } = await sb.rpc("rpc_employee_login", { p_code: code, p_pin: pin });
  if (error || !data || !data.ok) {
    errEl.textContent = (data && data.error) || "Login failed. Please try again.";
    return;
  }

  session = { code, pin };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  document.getElementById("loginView").style.display = "none";
  document.getElementById("dashView").style.display = "block";
  loadDashboard();
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  session = null;
  document.getElementById("dashView").style.display = "none";
  document.getElementById("loginView").style.display = "flex";
  document.getElementById("loginPin").value = "";
}

// ---------------------------------------------------------------------------
// Dashboard load + render
// ---------------------------------------------------------------------------
async function loadDashboard() {
  const { data, error } = await sb.rpc("rpc_get_employee_dashboard", {
    p_code: session.code,
    p_pin: session.pin,
  });

  if (error || !data || !data.ok) {
    showToast("Session expired, please sign in again");
    logout();
    return;
  }

  renderProfile(data.employee);
  renderToday(data.today);
  renderStats(data.attendance_month, data.leave_balance, data.employee);
  renderLeaveGrid(data.leave_balance, data.employee);
  renderAttendanceList(data.attendance_log);
  renderLeaveHistory(data.leave_history);
  renderBenefits(data.benefits);
}

function renderProfile(emp) {
  document.getElementById("empName").textContent = emp.full_name;
  const typeLabel = emp.employment_type === "part_time" ? "Part-time" : "Full-time";
  document.getElementById("empRole").textContent = `${emp.role_title || ""} · ${emp.department || ""} · ${typeLabel}`;
  document.getElementById("avatarInitial").textContent = (emp.full_name || "E").charAt(0).toUpperCase();
}

function renderToday(today) {
  const el = document.getElementById("todayBlock");
  if (!today) {
    el.innerHTML = `<div class="hrm-empty">No attendance recorded yet today — scan the outlet QR when you arrive.</div>`;
    return;
  }
  el.innerHTML = `
    <div class="row-item">
      <div class="left-col">
        <div class="primary">Clocked in ${fmtTime(today.clock_in)}</div>
        <div class="secondary">${today.clock_out ? "Clocked out " + fmtTime(today.clock_out) : "Still on shift"}</div>
      </div>
      <span class="badge ${today.status}">${today.status}</span>
    </div>`;
}

function renderStats(monthAtt, leaveBal, emp) {
  const isPartTime = emp && emp.employment_type === "part_time";
  document.getElementById("statPresent").textContent = (monthAtt && monthAtt.present) || 0;

  const hoursBox = document.getElementById("statHours").parentElement;
  if (isPartTime && monthAtt) {
    hoursBox.querySelector(".num").textContent = money(monthAtt.estimated_earnings || 0);
    hoursBox.querySelector(".lbl").textContent = "Est. Pay (Month)";
  } else {
    hoursBox.querySelector(".num").textContent = monthAtt ? Math.round(monthAtt.total_hours) : 0;
    hoursBox.querySelector(".lbl").textContent = "Hrs This Month";
  }

  const left = leaveBal ? (leaveBal.casual_left + leaveBal.sick_left + leaveBal.paid_left) : 0;
  document.getElementById("statLeaveLeft").textContent = left;
}

function renderLeaveGrid(bal, emp) {
  const isPartTime = emp && emp.employment_type === "part_time";
  const noQuota = bal && bal.casual_total === 0 && bal.sick_total === 0 && bal.paid_total === 0;

  if (isPartTime && noQuota) {
    document.getElementById("leaveGridOverview").innerHTML = `
      <div class="hrm-empty" style="grid-column:1/-1;">
        Part-time roles don't carry a paid-leave quota — you can still apply
        for unpaid leave from the Leaves tab.
      </div>`;
    return;
  }
  const grid = `
    <div class="leave-pill"><div class="left">${bal ? bal.casual_left : 0}</div><div class="of">of ${bal ? bal.casual_total : 0}</div><div class="type">Casual</div></div>
    <div class="leave-pill"><div class="left">${bal ? bal.sick_left : 0}</div><div class="of">of ${bal ? bal.sick_total : 0}</div><div class="type">Sick</div></div>
    <div class="leave-pill"><div class="left">${bal ? bal.paid_left : 0}</div><div class="of">of ${bal ? bal.paid_total : 0}</div><div class="type">Paid</div></div>`;
  document.getElementById("leaveGridOverview").innerHTML = grid;
}

function renderAttendanceList(log) {
  const el = document.getElementById("attendanceList");
  if (!log || log.length === 0) {
    el.innerHTML = `<div class="hrm-empty">No attendance logged this month yet.</div>`;
    return;
  }
  el.innerHTML = log.map(r => `
    <div class="row-item">
      <div class="left-col">
        <div class="primary">${fmtDate(r.work_date)}</div>
        <div class="secondary">${fmtTime(r.clock_in)} → ${fmtTime(r.clock_out)} ${r.worked_hours ? "· " + r.worked_hours + "h" : ""}</div>
      </div>
      <span class="badge ${r.status}">${r.status}</span>
    </div>`).join("");
}

function renderLeaveHistory(history) {
  const el = document.getElementById("leaveHistoryList");
  if (!history || history.length === 0) {
    el.innerHTML = `<div class="hrm-empty">No leave requests yet.</div>`;
    return;
  }
  el.innerHTML = history.map(l => `
    <div class="row-item">
      <div class="left-col">
        <div class="primary">${l.leave_type.charAt(0).toUpperCase() + l.leave_type.slice(1)} · ${l.total_days}d</div>
        <div class="secondary">${fmtDate(l.start_date)} – ${fmtDate(l.end_date)} ${l.reason ? "· " + l.reason : ""}</div>
      </div>
      <span class="badge ${l.status}">${l.status}</span>
    </div>`).join("");
}

function renderBenefits(list) {
  const el = document.getElementById("benefitsList");
  if (!list || list.length === 0) {
    el.innerHTML = `<div class="hrm-empty">No benefit records yet.</div>`;
    return;
  }
  el.innerHTML = list.map(b => `
    <div class="row-item">
      <div class="left-col">
        <div class="primary">${b.title}</div>
        <div class="secondary">${b.period || ""} ${b.note ? "· " + b.note : ""}</div>
      </div>
      <div class="right-col">
        <div class="amount">${money(b.amount)}</div>
        <span class="badge ${b.status}">${b.status}</span>
      </div>
    </div>`).join("");
}

// ---------------------------------------------------------------------------
// Leave application
// ---------------------------------------------------------------------------
async function submitLeave() {
  const type = document.getElementById("leaveType").value;
  const start = document.getElementById("leaveStart").value;
  const end = document.getElementById("leaveEnd").value;
  const reason = document.getElementById("leaveReason").value.trim();
  const errEl = document.getElementById("leaveError");
  const okEl = document.getElementById("leaveSuccess");
  errEl.textContent = ""; okEl.textContent = "";

  if (!start || !end) {
    errEl.textContent = "Please choose start and end dates";
    return;
  }

  const { data, error } = await sb.rpc("rpc_apply_leave", {
    p_code: session.code, p_pin: session.pin,
    p_leave_type: type, p_start: start, p_end: end, p_reason: reason,
  });

  if (error || !data || !data.ok) {
    errEl.textContent = (data && data.error) || "Could not submit request";
    return;
  }
  okEl.textContent = "Leave request submitted!";
  showToast("Leave request submitted");
  document.getElementById("leaveReason").value = "";
  loadDashboard();
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function initTabs() {
  document.querySelectorAll(".hrm-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".hrm-tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".hrm-panel").forEach(p => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", () => {
  initTabs();
  document.getElementById("loginBtn").addEventListener("click", attemptLogin);
  document.getElementById("loginPin").addEventListener("keydown", e => { if (e.key === "Enter") attemptLogin(); });
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("applyLeaveBtn").addEventListener("click", submitLeave);

  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) {
    session = JSON.parse(saved);
    document.getElementById("loginView").style.display = "none";
    document.getElementById("dashView").style.display = "block";
    loadDashboard();
  }
});

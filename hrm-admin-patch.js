/* ============================================================================
   NSDI ChocoCravings — HRM ADMIN PATCH
   Injects a full "HRM" management panel into admin-dashboard.html.
   Follows the same pattern as store-patch.js: standalone file, loaded with a
   <script> tag right before </body>, so it never touches the main dashboard
   code and can't cause hoisting/call-stack issues.

   Creates its OWN Supabase client (same URL/key as admin-dashboard.html) —
   does NOT rely on window.supabase being a ready client, since in
   admin-dashboard.html window.supabase is just the raw SDK namespace
   (the real client lives in a local variable called `db`).
   ============================================================================ */

(function () {
  "use strict";

  const SUPABASE_URL = 'https://yjbfditboewwpgyqzryd.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYmZkaXRib2V3d3BneXF6cnlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTgwNjcsImV4cCI6MjA4ODczNDA2N30.08Tvq71w2DBeWZrZb-IaiKfoI-2P_1MPJygzSPiRq24';

  let sb = null; // created in init() once the SDK namespace is available

  // --------------------------------------------------------------------------
  // 1. Inject nav button + panel container into the existing dashboard shell
  // --------------------------------------------------------------------------
  function injectShell() {
    const isMobile = window.innerWidth <= 700;

    const btn = document.createElement("div");
    btn.className = "hrm-nav-btn";
    btn.id = "hrmNavBtn";
    btn.onclick = openHrmPanel;

    if (isMobile) {
      // On mobile the desktop sidebar is display:none, so never inject there —
      // always use a floating pill that sits above the bottom tab bar.
      btn.innerHTML = "👥";
      btn.style.cssText = `
        position:fixed;bottom:74px;right:16px;z-index:9999;
        width:48px;height:48px;border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:20px;cursor:pointer;
        background:linear-gradient(135deg,#6e0977,#c2607a);
        color:#fff;box-shadow:0 8px 24px rgba(110,9,119,.45);
      `;
      document.body.appendChild(btn);
    } else {
      // Desktop — only use the sidebar if it's actually visible.
      const navContainer = document.querySelector(".admin-nav, .sidebar-nav");
      const sidebarNav = document.querySelector("nav.sidebar") || document.querySelector("nav");
      const visible = (el) => el && el.offsetParent !== null;

      btn.textContent = "👥 HRM";
      btn.style.cssText = `
        cursor:pointer;padding:12px 16px;margin:4px 0;border-radius:10px;
        font-weight:600;font-family:inherit;color:#6e0977;
        background:#fdf3f7;transition:.15s;
      `;
      btn.onmouseenter = () => (btn.style.background = "#f3d9e0");
      btn.onmouseleave = () => (btn.style.background = "#fdf3f7");

      const target = visible(navContainer)
        ? navContainer
        : (visible(sidebarNav) ? (sidebarNav.querySelector(".sb-nav") || sidebarNav) : null);

      if (target) {
        target.appendChild(btn);
      } else {
        btn.style.position = "fixed";
        btn.style.bottom = "24px";
        btn.style.right = "24px";
        btn.style.zIndex = "9999";
        btn.style.boxShadow = "0 8px 24px rgba(110,9,119,.3)";
        document.body.appendChild(btn);
      }
    }

    // ── overlay panel ──
    const overlay = document.createElement("div");
    overlay.id = "hrmOverlay";
    overlay.style.cssText = `
      display:none;position:fixed;inset:0;background:rgba(20,10,22,.55);
      z-index:10000;align-items:flex-start;justify-content:center;
      overflow-y:auto;padding:30px 16px;font-family:'Instrument Sans',sans-serif;
    `;
    overlay.innerHTML = `
      <div style="background:#fff;border-radius:20px;max-width:980px;width:100%;
                  padding:26px 28px;box-shadow:0 20px 60px rgba(0,0,0,.3);">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
          <h2 style="margin:0;color:#4a0650;font-family:'Fraunces',serif;">HRM Management</h2>
          <span id="hrmCloseBtn" style="cursor:pointer;font-size:22px;color:#8a7a8c;">&times;</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;">
          <button class="hrm-admin-tab active" data-tab="qr">Today's QR</button>
          <button class="hrm-admin-tab" data-tab="employees">Employees</button>
          <button class="hrm-admin-tab" data-tab="attendance">Attendance</button>
          <button class="hrm-admin-tab" data-tab="leaves">Leave Requests</button>
          <button class="hrm-admin-tab" data-tab="benefits">Add Benefit</button>
        </div>
        <div id="hrmAdminBody"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("hrmCloseBtn").onclick = () => (overlay.style.display = "none");

    document.querySelectorAll(".hrm-admin-tab").forEach(t => {
      t.style.cssText = "padding:9px 16px;border-radius:10px;border:none;background:#f4eef6;color:#6e0977;font-weight:600;cursor:pointer;font-family:inherit;";
    });
    overlay.querySelectorAll(".hrm-admin-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        overlay.querySelectorAll(".hrm-admin-tab").forEach(t => {
          t.classList.remove("active");
          t.style.background = "#f4eef6";
          t.style.color = "#6e0977";
        });
        tab.classList.add("active");
        tab.style.background = "linear-gradient(135deg,#6e0977,#c2607a)";
        tab.style.color = "#fff";
        renderTab(tab.dataset.tab);
      });
    });
  }

  function openHrmPanel() {
    document.getElementById("hrmOverlay").style.display = "flex";
    document.querySelector('.hrm-admin-tab[data-tab="qr"]').click();
  }

  // --------------------------------------------------------------------------
  // 2. Tab renderers
  // --------------------------------------------------------------------------
  async function renderTab(tab) {
    const body = document.getElementById("hrmAdminBody");
    body.innerHTML = `<div style="padding:40px;text-align:center;color:#8a7a8c;">Loading…</div>`;

    if (tab === "qr") return renderQrTab(body);
    if (tab === "employees") return renderEmployeesTab(body);
    if (tab === "attendance") return renderAttendanceTab(body);
    if (tab === "leaves") return renderLeavesTab(body);
    if (tab === "benefits") return renderBenefitsTab(body);
  }

  async function renderQrTab(body) {
    const { data, error } = await sb.rpc("rpc_get_daily_qr");
    if (error || !data || !data.ok) {
      body.innerHTML = `<p style="color:#c24545;">Could not load today's QR code. ${error ? error.message : ""}</p>`;
      return;
    }
    const scanUrl = `${window.location.origin}/attendance-scan.html?token=${data.token}`;
    body.innerHTML = `
      <p style="color:#5a4a5c;">Display this on the counter tablet or print it. It refreshes automatically every day.</p>
      <div style="text-align:center;padding:20px;background:#fbf6f0;border-radius:16px;">
        <canvas id="hrmQrCanvas"></canvas>
        <p style="font-family:monospace;font-size:12px;color:#8a7a8c;margin-top:10px;word-break:break-all;">${scanUrl}</p>
      </div>`;
    // Lightweight QR renderer (loads qrcode.js from CDN on first use)
    if (!window.QRCode) {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js";
      s.onload = () => window.QRCode.toCanvas(document.getElementById("hrmQrCanvas"), scanUrl, { width: 240 });
      document.head.appendChild(s);
    } else {
      window.QRCode.toCanvas(document.getElementById("hrmQrCanvas"), scanUrl, { width: 240 });
    }
  }

  async function renderEmployeesTab(body) {
    const { data: employees, error } = await sb.from("employees").select("*").order("full_name");
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">
        <input id="empFormCode" placeholder="Employee ID (EMP001)" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="empFormName" placeholder="Full Name" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="empFormPhone" placeholder="Phone" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="empFormRole" placeholder="Role (e.g. Barista)" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="empFormDept" placeholder="Department" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <select id="empFormType" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
        </select>
        <input id="empFormPin" placeholder="4-digit PIN" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="empFormSalary" placeholder="Monthly Salary (full-time)" type="number" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="empFormHourly" placeholder="Hourly Rate (part-time)" type="number" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <button id="empFormSubmit" style="padding:10px;border-radius:8px;border:none;background:linear-gradient(135deg,#6e0977,#c2607a);color:#fff;font-weight:600;cursor:pointer;grid-column:1/-1;">Add Employee</button>
      </div>
      <div id="empList"></div>
    `;
    document.getElementById("empFormSubmit").onclick = async () => {
      const { error } = await sb.rpc("rpc_admin_upsert_employee", {
        p_employee_code: document.getElementById("empFormCode").value.trim().toUpperCase(),
        p_full_name: document.getElementById("empFormName").value.trim(),
        p_phone: document.getElementById("empFormPhone").value.trim(),
        p_email: null,
        p_role_title: document.getElementById("empFormRole").value.trim(),
        p_department: document.getElementById("empFormDept").value.trim(),
        p_monthly_salary: Number(document.getElementById("empFormSalary").value || 0),
        p_pin: document.getElementById("empFormPin").value.trim(),
        p_employee_id: null,
        p_employment_type: document.getElementById("empFormType").value,
        p_hourly_rate: Number(document.getElementById("empFormHourly").value || 0),
      });
      if (error) { alert("Failed: " + error.message); return; }
      renderEmployeesTab(body);
    };

    const listEl = document.getElementById("empList");
    if (error || !employees || employees.length === 0) {
      listEl.innerHTML = `<p style="color:#8a7a8c;">No employees added yet.</p>`;
      return;
    }
    listEl.innerHTML = employees.map(e => {
      const isPartTime = e.employment_type === "part_time";
      const payLine = isPartTime ? `₹${e.hourly_rate}/hr` : `₹${e.monthly_salary}/mo`;
      return `
      <div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f2e6ec;">
        <div>
          <strong>${e.full_name}</strong> <span style="color:#8a7a8c;">(${e.employee_code})</span><br>
          <span style="font-size:13px;color:#8a7a8c;">${e.role_title || ""} · ${e.department || ""} · ${payLine}</span>
        </div>
        <div style="text-align:right;">
          <span style="display:block;font-size:11px;padding:2px 8px;border-radius:10px;margin-bottom:4px;background:${isPartTime ? "#eee5f7" : "#fdf3f7"};color:${isPartTime ? "#6e0977" : "#c2607a"};">${isPartTime ? "Part-time" : "Full-time"}</span>
          <span style="font-size:12px;padding:3px 10px;border-radius:12px;background:${e.status === "active" ? "#e4f4e9" : "#fbe4e4"};color:${e.status === "active" ? "#3f8f5f" : "#c24545"};">${e.status}</span>
        </div>
      </div>`;
    }).join("");
  }

  async function renderAttendanceTab(body) {
    const { data: rows, error } = await sb
      .from("employee_attendance")
      .select("*, employees(full_name, employee_code)")
      .order("work_date", { ascending: false })
      .limit(50);
    if (error || !rows || rows.length === 0) {
      body.innerHTML = `<p style="color:#8a7a8c;">No attendance records yet.</p>`;
      return;
    }
    body.innerHTML = rows.map(r => `
      <div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f2e6ec;font-size:14px;">
        <span>${r.employees?.full_name || "—"} (${r.employees?.employee_code || "—"})</span>
        <span style="color:#8a7a8c;">${r.work_date}</span>
        <span>${r.clock_in ? new Date(r.clock_in).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "—"} → ${r.clock_out ? new Date(r.clock_out).toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}) : "—"}</span>
        <span style="font-weight:600;color:#6e0977;">${r.worked_hours ? r.worked_hours + "h" : ""}</span>
      </div>`).join("");
  }

  async function renderLeavesTab(body) {
    const { data: rows, error } = await sb
      .from("employee_leaves")
      .select("*, employees(full_name, employee_code)")
      .eq("status", "pending")
      .order("applied_at", { ascending: false });
    if (error || !rows || rows.length === 0) {
      body.innerHTML = `<p style="color:#8a7a8c;">No pending leave requests. 🎉</p>`;
      return;
    }
    body.innerHTML = rows.map(l => `
      <div style="padding:12px 0;border-bottom:1px solid #f2e6ec;">
        <div style="display:flex;justify-content:space-between;">
          <strong>${l.employees?.full_name}</strong>
          <span style="color:#8a7a8c;font-size:13px;">${l.leave_type} · ${l.total_days}d</span>
        </div>
        <div style="font-size:13px;color:#8a7a8c;margin:4px 0;">${l.start_date} to ${l.end_date} ${l.reason ? "— " + l.reason : ""}</div>
        <div style="display:flex;gap:8px;">
          <button data-id="${l.id}" data-status="approved" class="hrm-leave-action" style="padding:6px 14px;border-radius:8px;border:none;background:#3f8f5f;color:#fff;cursor:pointer;">Approve</button>
          <button data-id="${l.id}" data-status="rejected" class="hrm-leave-action" style="padding:6px 14px;border-radius:8px;border:none;background:#c24545;color:#fff;cursor:pointer;">Reject</button>
        </div>
      </div>`).join("");

    body.querySelectorAll(".hrm-leave-action").forEach(btn => {
      btn.onclick = async () => {
        await sb.rpc("rpc_admin_review_leave", {
          p_leave_id: btn.dataset.id,
          p_status: btn.dataset.status,
          p_reviewed_by: "Admin",
          p_note: null,
        });
        renderLeavesTab(body);
      };
    });
  }

  async function renderBenefitsTab(body) {
    const { data: employees } = await sb.from("employees").select("id, full_name, employee_code").eq("status", "active");
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <select id="benEmp" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
          ${(employees || []).map(e => `<option value="${e.id}">${e.full_name} (${e.employee_code})</option>`).join("")}
        </select>
        <select id="benType" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
          <option value="salary">Salary</option>
          <option value="bonus">Bonus</option>
          <option value="festival_gift">Festival Gift</option>
          <option value="perk">Perk</option>
          <option value="incentive">Incentive</option>
        </select>
        <input id="benTitle" placeholder="Title (e.g. July Salary)" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="benAmount" placeholder="Amount" type="number" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="benPeriod" placeholder="Period (e.g. 2026-07)" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
        <input id="benNote" placeholder="Note (optional)" style="padding:10px;border-radius:8px;border:1px solid #ecdbe4;">
      </div>
      <button id="benSubmit" style="margin-top:12px;padding:10px 20px;border-radius:8px;border:none;background:linear-gradient(135deg,#6e0977,#c2607a);color:#fff;font-weight:600;cursor:pointer;">Add Benefit Record</button>
      <div id="benMsg" style="margin-top:10px;font-size:13px;"></div>
    `;
    document.getElementById("benSubmit").onclick = async () => {
      const { error } = await sb.rpc("rpc_admin_add_benefit", {
        p_employee_id: document.getElementById("benEmp").value,
        p_benefit_type: document.getElementById("benType").value,
        p_title: document.getElementById("benTitle").value.trim(),
        p_amount: Number(document.getElementById("benAmount").value || 0),
        p_period: document.getElementById("benPeriod").value.trim(),
        p_note: document.getElementById("benNote").value.trim(),
      });
      document.getElementById("benMsg").textContent = error ? "Failed: " + error.message : "Added!";
      document.getElementById("benMsg").style.color = error ? "#c24545" : "#3f8f5f";
    };
  }

  // --------------------------------------------------------------------------
  // Init — wait for the Supabase SDK namespace, then build our own client
  // --------------------------------------------------------------------------
  function init() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      setTimeout(init, 300); // config.js / CDN script may still be loading
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    injectShell();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

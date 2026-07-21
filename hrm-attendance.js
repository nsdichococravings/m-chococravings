/* ============================================================================
   NSDI ChocoCravings — QR Attendance Scan Logic
   URL format employees land on after scanning the counter QR:
   https://chococravings.netlify.app/attendance-scan.html?token=XXXXX
   ============================================================================ */

const SUPABASE_URL = "https://yjbfditboewwpgyqzryd.supabase.co"; // <-- confirm this matches config.js
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlqYmZkaXRib2V3d3BneXF6cnlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxNTgwNjcsImV4cCI6MjA4ODczNDA2N30.08Tvq71w2DBeWZrZb-IaiKfoI-2P_1MPJygzSPiRq24";          // <-- paste from config.js

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function getQrToken() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}

function switchState(id) {
  ["formState", "resultState", "expiredState"].forEach(s => {
    document.getElementById(s).style.display = s === id ? "flex" : "none";
  });
}

async function handleClock() {
  const token = getQrToken();
  const code = document.getElementById("empCode").value.trim().toUpperCase();
  const pin = document.getElementById("empPin").value.trim();
  const errEl = document.getElementById("formError");
  errEl.textContent = "";

  if (!token) {
    switchState("expiredState");
    return;
  }
  if (!code || !pin) {
    errEl.textContent = "Please enter your Employee ID and PIN";
    return;
  }

  const { data, error } = await sb.rpc("rpc_clock_attendance", {
    p_code: code, p_pin: pin, p_qr_token: token,
  });

  if (error || !data) {
    errEl.textContent = "Something went wrong. Please try again.";
    return;
  }

  if (!data.ok) {
    if ((data.error || "").toLowerCase().includes("expired")) {
      switchState("expiredState");
    } else {
      errEl.textContent = data.error;
    }
    return;
  }

  const isIn = data.action === "clock_in";
  document.getElementById("resultIcon").className = "qr-status-icon success";
  document.getElementById("resultIcon").textContent = "✓";
  document.getElementById("resultTitle").textContent = isIn ? `Welcome, ${data.name}!` : `See you, ${data.name}!`;
  document.getElementById("resultTime").textContent = new Date(data.time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("resultSub").textContent = isIn
    ? "You've been clocked in for today."
    : `Clocked out · worked ${data.worked_hours} hrs today.`;
  switchState("resultState");
}

window.addEventListener("DOMContentLoaded", () => {
  if (!getQrToken()) {
    switchState("expiredState");
  }
  document.getElementById("clockBtn").addEventListener("click", handleClock);
  document.getElementById("empPin").addEventListener("keydown", e => { if (e.key === "Enter") handleClock(); });
  document.getElementById("doneBtn").addEventListener("click", () => {
    document.getElementById("empCode").value = "";
    document.getElementById("empPin").value = "";
    switchState("formState");
  });
});

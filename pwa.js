// NSDI ChocoCravings — PWA Install Handler
// Include this in index.html and auth.html

(function() {
  // ── REGISTER SERVICE WORKER ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('/sw.js')
        .then(function(reg) {
          console.log('✅ SW registered:', reg.scope);

          // Check for updates every 60 seconds
          setInterval(function() { reg.update(); }, 60000);

          // New version available — prompt user
          reg.addEventListener('updatefound', function() {
            var newSW = reg.installing;
            newSW.addEventListener('statechange', function() {
              if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch(function(err) {
          console.log('SW registration failed:', err);
        });
    });
  }

  // ── INSTALL PROMPT (Android Chrome) ──
  var deferredPrompt = null;

  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    // Show install banner after 3 seconds if user hasn't installed
    setTimeout(showInstallBanner, 3000);
  });

  window.addEventListener('appinstalled', function() {
    deferredPrompt = null;
    hideInstallBanner();
    console.log('✅ App installed!');
  });

  // ── INSTALL BANNER UI ──
  function showInstallBanner() {
    if (!deferredPrompt) return;
    if (sessionStorage.getItem('install-dismissed')) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    var banner = document.getElementById('pwa-install-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'pwa-install-banner';
      banner.innerHTML = `
        <div style="
          position:fixed;bottom:80px;left:12px;right:12px;
          background:linear-gradient(135deg,#2d0055,#8B2FC9);
          border-radius:20px;padding:16px 18px;
          display:flex;align-items:center;gap:12px;
          box-shadow:0 8px 32px rgba(139,47,201,0.5);
          z-index:9999;border:1px solid rgba(192,132,232,0.3);
          animation:slideUp .4s cubic-bezier(.16,1,.3,1) both;
        ">
          <div style="font-size:32px;flex-shrink:0">🍫</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:2px">Add to Home Screen</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.7)">Install ChocoCravings for quick access</div>
          </div>
          <div style="display:flex;gap:8px;flex-shrink:0">
            <button onclick="installPWA()" style="
              background:#fff;color:#2d0055;
              font-size:12px;font-weight:700;
              padding:8px 14px;border-radius:12px;
              border:none;cursor:pointer;
            ">Install</button>
            <button onclick="dismissInstall()" style="
              background:rgba(255,255,255,0.15);color:#fff;
              font-size:16px;font-weight:700;
              width:32px;height:32px;border-radius:10px;
              border:none;cursor:pointer;
              display:flex;align-items:center;justify-content:center;
            ">✕</button>
          </div>
        </div>
        <style>
          @keyframes slideUp{from{transform:translateY(100px);opacity:0}to{transform:translateY(0);opacity:1}}
        </style>
      `;
      document.body.appendChild(banner);
    }
    banner.style.display = 'block';
  }

  function hideInstallBanner() {
    var banner = document.getElementById('pwa-install-banner');
    if (banner) banner.style.display = 'none';
  }

  window.installPWA = function() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function(result) {
      if (result.outcome === 'accepted') {
        console.log('✅ User accepted install');
      }
      deferredPrompt = null;
      hideInstallBanner();
    });
  };

  window.dismissInstall = function() {
    sessionStorage.setItem('install-dismissed', '1');
    hideInstallBanner();
  };

  // ── UPDATE BANNER ──
  function showUpdateBanner() {
    var banner = document.createElement('div');
    banner.innerHTML = `
      <div style="
        position:fixed;top:20px;left:12px;right:12px;
        background:linear-gradient(135deg,#1a0038,#2d0055);
        border-radius:16px;padding:14px 18px;
        display:flex;align-items:center;gap:12px;
        box-shadow:0 8px 24px rgba(0,0,0,0.5);
        z-index:9999;border:1px solid rgba(192,132,232,0.2);
      ">
        <div style="font-size:22px">✨</div>
        <div style="flex:1;font-size:12px;color:rgba(255,255,255,0.8)">
          New version available!
        </div>
        <button onclick="window.location.reload()" style="
          background:#8B2FC9;color:#fff;
          font-size:11px;font-weight:700;
          padding:7px 14px;border-radius:10px;
          border:none;cursor:pointer;white-space:nowrap;
        ">Update Now</button>
      </div>
    `;
    document.body.appendChild(banner);
  }

  // ── iOS INSTALL HINT (Safari) ──
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  if (isIOS && !isStandalone && !sessionStorage.getItem('ios-hint-shown')) {
    setTimeout(function() {
      sessionStorage.setItem('ios-hint-shown', '1');
      var hint = document.createElement('div');
      hint.innerHTML = `
        <div style="
          position:fixed;bottom:80px;left:12px;right:12px;
          background:linear-gradient(135deg,#2d0055,#8B2FC9);
          border-radius:20px;padding:18px 20px;text-align:center;
          box-shadow:0 8px 32px rgba(139,47,201,0.5);
          z-index:9999;border:1px solid rgba(192,132,232,0.3);
        ">
          <div style="font-size:28px;margin-bottom:8px">🍫</div>
          <div style="font-size:13px;font-weight:700;color:#fff;margin-bottom:6px">Install ChocoCravings</div>
          <div style="font-size:12px;color:rgba(255,255,255,0.75);line-height:1.6;margin-bottom:14px">
            Tap <strong style="color:#C084E8">Share</strong> <span style="font-size:16px">⬆️</span> then<br>
            <strong style="color:#C084E8">"Add to Home Screen"</strong> <span style="font-size:14px">➕</span>
          </div>
          <button onclick="this.closest('div').parentElement.remove()" style="
            background:rgba(255,255,255,0.15);color:#fff;
            font-size:12px;font-weight:600;
            padding:8px 24px;border-radius:12px;
            border:1px solid rgba(255,255,255,0.2);cursor:pointer;
          ">Got it</button>
        </div>
      `;
      document.body.appendChild(hint);
    }, 4000);
  }

})();

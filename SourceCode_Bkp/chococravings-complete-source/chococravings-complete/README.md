# NSDI ChocoCravings — Complete Source Code
## Tamil Nadu's Premium Homemade Brownies 🍫

**Version:** 1.0.0  
**Built:** March 2026  
**Contact:** +91 99721 41890 | @nsdi.chococravings

---

## 📁 Folder Structure

```
chococravings-complete/
│
├── 📱 app/
│   └── customer-app.html          ← Main customer ordering app
│
├── 📊 admin/
│   └── admin-dashboard.html       ← Owner's live order dashboard
│
├── 🔐 auth/
│   └── auth.html                  ← Login / OTP / Register flow
│
├── 🗄️ database/
│   ├── schema.sql                 ← FULL schema (20 tables) ← USE THIS
│   └── schema-basic.sql           ← Basic schema (4 tables)
│
├── 📲 mobile/
│   ├── capacitor/
│   │   ├── capacitor.config.ts    ← Capacitor native app config
│   │   ├── package.json           ← npm dependencies
│   │   └── manifest.json          ← PWA manifest (for PWABuilder)
│   ├── android/
│   │   ├── AndroidManifest.xml    ← Android permissions & intents
│   │   ├── build.gradle           ← Android build config & signing
│   │   └── strings.xml            ← Android string resources
│   └── ios/
│       └── Info.plist             ← iOS permissions & URL schemes
│
└── 📚 guides/
    ├── architecture.html          ← Full system architecture diagram
    ├── schema-map.html            ← Interactive database schema map
    ├── setup-guide.html           ← Supabase setup step-by-step
    ├── hosting-upload-guide.html  ← Upload to hosting + PWABuilder
    └── mobile-publishing-guide.html ← Samsung phone publishing guide
```

---

## ⚡ Quick Start

### Step 1 — Set up Supabase
1. Create free account at supabase.com
2. New project → name: ChocoCravings, region: Mumbai (ap-south-1)
3. SQL Editor → paste `database/schema.sql` → Run
4. Database → Replication → Enable Realtime on `orders` table
5. Copy Project URL + anon key

### Step 2 — Configure the apps
Open `app/customer-app.html` and `admin/admin-dashboard.html`  
Replace these 2 lines at the top:
```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';
```

### Step 3 — Upload to your hosting
- Upload `app/customer-app.html` → rename to `index.html`
- Upload `mobile/capacitor/manifest.json`
- Your app is live at: `https://yourdomain.com/app`

### Step 4 — Publish to Play Store
- Go to pwabuilder.com → enter your URL → Generate Android → download AAB
- Play Console → upload AAB → ₹1,650 one-time → submit

---

## 💰 Total Cost

| Item | Cost |
|------|------|
| Supabase database | ₹0/month |
| WhatsApp notifications | ₹0 |
| Your web hosting | ₹0 (existing) |
| Google Play Store | ₹1,650 one-time |
| Apple App Store | ₹8,300/year |

---

## 🍫 Menu Data Included

- **2 tiers:** Premium Chocolate · Belgian Couverture
- **2 egg types:** Eggless 💚 · Contains Egg ❤️
- **15 flavours:** Classic Fudge → Pearl Millet
- **3 pack sizes:** 4pcs / 9pcs / 16pcs
- **15 toppings:** Ganache, Nutella, Ferrero Rocher + more
- **5 coupons:** CHOCO20, SWEET50, BDAY, NSDI10, FREEDEL
- **15 Tamil Nadu cities** pre-loaded

---

## 📞 Support
Instagram: @nsdi.chococravings  
Phone: +91 99721 41890 | +91 73732 78025

*"Happy to serve fresh!!"* — NSDI ChocoCravings

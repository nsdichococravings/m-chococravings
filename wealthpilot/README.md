# WealthPilot: AI personal finance assistant

Know how much you must earn **per day and per week** to cover EMIs, card bills, kids' school,
holidays, daily needs and investments, never miss a due date, and see your **Freedom Date**.

Design docs: [`../docs/finance-assistant/`](../docs/finance-assistant/ARCHITECTURE.md)

```
wealthpilot/
├─ app/                      the web app (works on phones, installable)
│  ├─ index.html  styles.css  app.js  api.js  engine.js  config.js  sw.js
├─ supabase/
│  ├─ migrations/            SQL files to run in your database, in number order
│  ├─ functions/auth-login/  password sign-in with lockout
│  ├─ functions/ai-assistant/ Ask AI chat + "Find savings"
│  └─ tests/                 local-only test scripts (never run these on Supabase)
```

## Try it first (demo mode)

With `app/config.js` left empty the app runs with sample numbers in your browser:

```bash
cd wealthpilot/app && python3 -m http.server 8080   # then open http://localhost:8080
```

## Go live: step by step

### 1. Create a Supabase project
Create a **new** project at supabase.com (keep it separate from the bakery project).

### 2. Run the SQL files
Supabase → **SQL Editor** → New query. Paste each file and press **Run**, in this order:

| # | File | What it creates |
|---|------|-----------------|
| 1 | `0001_core.sql` | `fin` schema, plans, profiles, households, members, subscriptions |
| 2 | `0002_money.sql` | accounts, categories, transactions (split by month) |
| 3 | `0003_dues.sql` | bills, loans / EMIs, credit cards, card statements |
| 4 | `0004_goals_invest.sql` | children, goals, budgets, investments, prices |
| 5 | `0005_summaries.sql` | daily and monthly summary tables, kept up to date automatically |
| 6 | `0006_ai_audit_login.sql` | AI runs and tips, notifications, audit log, login history |
| 7 | `0007_security.sql` | permissions, Row Level Security, account setup on first login |
| 8 | `0008_functions.sql` | earning target, Freedom Date, Home / Dues screens, pay a due |
| 9 | `0009_seed.sql` | the 4 plans and the default categories |
| 10 | `0010_cron.sql` *(optional)* | nightly jobs. First enable **pg_cron** in Database → Extensions |

Every file is safe to run again. If one fails, fix the cause and run the same file again.

### 3. Let the app reach the `fin` schema
Supabase → **Project Settings → Data API → Exposed schemas** → add `fin` → Save.

### 4. Password and email settings
Supabase → **Authentication**:
- **Sign In / Providers → Email**: enabled, **Confirm email** on.
- **Passwords**: minimum length **10**; turn on **Leaked password protection** (if your plan has it).
- **URL Configuration**: set **Site URL** to where the app is hosted, and add it to **Redirect URLs**
  (the email-confirm and reset-password links come back here).
- Optional: **Attack protection → CAPTCHA** (Cloudflare Turnstile).

### 5. Deploy the two functions
With the Supabase CLI, from the `wealthpilot` folder:

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy auth-login --no-verify-jwt
supabase functions deploy ai-assistant
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...      # for Ask AI
```

### 6. Connect the app
Edit `app/config.js` with your values from **Project Settings → API**:

```js
SUPABASE_URL: "https://<project-ref>.supabase.co",
SUPABASE_ANON_KEY: "<anon public key>",
```

### 7. Host the `app/` folder
Any static host works (Cloudflare Pages, Netlify, GitHub Pages). Upload the `app/` folder as the site.

## How login works
- Sign up with name, email and password → confirm the email link → sign in.
- Sign-in goes through `auth-login`: 5 wrong passwords in 15 minutes lock the account for
  15 minutes, every attempt is recorded in `fin.login_events`, and the message never reveals
  whether an email has an account.
- Forgot password → email link → set a new password. Change password asks for the current one.
- Passwords are never stored by WealthPilot; Supabase Auth keeps only a bcrypt hash.

## Testing the database locally
On a local Postgres 15+ (not Supabase):

```bash
createdb wp_test
psql -d wp_test -f supabase/tests/local_supabase_stubs.sql
for f in supabase/migrations/000*.sql; do psql -v ON_ERROR_STOP=1 -d wp_test -f "$f"; done
psql -v ON_ERROR_STOP=1 -d wp_test -f supabase/tests/smoke_test.sql   # ends with ALL SMOKE TESTS PASSED
```

The smoke test checks the earning-target maths against the worked example, dues, payments,
goals, and the security rules (another family's data is invisible; users cannot change their
plan, make themselves admin, write summaries or read monthly partitions directly).

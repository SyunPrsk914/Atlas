# Deploying Atlas on Vercel + Supabase (no Base44, no token limits)

This repo has been migrated **off Base44**. The UI you already know is unchanged — every page still calls the same `base44.*` API surface — but underneath, one compatibility layer (`src/api/base44Client.js`) now talks to:

| What Base44 did | What Atlas uses now | Where it lives |
|---|---|---|
| Entity tables (University, Essay, Material, Profile, RoadmapTask, CollegeKnowledge) | **Supabase Postgres** tables + Row-Level Security | `supabase/schema.sql` |
| `Core.InvokeLLM` (AI with Base44 credits) | **Your own LLM key** (Gemini / OpenAI / Anthropic) via a serverless function | `api/invoke-llm.js` |
| `Core.UploadPublicFile` | **Supabase Storage** public `uploads` bucket | `src/api/supabaseBackend.js` |
| Auth (email+password, OTP, Google) | **Supabase Auth** | `src/api/supabaseBackend.js` |
| Base44 hosting / tokens / limits | **Vercel** hosting — nothing to top up, ever | this document |

**Total cost:** $0 platform fees on free tiers; you only pay your LLM provider per call (Gemini has a generous free tier). No credits, no monthly token cap.

> **Before you start:** the app also runs with **zero configuration** — `npm install && npm run dev` opens a clearly-labeled *Demo mode* (data saved in your browser, AI returns demo output). Use it to explore the UI; then follow this guide to go live.

---

## Part 1 — Supabase (database, auth, file storage)

### 1.1 Create the project

1. Go to **https://supabase.com** → sign in (GitHub account works).
2. Click **New project**.
   - **Name:** `atlas` (anything).
   - **Database password:** generate one and save it in a password manager (you rarely need it, but there is no way to see it again).
   - **Region:** **Tokyo (ap-northeast-1)** — closest to you in Japan, lowest latency.
3. Wait ~2 minutes for provisioning.

### 1.2 Find your keys

In the Supabase dashboard (left sidebar) → **Project Settings** (gear icon) → **API**:

| Value shown in dashboard | You will use it as |
|---|---|
| **Project URL** (`https://xxxxxxxx.supabase.co`) | `VITE_SUPABASE_URL` + `SUPABASE_URL` |
| **anon / public** key (long `eyJ...` string) | `VITE_SUPABASE_ANON_KEY` + `SUPABASE_ANON_KEY` |
| **service_role** key (secret) | **Not needed.** Never put it in Vercel's frontend or in this repo. |

Your **Project Ref** is the `xxxxxxxx` part of the Project URL (also visible in the dashboard header). You'll need it in Part 2.

### 1.3 Create the tables (run the schema)

1. Left sidebar → **SQL Editor** → **New query**.
2. Open [`supabase/schema.sql`](./supabase/schema.sql) in this repo, copy **the entire file**, paste it in.
3. Press **Run** (Cmd/Ctrl + Enter). Expected result: `Success. No rows returned`.
4. Sanity check: left sidebar → **Table Editor** — you should see `universities`, `essays`, `materials`, `profiles`, `roadmap_tasks`, `college_knowledge`.
5. Left sidebar → **Storage** — you should see a **public** bucket named `uploads` (created by the same script).

The schema is **idempotent** — running it again is safe. It also installs the same per-user row privacy the Base44 entities had: every row is visible/editable only by the user who created it.

### 1.4 Auth settings (URLs)

Left sidebar → **Authentication** → **Sign In / Providers** → **Configuration** (or "URL Configuration" depending on dashboard version):

1. **Site URL:** `http://localhost:5173` while testing locally. After the Vercel deploy (Part 3), change it to `https://YOUR-APP.vercel.app` (or your custom domain).
2. **Redirect URLs** — click *Add URL* and add each of:
   - `http://localhost:5173/**`
   - `https://YOUR-APP.vercel.app/**` (replace with the real Vercel URL from Part 3)
   - `https://YOUR-CUSTOM-DOMAIN/**` (only if you add one)

   The `/**` wildcard matters: Google login returns to any path (e.g. `/essay-builder`) and password-reset links land on `/reset-password`.

### 1.5 Email templates (important — the app's OTP/reset screens expect these shapes)

Left sidebar → **Authentication** → **Email Templates**.

**Template 1 — "Confirm signup"** (the 6-digit code screen after Register). Edit it to use the OTP token:

```html
<h2>Confirm your Atlas account</h2>
<p>Your verification code is:</p>
<h1>{{ .Token }}</h1>
<p>Enter this code on the signup page to finish creating your account.</p>
```

**Template 2 — "Reset password"**. The app's reset page expects the link `.../reset-password?token=<TOKEN_HASH>`:

```html
<h2>Reset your Atlas password</h2>
<p>Click the link below to choose a new password:</p>
<p><a href="{{ .SiteURL }}/reset-password?token={{ .TokenHash }}">Reset password</a></p>
<p>If you did not request this, ignore this email.</p>
```

*(The reset page also accepts Supabase's default `?code=` and `#access_token=` link shapes — but the template above is the most reliable.)*

> **Deliverability warning:** Supabase's built-in email service is rate-limited (~3 emails/hour) and lands in spam sometimes — fine for one person, not for production. Optional but recommended: **Authentication → SMTP Settings** and connect any SMTP sender (Gmail app password, Resend, Postmark…). Supabase docs: "Configure a custom SMTP server".

### 1.6 Optional simplification — skip email confirmation

If you don't want the OTP step at all: **Authentication → Sign In / Providers → Email** → turn **Confirm email** OFF. New registrations then log in instantly (the app already handles both flows).

### 1.7 Google login ("Continue with Google")

This is a two-location setup:

**Step A — Google Cloud Console (get the credentials):**

1. Go to **https://console.cloud.google.com** → top project dropdown → **New Project** (name: `atlas-auth`) → Create.
2. Left sidebar → **APIs & Services** → **OAuth consent screen**:
   - User type **External** → fill app name (`Atlas`), your email → Save.
   - Scopes: add `email` and `profile` (usually added by default).
   - **Test users:** add your Google email (while the app is in "Testing" status only test users can log in — publishing it is fine for personal use).
3. Left sidebar → **APIs & Services** → **Credentials** → **+ CREATE CREDENTIALS** → **OAuth client ID**:
   - Application type: **Web application**.
   - **Authorized redirect URIs** → Add URI → exactly:
     `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback`
     (replace `YOUR-PROJECT-REF` — it's in your Supabase Project URL).
   - Create → copy the **Client ID** and **Client Secret**.

**Step B — paste into Supabase:**

1. Supabase dashboard → **Authentication** → **Sign In / Providers** → **Google** → Enable.
2. Paste the **Client ID** and **Client Secret** from Google.
3. Save. (Supabase shows the same callback URL — double-check they match.)

---

## Part 2 — Your AI key (the brain of the essay builder)

The AI features (essay drafting/review/polish, deep college research, holistic application review) call `api/invoke-llm.js`, which uses **your** key. **Gemini is recommended** because the Knowledge Base's "research this college on the internet" mode uses Gemini's Google-Search grounding (the other providers can't browse).

| Provider | Where to get the key | Env var | Free tier |
|---|---|---|---|
| **Google Gemini** (recommended) | **https://aistudio.google.com** → **Get API key** → Create API key (or via console.cloud.google.com → APIs & Services → Credentials) | `GEMINI_API_KEY` | Generous free tier on the Flash models |
| OpenAI | **https://platform.openai.com/api-keys** | `OPENAI_API_KEY` | Pay per use |
| Anthropic | **https://console.anthropic.com/settings/keys** | `ANTHROPIC_API_KEY` | Pay per use |

You can set one or several; `LLM_PROVIDER` picks the default (`gemini`/`openai`/`anthropic`), and internet-research calls automatically use Gemini when `GEMINI_API_KEY` exists.

Model defaults (overridable via `GEMINI_MODEL`, `OPENAI_MODEL`, `ANTHROPIC_MODEL`): `gemini-flash-latest`, `gpt-4o`, `claude-sonnet-4-6`.

Gemini defaults to the `gemini-flash-latest` pointer on purpose. Google retires concrete model IDs regularly, and a pinned ID that has been retired would break every AI feature. If the app is ever pointed at a model that is no longer offered, the endpoint retries once with the provider default and logs a warning, so a retired model degrades to a slightly different model rather than an error. Set `GEMINI_MODEL` only if you need a specific pin.

**Check your setup at any time:** `GET /api/status` returns the configuration (never the keys) as JSON — `configured`, `provider`, `model`, `grounding`, and which providers have a key. The same information appears as a pill in the app's sidebar and mobile header, so you can confirm the connection before waiting on a long generation.

---

## Part 3 — Vercel (hosting)

### 3.1 Push the code to GitHub

This repo is already on GitHub (`SyunPrsk914/Atlas`). Any push to it can be auto-deployed.

### 3.2 Create the project

1. Go to **https://vercel.com** → sign in with GitHub → **Add New… → Project**.
2. Import the `Atlas` repository.
3. Vercel auto-detects **Vite**: keep **Framework Preset = Vite**, **Build Command = `npm run build`**, **Output Directory = `dist`** (defaults are correct).
4. **Environment Variables** — expand this section and add every row below (copy/paste). Values come from Parts 1–2:

| Name | Value | Where the value comes from |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT-REF.supabase.co` | Supabase → Settings → API → **Project URL** |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API → **anon public** |
| `SUPABASE_URL` | same as `VITE_SUPABASE_URL` | same |
| `SUPABASE_ANON_KEY` | same as `VITE_SUPABASE_ANON_KEY` | same |
| `LLM_PROVIDER` | `gemini` (or `openai` / `anthropic`) | your choice |
| `GEMINI_API_KEY` | `AIza...` | Google AI Studio → API keys (Part 2) |

5. **Deploy**.

### 3.3 After the first deploy

1. Copy the production URL (e.g. `https://atlas.vercel.app`).
2. Supabase → Authentication → URL Configuration → set **Site URL** to it and add `https://atlas.vercel.app/**` to **Redirect URLs** (if you haven't already).
3. Open the URL → **Create account** → check your email for the 6-digit code → done.
4. (If you enabled Google login) "Continue with Google" should now round-trip correctly.

### 3.4 Custom domain (optional)

Vercel → Project → **Settings → Domains** → add your domain and follow the DNS instructions; then add `https://yourdomain.com/**` to Supabase's Redirect URLs and update the Site URL.

---

## Part 4 — Local development

```bash
npm install
cp .env.example .env.local   # then fill in the Supabase values (and optionally GEMINI_API_KEY)
npm run dev                  # http://localhost:5173
```

- With `.env.local` filled → local dev uses **your real Supabase project**.
- Without any env vars → **Demo mode** (browser-only storage, demo AI output). Great for UI work; a badge in the corner tells you which mode you're in.
- The Vite dev server also serves `/api/invoke-llm`, so AI calls work locally exactly like on Vercel. To use real AI locally, put `GEMINI_API_KEY` (etc.) in `.env.local` — those keys are read by the dev server, not the browser.

---

## Part 5 — What maps to what (for maintenance)

| Old Base44 call in the code | New behavior |
|---|---|
| `base44.entities.X.list/filter/get/create/update/delete/deleteMany/bulkCreate` | Supabase PostgREST on the mapped table (`University`→`universities`, …). `filter`/`deleteMany` are equality matches (same as before). |
| `base44.auth.register/verifyOtp/resendOtp` | `supabase.auth.signUp` / `verifyOtp(type=signup)` / `resend` |
| `base44.auth.loginViaEmailPassword` | `signInWithPassword` |
| `base44.auth.loginWithProvider('google', path)` | `signInWithOAuth` (redirect to `origin + path`) |
| `base44.auth.resetPasswordRequest/resetPassword` | `resetPasswordForEmail` + `verifyOtp(type=recovery)`/`updateUser` |
| `base44.auth.me/isAuthenticated/logout/redirectToLogin` | `getUser`/`getSession`/`signOut`/redirect to `/login` |
| `base44.integrations.Core.InvokeLLM({prompt, response_json_schema, add_context_from_internet, model})` | `POST /api/invoke-llm` → Gemini/OpenAI/Anthropic. JSON schemas are honored (returns parsed objects). `add_context_from_internet` uses Gemini Google-Search grounding. |
| `base44.integrations.Core.UploadPublicFile({file})` | Supabase Storage `uploads` bucket → returns `{ file_url }` (same shape) |
| `base44.app.getPublicSettings()` | static `{ id, public_settings }` |

Key files: `src/api/base44Client.js` (entry / mode switch) · `src/api/supabaseBackend.js` (production backend) · `src/api/localBackend.js` (demo backend) · `api/invoke-llm.js` (AI endpoint) · `supabase/schema.sql` (database).

The `base44/` folder remains as **reference only** (the original entity schemas that `schema.sql` was derived from). Nothing reads it.

---

## Part 6 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login says "Invalid login credentials" for a new account | Email confirmation still required and code not entered | Enter the OTP code, or turn Confirm email OFF (1.6) |
| Never receive the signup/reset email | Supabase's ~3/hour email cap, or spam folder | Check spam; configure custom SMTP (end of 1.5) |
| Google login flashes and returns to login | Redirect URL mismatch | Supabase → Auth → Redirect URLs must include `https://YOUR-APP.vercel.app/**` **and** Google's authorized redirect URI must be exactly `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` |
| Password reset link says "Invalid reset link" | Using the default Supabase email template | Apply the template in 1.5 (`?token={{ .TokenHash }}`) |
| AI button fails with "No LLM provider configured" | Missing API key in Vercel | Add `GEMINI_API_KEY` (or another) in Vercel env vars and **redeploy** (`vercel --prod` or push; env vars are baked at build/deploy for `VITE_*`, read at runtime for the server key — a redeploy is the safe move) |
| AI returns a schema/JSON error | Model returned malformed JSON | Just retry; the endpoint already extracts JSON from fenced/markdown replies |
| Lists come back empty though data exists | RLS: rows belong to another user | Data is per-account by design (same as Base44). Log in with the same account that created it |
| `filter({ university_name: "X" })` misses rows | Case/spacing differs | Equality match is exact (same as Base44) |
| Uploads fail with 403 | Row not in `uploads` bucket or bucket missing | Re-run `supabase/schema.sql` (idempotent) — it (re)creates the bucket and policies |

## Part 7 — Costs, limits, and data safety (honest summary)

- **Vercel Hobby:** free — 100 GB bandwidth/mo, serverless functions included. More than enough for one user.
- **Supabase Free:** 500 MB database, 1 GB file storage, 50,000 monthly active users, 500k edge function invocations (unused here). Your data will be megabytes at most.
- **LLM:** the only metered part. The Flash model on the free tier covers heavy personal use; otherwise cents per essay draft.
- **Backups:** Supabase free tier keeps 7 days of daily backups (Dashboard → Database → Backups). For irreplaceable essay work, periodically use SQL Editor → `copy (select * from essays) to stdout with csv header` or the Table Editor CSV export.
- **Privacy:** essay/profile data is protected by per-user RLS; the AI endpoint requires a logged-in Supabase session (JWT-verified server-side); your LLM provider key never reaches the browser.

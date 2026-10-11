# Deploying Atlas on Vercel + Supabase (NaraRouter AI)

This repo has been migrated **off Base44**. React, Vite, Tailwind, the Supabase backend, and the existing pages remain in place. A compatibility layer (`src/api/base44Client.js`) keeps the existing `base44.*` data/auth surface working, while AI uses:

| Capability | Current implementation | Where it lives |
|---|---|---|
| Entity tables and row privacy | **Supabase Postgres + RLS** | `supabase/schema.sql` |
| The AI provider | **NaraRouter**, called from the server-side function with a key that never reaches the browser | `api/invoke-llm.js`, `src/api/aiProvider.js` |
| Model choice | Any alias your NaraRouter plan entitles, listed from `GET /api/models` and selected in **AI setup** | `api/models.js` |
| Other providers (optional) | Gemini, Groq, OpenRouter, OpenAI, or Anthropic keys are still honoured if set; NaraRouter wins when its key is present | `api/invoke-llm.js` |
| Auth and file upload | **Supabase Auth + Storage** | `src/api/supabaseBackend.js` |
| Hosting | **Vercel**: static frontend plus the serverless `api/*` functions that hold the key | this document |

**Atlas itself adds no AI request, token, or daily quota.** Your NaraRouter plan does: free and paid tiers carry their own token-per-day and requests-per-minute limits, and Atlas surfaces the provider's real HTTP 429/403 errors instead of retrying around them or pretending a capped call succeeded.

> **Before you start:** `npm install && npm run dev` opens a clearly labeled *Demo mode* until `NARAROUTER_API_KEY` is set on the server. Follow Part 2 — it takes about five minutes, and everything else in this document works without it.

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

The Vercel Supabase integration also creates `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Atlas accepts those, plus `VITE_*` and `SUPABASE_*`. It uses the first value that is a real `https://….supabase.co` project URL — a Postgres connection string in `SUPABASE_URL` is ignored, not passed to the client. Do not wrap values in quotes.

Your **Project Ref** is the `xxxxxxxx` part of the Project URL (also visible in the dashboard header). You'll need it in Part 2.

### 1.3 Create the tables (run the schema)

1. Left sidebar → **SQL Editor** → **New query**.
2. Open [`supabase/schema.sql`](./supabase/schema.sql) in this repo, copy **the entire file**, paste it in.
3. Press **Run** (Cmd/Ctrl + Enter). Expected result: `Success. No rows returned`.
4. Sanity check: left sidebar → **Table Editor** — you should see `universities`, `essays`, `materials`, `profiles`, `roadmap_tasks`, `college_knowledge`, `applicant_knowledge`.
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

## Part 2 — NaraRouter (the AI provider)

Atlas talks to exactly one AI provider. There is no second code path to configure, no local server to install, and no browser origin to whitelist: the key lives on the server, the browser calls `/api/invoke-llm`, and every status message, error and setting in the app describes NaraRouter.

### 2.1 Get a key

1. Create an account at [router.bynara.id](https://router.bynara.id/register).
2. Open **API keys**, create a key, and copy it when it is shown — NaraRouter displays a key once at creation. Keys are prefixed `sk-nry-` and authenticate with a Bearer token.

### 2.2 Put it on the server

In **Vercel → Project → Settings → Environment Variables**:

```dotenv
LLM_PROVIDER=nararouter
NARAROUTER_API_KEY=sk-nry-your-secret-key
NARAROUTER_MODEL=agnes-3-flash
# Optional; this is already the default:
NARAROUTER_BASE_URL=https://router.bynara.id/v1
```

For local development put the same lines in the git-ignored `.env.local` and restart `npm run dev`. Then redeploy on Vercel after saving.

`LLM_PROVIDER=nararouter` is what selects NaraRouter explicitly rather than relying on key auto-detection — set it whenever another provider's key is also present. Never give the key a `VITE_*` prefix, paste it into chat, or commit it: a `VITE_*` variable is bundled into the browser.

### 2.3 Choose a model your plan actually has

NaraRouter's authenticated `/v1/models` returns exactly the aliases your own plan entitles, so Atlas reads it rather than guessing:

- In the app: **AI status pill → AI setup** lists the models from `GET /api/models` in a dropdown, and the choice is remembered on this browser.
- On the server: `NARAROUTER_MODEL` sets the default used when the app has not chosen one.
- Directly, to see the raw list:

  ```bash
  curl -sS https://router.bynara.id/v1/models \
    -H "Authorization: Bearer $NARAROUTER_API_KEY"
  ```

Atlas's shipped default alias is `agnes-3-flash`. Public free-plan data has also listed `agnes-2.5-flash`, `exo-stealh`, `jev`, `laguna-s-2.1`, `ling-3.0-flash-fin-free`, `nemotron-3-super-free`, `nemotron-3-ultra-free` and `nemotron-3.5-lightning-free`; treat your own `/v1/models` result as authoritative, because aliases and entitlements change. If a chosen alias turns out not to be entitled, the server falls back to the default model for that call and reports what happened in `meta` rather than failing the action.

Optional direct key check (this sends a test prompt to NaraRouter, not through Atlas):

```bash
curl -sS https://router.bynara.id/v1/chat/completions \
  -H "Authorization: Bearer $NARAROUTER_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"agnes-3-flash","messages":[{"role":"user","content":"Reply with OK."}]}'
```

### 2.4 Confirm from inside Atlas

`GET /api/status` reports whether a provider is configured and reachable, which provider was selected, and the default model — never a key value. The sidebar AI status pill opens **AI setup**, where you can switch between NaraRouter and clearly labeled **Demo mode**. Demo mode keeps every page working with obvious placeholders and never persists AI output as if it were real.

### 2.5 Limits, errors and privacy

**Free-tier limits are NaraRouter's, not Atlas's.** As checked on 9 October 2026, NaraRouter's live public `/api/plans` and pricing page report **7,000,000 tokens/day** and **15 requests/minute** for Free, with paid tiers raising both; its developer-docs quota table still shows a **5,000,000-token base-class** figure. Treat your account dashboard as authoritative for quota. Atlas serialises its own AI calls one at a time so a page cannot fan out into a rate limit, and a 429 is shown as a 429.

**Privacy / student-data warning:** NaraRouter's privacy policy says gateway prompt/output retention is off by default, but prompts are transmitted to the selected upstream model provider and then subject to that provider's own terms. The same policy says the service is not directed to people under 18. Atlas can send profiles, essays, and uploaded material to the provider, so review NaraRouter and upstream policies and do not route minors' sensitive data unless that use is authorised and appropriate.

References: [NaraRouter API docs](https://router.bynara.id/docs), [live plan data](https://router.bynara.id/api/plans), [pricing](https://router.bynara.id/pricing), [privacy policy](https://router.bynara.id/privacy).

### 2.6 University Research without a live call

University Research has a second, offline source: the **Atlas research pack** in `src/data/schoolResearch/`. Thirteen universities were researched by hand from their own published admission, department, catalogue and bulletin pages, written into the same eleven-section structure the AI research prompt asks for, and stored in the repo. In **University Research**, select a school that is in the pack and press **Load this into University Research** — no key, no call, no quota. It writes a normal `CollegeKnowledge` row with `research_provider = atlas-research-pack`, and it asks before replacing anything already stored.

Every AI action then reads the relevant slice of that report: drafting gets the values, the reader's lens, campus life and the major; review gets the values, the essay requirements and the reader's lens only; the full-application review gets the whole institutional picture. See `src/lib/schoolFit.js`.

### Other providers (optional)

NaraRouter is the supported path. These other keys are still honoured by `/api/invoke-llm` if a deployment already has them — NaraRouter takes precedence when its key is present, and nothing in the app offers them as a first choice:

| Provider | Server environment variable | Optional model/base URL settings |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` (default `gemini-flash-latest`) |
| NaraRouter | `NARAROUTER_API_KEY` | `NARAROUTER_MODEL` (default `agnes-3-flash`), optional `NARAROUTER_BASE_URL` |
| Groq | `GROQ_API_KEY` | `GROQ_MODEL`, optional `GROQ_BASE_URL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` (default `openrouter/auto`), optional `OPENROUTER_BASE_URL` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL`, optional `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |

#### How the NaraRouter adapter behaves

NaraRouter exposes an OpenAI Chat Completions-compatible endpoint. Atlas connects to `https://router.bynara.id/v1/chat/completions` from its server-side `/api/invoke-llm` function; the key is never put in browser storage or the Vite bundle. The adapter sends the same prompts and JSON-mode calls used by every other provider, maps `finish_reason` to `meta.truncated` so a cut-off generation is repaired rather than accepted, and returns NaraRouter-specific HTTP errors — including 429 — as failures. It does not bypass plan limits or hide them.

1. Create an account at [router.bynara.id](https://router.bynara.id/register), create an API key under **API keys**, and copy it when shown. NaraRouter documents `sk-nry-` key prefixes and Bearer-token authentication.
2. Add these server-side variables in **Vercel → Project → Settings → Environment Variables**. For local development, put them in the ignored `.env.local` file and restart `npm run dev`:

   ```dotenv
   LLM_PROVIDER=nararouter
   NARAROUTER_API_KEY=sk-nry-your-secret-key
   NARAROUTER_MODEL=agnes-3-flash
   # Optional; this is already the default:
   NARAROUTER_BASE_URL=https://router.bynara.id/v1
   ```

   Set `LLM_PROVIDER=nararouter` when Gemini is also configured; it explicitly selects NaraRouter rather than relying on key auto-detection. Do not put the secret in `VITE_*`, paste it into chat, or commit it.
3. For Vercel, redeploy after saving the variables. In Atlas, open the AI status pill → **AI setup**; the pill reads Connected once `/api/status` sees the key. In local development, restart the dev server after editing `.env.local`.
4. Check which model aliases your key can use with the authenticated models endpoint, then set `NARAROUTER_MODEL` to one of them:

   ```bash
   curl -sS https://router.bynara.id/v1/models \
     -H "Authorization: Bearer $NARAROUTER_API_KEY"
   ```

   The current public Free-plan data lists `agnes-3-flash` (the Atlas default), along with `agnes-2.5-flash`, `exo-stealh`, `jev`, `laguna-s-2.1`, `ling-3.0-flash-fin-free`, `ling-3.0-flash-sante-free`, `nemotron-3-super-free`, `nemotron-3-ultra-free`, and `nemotron-3.5-lightning-free`. Use your key's `/v1/models` result as the final authority; model access and aliases can change. The NaraRouter homepage also demonstrates `auto/bynara`, but the explicit Free-plan alias avoids assuming that an automatic route is included in your account.
5. Optional direct key check (this sends a test prompt to NaraRouter, not through Atlas):

   ```bash
   curl -sS https://router.bynara.id/v1/chat/completions \
     -H "Authorization: Bearer $NARAROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"agnes-3-flash","messages":[{"role":"user","content":"Reply with OK."}]}'
   ```

**Free-tier limits are NaraRouter's, not Atlas's.** As checked on 9 October 2026, NaraRouter's live public `/api/plans` and pricing page report **7,000,000 tokens/day** and **15 requests/minute** for Free. Its developer-docs quota table still shows a **5,000,000-token base-class** figure. Treat NaraRouter's account dashboard/live plan data as authoritative for your quota, and authenticated `/v1/models` as authoritative for aliases your key can use. Nara also documents concurrency/model-tier limits; its actual HTTP 429/403 errors are shown rather than retried or converted to success. The service's plans, included models, and quota can change.

**Privacy / student-data warning:** NaraRouter's privacy policy says gateway prompt/output retention is off by default, but prompts are transmitted to the selected upstream model provider and then subject to that provider's own terms. The same policy says the service is not directed to people under 18. Atlas can send profiles, essays, and uploaded material to the provider, so review NaraRouter and upstream policies and do not route minors' sensitive data unless that use is authorised and appropriate. If unsure, stay in Demo mode: it keeps every page working and never persists output as if it were real.

References: [NaraRouter API docs](https://router.bynara.id/docs), [live plan data](https://router.bynara.id/api/plans), [pricing](https://router.bynara.id/pricing), [privacy policy](https://router.bynara.id/privacy).

Hosted free keys are still capped by their provider; check that provider's current pricing/quota terms. Store keys only in a trusted server environment such as local `.env.local` or Vercel Environment Variables, never in a `VITE_*` variable. If the provider returns HTTP 429, Atlas displays its real error and does not convert it to a successful result. Atlas imposes no additional AI request, token, or daily cap.

Google Search grounding is only requested for an explicitly selected Gemini provider. A report is labeled web-grounded only when the successful Gemini response contains grounding metadata; NaraRouter cannot ground a call, so its reports are labeled **not web-grounded** and Atlas says so once per report rather than on every action. University Research does not depend on grounding at all: it uses the public official page text you supply, and the Atlas research pack (Part 2.6) uses nothing but pages already read and attributed.

`GET /api/status` reports provider configuration and availability without returning any key values, and `GET /api/models` returns the model aliases your key entitles. The sidebar AI status pill opens the setup panel, where you choose between NaraRouter and clearly labeled Demo mode.

---

## Part 3 — Vercel (hosting)

### 3.1 Push the code to GitHub

This repo is already on GitHub (`SyunPrsk914/Atlas`). Any push to it can be auto-deployed.

### 3.2 Create the project

1. Go to **https://vercel.com** → sign in with GitHub → **Add New… → Project**.
2. Import the `Atlas` repository.
3. Vercel auto-detects **Vite**: keep **Framework Preset = Vite**, **Build Command = `npm run build`**, **Output Directory = `dist`** (defaults are correct).
4. **Environment Variables** — add the Supabase rows below if using Supabase. These are not AI keys:

| Name | Value | Where the value comes from |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://YOUR-PROJECT-REF.supabase.co` | Supabase → Settings → API → **Project URL** |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Supabase → Settings → API → **anon public** |
| `SUPABASE_URL` | same as `VITE_SUPABASE_URL` | same |
| `SUPABASE_ANON_KEY` | same as `VITE_SUPABASE_ANON_KEY` | same |

The deploy succeeds without an AI key — the app opens in Demo mode and says so. To turn on real AI, set the server-side variables from Part 2; never use a `VITE_*` prefix for a key.

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
cp .env.example .env.local   # optional: fill in Supabase values for persistent data/auth
npm run dev                  # http://localhost:5173
```

- Without Supabase environment values the app uses its existing browser-only Demo backend.
- Without a selected AI model, AI buttons produce clearly labeled **Demo output**.
- Node.js 22.13 or newer is required (pdf.js 6 needs it when a PDF is read).
- To use real AI in local development, put `LLM_PROVIDER` and `NARAROUTER_API_KEY` in `.env.local` (Part 2) and restart `npm run dev`. The Vite dev server serves the same `api/*` handlers Vercel runs, so the browser never talks to NaraRouter directly and the key never reaches the page.
- `/api/invoke-llm` remains only for the optional hosted path. Its API keys stay server-side; hosted-provider limits still apply.
- University Research needs an official public admissions URL and page text. Atlas fetches the page from the browser without cookies. If the site blocks CORS or redirects to login, Atlas says so and lets the user paste public text; it does not proxy around the block or scrape behind a login.

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
| Current AI feature calls through `runAI({prompt, response_json_schema, add_context_from_internet, model})` | Browser → `POST /api/invoke-llm` → NaraRouter `/v1/chat/completions`, with the key server-side. Per-action temperatures are clamped (review runs cold, drafting warm), JSON mode is requested only when a schema is supplied, and a `finish_reason` of `length` becomes `meta.truncated` so essay actions treat a cut-off answer as unfinished and send it back for a length repair rather than accepting a fragment. One strict retry for invalid JSON. The model alias comes from `NARAROUTER_MODEL` unless the app has chosen one from `GET /api/models`, and a non-entitled alias falls back to the default for that call. Gemini grounding is reported only after successful grounding metadata. With no key, the client returns clearly labeled Demo output. |
| `base44.integrations.Core.UploadPublicFile({file})` | Supabase Storage `uploads` bucket → returns `{ file_url }` (same shape) |
| `base44.entities.ApplicantKnowledge.*` (new) | `applicant_knowledge` table (AI Knowledge Base). Written by the Knowledge Base page; read by drafts and reviews |
| `base44.app.getPublicSettings()` | static `{ id, public_settings }` |

Key files: `src/api/base44Client.js` (Base44 compatibility surface) · `src/api/aiProvider.js` (AI mode, remembered model, and the FIFO call queue) · `src/api/llmClient.js` (the `/api/invoke-llm` and `/api/models` client) · `src/lib/ai.js` (one provider, one set of failure modes) · `src/lib/schoolFit.js` (the university-research section structure and the slice each AI job receives) · `src/data/schoolResearch/` (the hand-researched pack) · `src/lib/documentReader.js` (reads PDF, Word, RTF, HTML, text and web links) · `src/lib/materialJobs.js` (automatic reading and analysis) · `src/lib/applicantKnowledge.js` (AI Knowledge Base) · `src/lib/researchSource.js` (public page fetch/extraction) · `api/invoke-llm.js` (optional hosted endpoint) · `supabase/schema.sql` (database and RLS).

The `base44/` folder remains as **reference only** (the original entity schemas that `schema.sql` was derived from). Nothing reads it.

---

## Part 6 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login says "Invalid login credentials" for a new account | Email confirmation still required and code not entered | Enter the OTP code, or turn Confirm email OFF (1.6) |
| Never receive the signup/reset email | Supabase's ~3/hour email cap, or spam folder | Check spam; configure custom SMTP (end of 1.5) |
| Google login flashes and returns to login | Redirect URL mismatch | Supabase → Auth → Redirect URLs must include `https://YOUR-APP.vercel.app/**` **and** Google's authorized redirect URI must be exactly `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` |
| Password reset link says "Invalid reset link" | Using the default Supabase email template | Apply the template in 1.5 (`?token={{ .TokenHash }}`) |
| AI setup says Not connected | `NARAROUTER_API_KEY` is missing on the server, or the deployment was not redeployed after it was added | Set the variables from Part 2, redeploy, then reopen **AI setup**; in local development restart `npm run dev` after editing `.env.local` |
| The model list in AI setup is empty | Your NaraRouter plan does not list models, or the key is not entitled | Check `GET /api/models` for its `message`, then run the `curl` in Part 2.3 with your own key; `NARAROUTER_MODEL` still works as a default |
| University Research fetch fails | Public page is unavailable or blocks browser CORS | Atlas does not proxy or bypass the block. Paste the publicly visible page text and keep its official URL in the source field |
| A material says it has no readable text | Scanned or image-only PDF (no text layer); Atlas does not run OCR | Export a text-based PDF from the original, or save the document as `.docx` |
| A material says the file cannot be opened | Password-protected or damaged PDF | Remove the password or re-export the file, then re-upload it |
| A material says the file is too large | Over 30 MB | Upload a smaller copy, or split the document |
| Old Word `.doc` file is refused | Only `.docx`, RTF, HTML, text and PDF are read | Save the file as `.docx` or PDF in Word or Google Docs |
| Analysis says it did not finish | The provider returned an error or no usable answer | Open **AI setup** to re-check the key and the model, then retry; Atlas tries again the next time you open Materials |
| A long material takes many minutes | Each 6,000-character part is one local-model call, and calls run one at a time | Wait for the progress bar on that material, or use a smaller model. Other AI actions resume when the analysis finishes |
| AI Knowledge Base says the table is missing | `applicant_knowledge` has not been created yet | Re-run `supabase/schema.sql` (idempotent). Drafts and reviews work without it in the meantime |
| Demo mode: a large upload fails with a storage error | Demo mode keeps files inside browser storage, which is limited (typically about 5 MB in total) | Use Supabase for real documents; Demo mode is for trying the app
| AI call returns HTTP 429 | NaraRouter's plan limit for the day or the minute was reached | Atlas displays the real error. Wait for the window to reset, choose a lighter model alias, or upgrade the plan; no key rotation or quota bypass is attempted |
| Local model returns invalid JSON | Model did not follow the existing response schema | Atlas retries once with a stricter JSON-only instruction; if still invalid, it reports the parse failure rather than substituting demo text |
| Lists come back empty though data exists | RLS: rows belong to another user | Data is per-account by design (same as Base44). Log in with the same account that created it |
| `filter({ university_name: "X" })` misses rows | Case/spacing differs | Equality match is exact (same as Base44) |
| Uploads fail with 403 | Row not in `uploads` bucket or bucket missing | Re-run `supabase/schema.sql` (idempotent) — it (re)creates the bucket and policies |

## Part 7 — Costs, limits, and data safety (honest summary)

- **Atlas AI limits:** Atlas does not add an AI request-per-minute, request-per-day, token, or daily budget. Calls are queued one at a time in order rather than rejected when another is running, so a page cannot fan out into the provider's rate limit.
- **Document analysis:** a material is read up to 200,000 characters (about 30 to 40 pages); beyond that the text is cut and the cut is marked in the stored text. The whole text is analysed, in parts of about 6,000 characters, one local-model call per part (42 parts at most). Local requests run one at a time in click order, so a long analysis delays other AI actions until it finishes.
- **Provider limits:** inference is performed by NaraRouter under your plan's token-per-day and requests-per-minute limits, and the context window depends on the alias you choose. Atlas reports the provider's real errors instead of converting a capped call into a successful-looking one.
- **Hosted providers:** any hosted provider may cap free usage, throttle requests, charge fees, or return HTTP 429. Those are the provider's rules—not an unlimited service—and Atlas displays the real provider error without bypassing it.
- **Vercel / Supabase:** their plans and operational limits still apply to hosting, database, auth, and storage; these are separate from an Atlas-imposed AI quota.
- **Backups:** export irreplaceable application data periodically. The database schema remains idempotent; re-run `supabase/schema.sql` to add the `applicant_knowledge` table (AI Knowledge Base) and the research source/provenance columns to an existing project.
- **Privacy:** Supabase data is protected by per-user RLS. The NaraRouter key is server-side only — never in the Vite bundle, browser storage, or a `VITE_*` variable — and prompts go from the serverless function to the provider. Review NaraRouter's privacy policy and the upstream model provider's terms before sending a minor's personal data (Part 2.5). Supabase's service-role key is not used in the frontend.

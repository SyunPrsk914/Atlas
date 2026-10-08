# Deploying Atlas on Vercel + Supabase (local-first AI)

This repo has been migrated **off Base44**. React, Vite, Tailwind, the Supabase backend, and the existing pages remain in place. A compatibility layer (`src/api/base44Client.js`) keeps the existing `base44.*` data/auth surface working, while AI uses:

| Capability | Current implementation | Where it lives |
|---|---|---|
| Entity tables and row privacy | **Supabase Postgres + RLS** | `supabase/schema.sql` |
| Default real AI | **Ollama on the user's own computer**, called directly by the browser at `http://127.0.0.1:11434` | `src/api/ollamaClient.js` |
| Optional hosted AI | User/deployment-supplied NaraRouter, Gemini, Groq, OpenRouter, OpenAI, or Anthropic key; provider quotas apply | `api/invoke-llm.js` |
| Auth and file upload | **Supabase Auth + Storage** | `src/api/supabaseBackend.js` |
| Hosting | **Vercel** static frontend; it is not in the local Ollama request path | this document |

**Atlas itself adds no AI request, token, or daily quota.** Local Ollama inference uses your computer and is not metered by Atlas. Hosted providers may impose their own usage caps, rate limits, pricing, and availability; Atlas does not claim a hosted API is unlimited.

> **Before you start:** `npm install && npm run dev` opens a clearly labeled *Demo mode* until you connect a model in the app's **AI setup** panel. A hosted key is optional. Follow Part 2 to install local Ollama and configure its browser origin.

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

## Part 2 — Local Ollama (default AI path)

Atlas's default real-model path is a model running on **your own computer**. The browser talks directly to `http://127.0.0.1:11434`; the request does not go to Vercel or a hosted AI proxy. The local base URL and installed model are saved in this browser's `localStorage`. Open **AI setup** from the AI status pill, enter the URL/model, and choose **Probe & save local model**. Atlas calls `/api/tags` and only saves the setting if that probe succeeds and the selected model is installed.

### Install and download a model

Install Ollama with the official command for your OS:

- **macOS or Linux:** run `curl -fsSL https://ollama.com/install.sh | sh`.
- **Windows PowerShell:** run `irm https://ollama.com/install.ps1 | iex`.
- **macOS desktop-app alternative:** download from <https://ollama.com/download/mac>.

Start Ollama, then download a local model (example):

```bash
ollama pull llama3.2
```

The model's exact installed name appears in `/api/tags` and the AI setup panel. Atlas excludes Ollama Cloud model names and only accepts on-device models. Hardware and model size determine response speed.

### Allow this Atlas page with `OLLAMA_ORIGINS`

Ollama must allow the **origin of the Atlas page open in your browser**. Use the exact origin, with no path or trailing slash. For local Vite development that is usually `http://localhost:5173`. For a deployment, add its exact origin too (for example `https://atlas.example.com`; for an Arena preview, use that preview's exact browser origin). Multiple origins are comma-separated. Do not use `*`.

Keep Ollama bound to loopback. It defaults to `127.0.0.1:11434`; the commands below set that explicitly. Do not use `0.0.0.0`, port-forward `11434`, configure a public tunnel, or expose the Ollama server to the internet.

**macOS desktop app:** set the variables and restart Ollama from the menu bar:

```bash
launchctl setenv OLLAMA_NO_CLOUD "1"
launchctl setenv OLLAMA_HOST "127.0.0.1:11434"
launchctl setenv OLLAMA_ORIGINS "http://localhost:5173,https://YOUR-ATLAS-ORIGIN"
```

Replace `https://YOUR-ATLAS-ORIGIN` with the deployed Atlas origin; omit it if you only use local Vite. Quit and reopen Ollama after setting these values.

**Linux systemd service:** run `sudo systemctl edit ollama.service`, add the following under `[Service]`, save, then reload and restart:

```ini
[Service]
Environment="OLLAMA_NO_CLOUD=1"
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_ORIGINS=http://localhost:5173,https://YOUR-ATLAS-ORIGIN"
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

**Windows PowerShell:** set the user-level variables, quit Ollama from the system tray, then start it again from the Start menu:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_NO_CLOUD", "1", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")
[Environment]::SetEnvironmentVariable("OLLAMA_ORIGINS", "http://localhost:5173,https://YOUR-ATLAS-ORIGIN", "User")
```

You can instead run the Ollama server in a terminal after quitting its background service:

```bash
OLLAMA_NO_CLOUD=1 OLLAMA_HOST=127.0.0.1:11434 OLLAMA_ORIGINS="http://localhost:5173,https://YOUR-ATLAS-ORIGIN" ollama serve
```

```powershell
$env:OLLAMA_NO_CLOUD = "1"
$env:OLLAMA_HOST = "127.0.0.1:11434"
$env:OLLAMA_ORIGINS = "http://localhost:5173,https://YOUR-ATLAS-ORIGIN"
ollama serve
```

If the browser reports a CORS/network error, check the exact origin in `OLLAMA_ORIGINS`, confirm Ollama is running, then reopen **AI setup** and probe again. If a local model is configured but unavailable, Atlas reports the failure; it does not silently fall back to demo or a hosted provider.

### Optional hosted providers

A hosted provider is not required. For users who explicitly select **Hosted provider** in AI setup, the server-side compatibility function can use these optional keys:

| Provider | Server environment variable | Optional model/base URL settings |
|---|---|---|
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` (default `gemini-flash-latest`) |
| NaraRouter | `NARAROUTER_API_KEY` | `NARAROUTER_MODEL` (default `agnes-3-flash`), optional `NARAROUTER_BASE_URL` |
| Groq | `GROQ_API_KEY` | `GROQ_MODEL`, optional `GROQ_BASE_URL` |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` (default `openrouter/auto`), optional `OPENROUTER_BASE_URL` |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL`, optional `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |

#### Connect NaraRouter instead of Gemini

NaraRouter exposes an OpenAI Chat Completions-compatible endpoint. Atlas connects to `https://router.bynara.id/v1/chat/completions` from its server-side `/api/invoke-llm` function; the NaraRouter key is never put in browser storage or the Vite bundle. The adapter sends the same existing prompts and JSON-mode calls used by other hosted providers. NaraRouter-specific HTTP errors, including 429, are returned as failures—Atlas does not retry with another Nara model or bypass its limits.

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
3. For Vercel, redeploy after saving the variables. In Atlas, open the AI status pill → **AI setup** → **Use hosted provider**. In local development, restart the dev server and select the same mode. Local Ollama remains the default until Hosted is selected.
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

**Privacy / student-data warning:** NaraRouter's privacy policy says gateway prompt/output retention is off by default, but prompts are transmitted to the selected upstream model provider and then subject to that provider's own terms. The same policy says the service is not directed to people under 18. Atlas can send profiles, essays, and uploaded material to a selected hosted provider, so review NaraRouter and upstream policies and do not route minors' sensitive data unless that use is authorised and appropriate. If unsure, use local Ollama instead.

References: [NaraRouter API docs](https://router.bynara.id/docs), [live plan data](https://router.bynara.id/api/plans), [pricing](https://router.bynara.id/pricing), [privacy policy](https://router.bynara.id/privacy).

Hosted free keys are still capped by their provider; check that provider's current pricing/quota terms. Store keys only in a trusted server environment such as local `.env.local` or Vercel Environment Variables, never in a `VITE_*` variable. If the provider returns HTTP 429, Atlas displays its real error and does not convert it to a successful result. Atlas imposes no additional AI request, token, or daily cap.

Google Search grounding is only requested for an explicitly selected Gemini provider. A report is labeled web-grounded only when the successful Gemini response contains grounding metadata. Other answers—including local Ollama and other hosted providers—are labeled **not web-grounded**. University Research for Ollama uses the public official page text the user supplies (see Part 4); it does not depend on Gemini Search.

`GET /api/status` reports optional hosted-key configuration and provider availability without returning any key values. The sidebar AI status pill opens the setup panel, where you can choose Ollama, a configured hosted provider, or clearly labeled Demo mode.

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

No AI key is required to deploy or use local Ollama. If you want an optional hosted provider, set its server-side environment variable(s) from Part 2; never use a `VITE_*` prefix for an AI key.

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
- To use local real AI, install Ollama and follow Part 2. On default Vite dev, allow `http://localhost:5173` in `OLLAMA_ORIGINS`. Atlas calls the user's browser's `http://127.0.0.1:11434` directly; the Vite and Vercel servers do not proxy local Ollama calls.
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
| Current AI feature calls through `runAI({prompt, response_json_schema, add_context_from_internet})` | Default: browser → local Ollama `/api/chat` with JSON schema support, a 16,384-token context window (`num_ctx`, so long documents are not cut off silently), and one strict retry for invalid JSON. Optional Hosted mode calls `POST /api/invoke-llm`; Gemini grounding is reported only after successful grounding metadata. With no model, the client returns clearly labeled Demo output. |
| `base44.integrations.Core.UploadPublicFile({file})` | Supabase Storage `uploads` bucket → returns `{ file_url }` (same shape) |
| `base44.entities.ApplicantKnowledge.*` (new) | `applicant_knowledge` table (AI Knowledge Base). Written by the Knowledge Base page; read by drafts and reviews |
| `base44.app.getPublicSettings()` | static `{ id, public_settings }` |

Key files: `src/api/base44Client.js` (Base44 compatibility surface) · `src/api/ollamaClient.js` (direct browser-to-loopback AI + FIFO queue) · `src/lib/ai.js` (selected-provider routing) · `src/lib/documentReader.js` (reads PDF, Word, RTF, HTML, text and web links) · `src/lib/materialJobs.js` (automatic reading and analysis) · `src/lib/applicantKnowledge.js` (AI Knowledge Base) · `src/lib/researchSource.js` (public page fetch/extraction) · `api/invoke-llm.js` (optional hosted endpoint) · `supabase/schema.sql` (database and RLS).

The `base44/` folder remains as **reference only** (the original entity schemas that `schema.sql` was derived from). Nothing reads it.

---

## Part 6 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Login says "Invalid login credentials" for a new account | Email confirmation still required and code not entered | Enter the OTP code, or turn Confirm email OFF (1.6) |
| Never receive the signup/reset email | Supabase's ~3/hour email cap, or spam folder | Check spam; configure custom SMTP (end of 1.5) |
| Google login flashes and returns to login | Redirect URL mismatch | Supabase → Auth → Redirect URLs must include `https://YOUR-APP.vercel.app/**` **and** Google's authorized redirect URI must be exactly `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` |
| Password reset link says "Invalid reset link" | Using the default Supabase email template | Apply the template in 1.5 (`?token={{ .TokenHash }}`) |
| AI setup cannot reach Ollama or `/api/tags` | Ollama is stopped, or browser CORS origin is not allowed | Set `OLLAMA_HOST=127.0.0.1:11434` and `OLLAMA_ORIGINS` to the exact Atlas browser origin (Part 2); restart Ollama and probe again |
| Local model is missing | Model has not been downloaded or the model name differs | Run `ollama pull llama3.2` (or your chosen model); select the exact name returned by `/api/tags` |
| University Research fetch fails | Public page is unavailable or blocks browser CORS | Atlas does not proxy or bypass the block. Paste the publicly visible page text and keep its official URL in the source field |
| A material says it has no readable text | Scanned or image-only PDF (no text layer); Atlas does not run OCR | Export a text-based PDF from the original, or save the document as `.docx` |
| A material says the file cannot be opened | Password-protected or damaged PDF | Remove the password or re-export the file, then re-upload it |
| A material says the file is too large | Over 30 MB | Upload a smaller copy, or split the document |
| Old Word `.doc` file is refused | Only `.docx`, RTF, HTML, text and PDF are read | Save the file as `.docx` or PDF in Word or Google Docs |
| Analysis says it did not finish | The local model returned an error or no usable answer | Check that Ollama is running and the model is available. Atlas tries again the next time you open Materials |
| A long material takes many minutes | Each 6,000-character part is one local-model call, and calls run one at a time | Wait for the progress bar on that material, or use a smaller model. Other AI actions resume when the analysis finishes |
| AI Knowledge Base says the table is missing | `applicant_knowledge` has not been created yet | Re-run `supabase/schema.sql` (idempotent). Drafts and reviews work without it in the meantime |
| Demo mode: a large upload fails with a storage error | Demo mode keeps files inside browser storage, which is limited (typically about 5 MB in total) | Use Supabase for real documents; Demo mode is for trying the app
| Hosted AI call returns HTTP 429 | The hosted provider returned its own quota/rate-limit error | Atlas displays that provider's actual error. Check provider quota/billing or select local Ollama; no key rotation or quota bypass is attempted |
| Local model returns invalid JSON | Model did not follow the existing response schema | Atlas retries once with a stricter JSON-only instruction; if still invalid, it reports the parse failure rather than substituting demo text |
| Lists come back empty though data exists | RLS: rows belong to another user | Data is per-account by design (same as Base44). Log in with the same account that created it |
| `filter({ university_name: "X" })` misses rows | Case/spacing differs | Equality match is exact (same as Base44) |
| Uploads fail with 403 | Row not in `uploads` bucket or bucket missing | Re-run `supabase/schema.sql` (idempotent) — it (re)creates the bucket and policies |

## Part 7 — Costs, limits, and data safety (honest summary)

- **Atlas AI limits:** Atlas does not add an AI request-per-minute, request-per-day, token, or daily budget. Local Ollama requests are queued in order rather than rejected when another local call is running.
- **Document analysis:** a material is read up to 200,000 characters (about 30 to 40 pages); beyond that the text is cut and the cut is marked in the stored text. The whole text is analysed, in parts of about 6,000 characters, one local-model call per part (42 parts at most). Local requests run one at a time in click order, so a long analysis delays other AI actions until it finishes.
- **Local model:** inference is performed by Ollama on the user's computer. It is not a hosted free tier; throughput and supported context size depend on that computer/model. Atlas does not expose the local Ollama port publicly.
- **Hosted providers:** any hosted provider may cap free usage, throttle requests, charge fees, or return HTTP 429. Those are the provider's rules—not an unlimited service—and Atlas displays the real provider error without bypassing it.
- **Vercel / Supabase:** their plans and operational limits still apply to hosting, database, auth, and storage; these are separate from an Atlas-imposed AI quota.
- **Backups:** export irreplaceable application data periodically. The database schema remains idempotent; re-run `supabase/schema.sql` to add the `applicant_knowledge` table (AI Knowledge Base) and the research source/provenance columns to an existing project.
- **Privacy:** Supabase data is protected by per-user RLS. Local AI prompts go from the browser directly to loopback Ollama. Optional hosted keys are server-side (never in the Vite bundle), and hosted prompts go to the selected provider; Supabase's service-role key is not used in the frontend.

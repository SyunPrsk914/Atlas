# Atlas — College Application Command Center

A private, self-hosted platform for building US/UK university applications:
deep knowledge base per college (requirements, ideal-student profile, essay
roles, Common Data Set facts), Common-App-style profile (activities/honors),
per-university roadmaps, an Essay Hub with scope awareness (e.g. the Common App
personal statement is shared by all US schools except UC/MIT), full-application
holistic review with strict acceptance estimates, and material import
(documents, links, notes) that feeds every AI feature.

## Stack

- **Frontend:** React 18 + Vite + Tailwind (shadcn/ui) — `src/`
- **Backend:** Supabase (Postgres + Auth + Storage) — `supabase/schema.sql`
- **AI:** your own LLM key (Gemini / OpenAI / Anthropic) via `api/invoke-llm.js`
  — no platform credits or token limits
- **Hosting:** Vercel (static frontend + `api/` serverless functions)

The app originally ran on Base44. A compatibility layer (`src/api/base44Client.js`)
keeps every page's `base44.*` calls working unchanged on top of Supabase.

## Quick start

```bash
npm install
npm run dev            # no configuration needed -> Demo mode (browser-only data)
```

For the real, persistent, multi-device version, follow **[DEPLOYMENT.md](./DEPLOYMENT.md)** —
a step-by-step guide (Supabase project, database schema, Google login, email
templates, LLM key, Vercel deploy) with the exact location of every key.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (also serves `/api/invoke-llm` locally) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` / `npm run typecheck` | Quality checks |

## Layout

| Path | Contents |
|---|---|
| `src/pages/` | Dashboard, Profile, Universities, UniversityDetail, ApplicationReview, EssayBuilder, Materials, KnowledgeBase, auth pages |
| `src/api/base44Client.js` | Entry point; picks Supabase or demo backend |
| `src/api/supabaseBackend.js` | Supabase implementation of the entity/auth/storage API |
| `src/api/localBackend.js` | Demo-mode implementation (localStorage) |
| `api/invoke-llm.js` | Vercel function: the AI endpoint (schema-aware, web-grounded research) |
| `supabase/schema.sql` | Database schema + RLS + storage bucket (run once in Supabase SQL Editor) |
| `base44/` | Original Base44 entity schemas — reference only |

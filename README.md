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
- **AI (default):** local Ollama model on the user's computer, called directly by the browser at `127.0.0.1:11434`
- **Optional AI:** hosted NaraRouter, Gemini, Groq, OpenRouter, OpenAI, or Anthropic key through `api/invoke-llm.js`; provider quotas and errors apply
- **Hosting:** Vercel (static frontend + optional hosted-provider function)

The app originally ran on Base44. A compatibility layer (`src/api/base44Client.js`)
keeps every page's `base44.*` calls working unchanged on top of Supabase.

## Quick start

```bash
npm install
npm run dev            # no configuration needed -> Demo mode (browser-only data)
```

Atlas itself does not impose an AI request, token, or daily quota. A hosted free key is still capped by its provider; the local Ollama path needs no hosted key and is not routed through Vercel. Follow **[DEPLOYMENT.md](./DEPLOYMENT.md)** for exact Ollama install, `ollama pull`, `OLLAMA_ORIGINS`, Supabase, and Vercel setup commands.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (also serves the optional hosted `/api/invoke-llm` function locally) |
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
| `src/api/ollamaClient.js` | Browser-to-local-Ollama client, setup persistence, JSON retry, and FIFO queue |
| `src/lib/researchSource.js` | Browser fetch and text extraction for a public admissions page |
| `api/invoke-llm.js` | Optional hosted-provider endpoint (Gemini grounding only on successful Gemini calls) |
| `supabase/schema.sql` | Database schema + RLS + storage bucket (run once in Supabase SQL Editor) |
| `base44/` | Original Base44 entity schemas — reference only |

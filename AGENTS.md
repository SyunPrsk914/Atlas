# AGENTS.md

## Project Context

Atlas — a college-application command center (React + Vite frontend, Supabase
backend, Vercel hosting, LLM via user-supplied provider keys). Originally a
Base44 app; `src/api/base44Client.js` is a drop-in compatibility layer so all
pages still call `base44.entities.* / auth.* / integrations.Core.*` while the
real backend is Supabase + a Vercel serverless function.

Start with `README.md` for local setup and `DEPLOYMENT.md` for the full
Vercel + Supabase deployment, environment variables, and key locations.

## Key Files

- `src/`: frontend application source.
- `src/api/base44Client.js`: API entry point (chooses Supabase vs demo backend).
- `src/api/supabaseBackend.js`: Supabase implementation of entities/auth/storage.
- `src/api/localBackend.js`: localStorage demo backend (no keys required).
- `api/invoke-llm.js`: serverless AI endpoint (Gemini/OpenAI/Anthropic adapters).
- `supabase/schema.sql`: database schema + RLS + storage (idempotent).
- `.env.example`: all environment variables with comments.
- `vite.config.js`: Vite config; also mounts `/api/*` in dev/preview so the AI
  endpoint works without `vercel dev`.

## Working Notes

- Keep the `base44.*` call surface stable — pages depend on its exact shapes
  (e.g. `InvokeLLM` returns a parsed object when `response_json_schema` is
  passed, a string otherwise; `UploadPublicFile` returns `{ file_url }`).
- `base44/` is reference-only (entity schemas that `schema.sql` derives from).
- Entity `filter`/`deleteMany` are exact-equality matches; `list` orders by
  `created_at`.
- Never commit secrets. Frontend config uses `VITE_*` env vars; the LLM key is
  server-only (`api/` functions).
- Run `npm run lint` and `npm run build` before finishing code changes.
- The app has a Demo mode (no env vars → localStorage backend + labeled demo AI
  output). Keep it working — it is the zero-config onboarding path.

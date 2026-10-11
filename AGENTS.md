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
- `src/lib/essayLength.js`: the length contract (target band, ceiling, hard
  floor, shared UCAS budget) and whether a repair improved the length.
- `src/lib/essayCraft.js` / `src/lib/essayPrompts.js`: how each essay type is
  written, the reader's voice, the anchored score scale, and the prompts and
  JSON schemas behind generate / review / polish / length-repair.
- `src/lib/textDiff.js`: lossless word diff used to show what an AI edit changed.
- `src/lib/activityPrompts.js`: Common App activity limits, suggestion prompts,
  and the validation that cuts a suggestion to the real form.
- `src/lib/persist.js`: browser-local cache, pre-edit snapshots, and the
  per-essay progress history (deliberately not in Postgres — no schema change).
- `scripts/verify-quality.mjs`: offline checks for all of the above.
- `scripts/render-check.mjs`: renders the essay/activity components in Node with
  the props the pages really pass them (`npm run verify:render`). Lint and build
  cannot see a missing prop; this can.
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
- Run `npm run lint`, `npm run build`, and `npm run verify` before finishing
  code changes. `verify` includes `verify:render`, so a new component is rendered
  in Node before it is committed — add a fixture for it in
  `scripts/render-check.mjs`.
- Keep the essay quality invariants intact: a draft outside its length band is
  never presented as finished, a length repair is accepted only when
  `isBetterLength` says it is closer to the band, an AI edit always leaves a
  restorable snapshot and a word-level diff, and Atlas's own word count
  (`withMeasuredLength`) wins over a model's self-reported one.
- Activities AI is suggestion-only: nothing may be written to the profile's
  activities list without an explicit Add/Apply click, and every field must stay
  inside the Common App limits from `ACTIVITY_LIMITS`.
- The app has a Demo mode (no env vars → localStorage backend + labeled demo AI
  output). Keep it working — it is the zero-config onboarding path.

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
- `api/invoke-llm.js`: serverless AI endpoint — NaraRouter first, then optional
  Gemini/Groq/OpenRouter/OpenAI/Anthropic adapters. `api/models.js` proxies the
  provider's authenticated model list so the app can offer only real aliases.
- `src/api/aiProvider.js`: AI mode (hosted or demo), the remembered model alias,
  and the FIFO queue that keeps calls one at a time.
- `src/lib/schoolFit.js`: the eleven-section shape of a university research
  report and the slice of it each AI job receives (`buildFitBrief(kind)`).
- `src/data/schoolResearch/`: the hand-researched pack, one module per school,
  official sources only, matched by `findPackEntry(name)`.
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
- `src/lib/textClip.js`: the ONLY way text is shortened for a prompt or a preview.
  Never `.slice(0, n)` a document, a knowledge item, or a generated answer: clip at
  a sentence boundary with `clipToBoundary`, or drop the item whole with `packBlocks`
  and name what did not fit. A truncated sentence in the knowledge base is a lost
  fact, and a prompt cut mid-word reads to the model as an instruction to stop early.
- `src/lib/essayRoot.js` and `src/lib/essayEditCheck.js`: Atlas verifies an AI answer
  against the instruction it was given (the root) and against the review it was asked
  to answer (the flagged phrases), instead of trusting the model's own summary. A
  check that fails is corrected once, then reported honestly to the applicant.
- `scripts/verify-instructions.mjs`: offline checks for all of the above, including
  that the pages still call these modules.
- `scripts/render-check.mjs`: renders the essay/activity components in Node with
  the props the pages really pass them (`npm run verify:render`). Lint and build
  cannot see a missing prop; this can.
- `supabase/schema.sql`: database schema + RLS + storage (idempotent).
- `.env.example`: all environment variables with comments.
- `vite.config.js`: Vite config; also mounts `/api/*` in dev/preview so the AI
  endpoint works without `vercel dev`.

## Working Notes

- There is ONE AI provider: NaraRouter, reached through `/api/invoke-llm` with
  the key on the server. Do not add a second provider path, a browser-side call
  to a model, or a silent fallback — demo mode is the only fallback and it must
  keep working with obvious placeholders that are never persisted as real.
- A review reads only the page. Never instruct a model to judge an essay against
  information from the applicant's profile, materials, or knowledge base: that
  produces "you have X but you did not include it", which no admissions officer
  can see. Outside facts may only (a) flag an invented or inflated claim and
  (b) become `optional_additions` — listed separately in the UI, phrased as
  options, and counted against no score. The polish prompt receives them as
  options it may decline.
- University research is structured: `RESEARCH_SECTIONS` in `src/lib/schoolFit.js`
  is the single source for both the research prompt's headings and the parser, so
  the two cannot drift. Prompts must call `buildFitBrief(knowledgeText, { kind })`
  rather than dumping the whole report, and a pack entry must keep all eleven
  sections with their official sources in section 11.
- The pack never overwrites stored research without an explicit confirmation, and
  it writes `research_provider = 'atlas-research-pack'` so the UI can tell a
  hand-researched report from a generated one.
- `ibSubjectLines()` returns a whole IB report (subjects, core, bonus points, HL
  summary, suggested total) — its `.length` is NOT a subject count. Use
  `ibSubjectSummary()`, which reports the six diploma slots actually filled.
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

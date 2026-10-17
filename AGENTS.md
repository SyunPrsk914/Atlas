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
  Ollama (explicit only), Gemini/Groq/OpenRouter/OpenAI/Anthropic adapters.
  `api/models.js` proxies the provider's authenticated model list (for Ollama:
  the local `/api/tags`, plus which models reason) so the app can offer only real
  models. `api/ollamaConfig.js` holds the Ollama settings, `api/ollamaChat.js`
  the streamed call to `/api/chat`, and `api/ollamaReasoning.js` the reasoning
  ("thinking") probe and trace handling; `scripts/verify-ollama.mjs` tests the
  whole path against a mock Ollama.
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
- `src/lib/backgroundTasks.js`: the ledger of AI work that must outlive its page.
  Any new long-running AI action belongs in `startBackgroundTask` (kind, label,
  scope) and persists its own result (entity API or `persist.js`) before it
  resolves — never only in a page's `useState`. `BackgroundTasksPill` in the
  Layout shows what is running; `taskForEssay` locks one essay, not the page.
- `src/lib/knowledgeService.js` / `src/lib/knowledgeAutoRefresh.js`: the
  knowledge-base jobs as background tasks (one at a time; `knowledge_busy` when
  not), and the automatic pass that keeps the base current. The automatic pass
  REFRESHES (item by item: keep / revise / remove, removals capped) and files
  materials into sections; it may rebuild only when nothing is built, never in
  Demo mode, and never in front of the applicant's own AI work. Dissected
  section rows (`data.dissected`) follow their material: replaced when it
  changes, removed when it is removed, untouched by a rebuild or a refresh.
- `src/hooks/use-drag-reorder.js`: drag-and-drop reordering on native drag
  events. Keep the arrow buttons next to it — keyboards and touch screens.
- `scripts/verify-instructions.mjs` and `scripts/verify-background.mjs`: offline
  checks for all of the above, including that the pages still call these modules.
- `scripts/render-check.mjs`: renders the essay/activity components in Node with
  the props the pages really pass them (`npm run verify:render`). Lint and build
  cannot see a missing prop; this can.
- `supabase/schema.sql`: database schema + RLS + storage (idempotent).
- `.env.example`: all environment variables with comments.
- `vite.config.js`: Vite config; also mounts `/api/*` in dev/preview so the AI
  endpoint works without `vercel dev`.

## Working Notes

- NaraRouter is the default AI provider, reached through `/api/invoke-llm` with
  the key on the server. The default model alias is `agnes-2.5-flash`
  (`NARAROUTER_MODEL` overrides it). The only other provider path is local Ollama
  (`api/ollamaConfig.js`, `LLM_PROVIDER=ollama`), an explicit opt-in that the
  server calls. Ollama is never auto-selected, never falls back to another
  model (a missing model is reported with its `ollama pull` command), and never
  receives a request from the browser. Do not add a browser-side call to a
  model, a silent provider fallback, or a third provider without the same rules.
  Demo mode is the only fallback and it must keep working with obvious
  placeholders that are never persisted as real. Local Ollama is kept working
  and tested, but docs and onboarding must present NaraRouter as the path:
  local models are multi-gigabyte downloads that can fill a machine's disk.
- Ollama reasoning models (`qwen3:8b`) are used at full depth, and four rules
  keep that true — do not undo one of them to simplify a call:
  1. `think` is sent only after `api/ollamaReasoning.js` has read the model's
     own manifest; a model that has no reasoning control never receives it
     (Ollama answers 400), and a model that refuses it is retried once without
     it. Atlas asks explicitly, so a global `/set nothink` cannot quietly remove
     the depth.
  2. The trace lives in `message.thinking` and never becomes the answer. It is
     stripped from the answer, counted in `meta.reasoning_chars`, and used only
     to recover a JSON answer a model wrote there — which is then reported as
     recovered, never passed off as normal.
  3. `num_predict` is the answer cap **plus** `OLLAMA_THINK_BUDGET` (or `-1`
     when no cap was asked for): Ollama counts reasoning and answer against one
     budget, so an answer-sized cap alone produces an empty answer.
  4. Sampling follows the model's own published thinking-mode guidance
     (temperature floor 0.6, top_p 0.95, top_k 20 — Qwen3 and DeepSeek-R1 both
     say so, and both say not to decode greedily). A change to a caller's
     temperature is recorded in `meta.sampling.raised_from`, never silent.
  The call is streamed for the same reason: Node's fetch would abort a
  generation whose headers take over 300 seconds, and a deep local run does.
- Every status message, error title and setup step names the provider the
  server actually reports (`/api/status`), never a hard-coded one. Use
  `providerLabel()` and the `setupHint()` helper in `src/lib/ai.js`.
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
- Run `npm run lint`, `npm run typecheck`, `npm run build`, and `npm run verify`
  before finishing code changes. The typecheck must report zero errors. `verify` includes `verify:render`, so a new component is rendered
  in Node before it is committed — add a fixture for it in
  `scripts/render-check.mjs`.
- Keep the essay quality invariants intact: a draft outside its length band is
  never presented as finished, a length repair is accepted only when
  `isBetterLength` says it is closer to the band, an AI edit always leaves a
  restorable snapshot and a word-level diff, and Atlas's own word count
  (`withMeasuredLength`) wins over a model's self-reported one.
- Activities AI is suggestion-only: nothing may be written to the profile's
  activities list without an explicit Add/Apply click, and every field must stay
  inside the Common App limits from `ACTIVITY_LIMITS`. The list is kept in
  submission order (slot 1 is read first) and every prompt sees it that way.
  Each activity's `keywords` field is the applicant's private ground truth for
  that entry: prompts build from it and never contradict it, and it is never
  part of a sanitized suggestion or any submitted field.
- Essay edit instructions (`essay.edit_instructions`) are binding: ranked below
  the root and above the review in every generate/polish prompt, split with
  `splitEditInstructions`, and checked against the text afterwards with
  `checkInstructionsFollowed`. An edit's re-score is compared with the score
  before it: equal is reported as unchanged, lower is restored automatically
  unless the applicant turned that off. Never present an edit as improved on
  the model's say-so.
- Knowledge-base items are person-first (`PERSON_FOCUS_RULES`): what kind of
  person the applicant is, their mindset, how they act, what they like, what
  drives them — with evidence — never a document summary or a grade.
  `looksLikeMechanicsDump` marks the failures; the refresh re-examines them
  first. Items with `origin: 'manual'` are never revised or removed by any job.
- The app has a Demo mode (no env vars → localStorage backend + labeled demo AI
  output). Keep it working — it is the zero-config onboarding path.

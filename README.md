# Atlas — College Application Command Center

A private, self-hosted platform for building US/UK university applications:
deep knowledge base per college (requirements, ideal-student profile, essay
roles, Common Data Set facts), Common-App-style profile (activities/honors),
per-university roadmaps, an Essay Hub with scope awareness (e.g. the Common App
personal statement is shared by all US schools except UC/MIT), full-application
holistic review with strict acceptance estimates, material import (PDF, Word,
RTF, HTML and text files, and web links, each read in full) that feeds every AI
feature, and an AI Knowledge Base: a deep, evidence-grounded portrait of you, separate
craft patterns from successful samples, and reusable tips/reference guidance.

## Stack

- **Frontend:** React 18 + Vite + Tailwind (shadcn/ui) — `src/`
- **Backend:** Supabase (Postgres + Auth + Storage) — `supabase/schema.sql`
- **AI:** [NaraRouter](https://router.bynara.id/docs) through `api/invoke-llm.js`, with the key on the server and the model alias chosen in the app from `api/models.js`
- **Other providers (optional):** a Gemini, Groq, OpenRouter, OpenAI or Anthropic key is still honoured if set; NaraRouter takes precedence
- **Hosting:** Vercel (static frontend plus the serverless `api/*` functions)

The app originally ran on Base44. A compatibility layer (`src/api/base44Client.js`)
keeps every page's `base44.*` calls working unchanged on top of Supabase.

## Quick start

```bash
npm install
npm run dev            # no configuration needed -> Demo mode (browser-only data)
```

Atlas needs **Node.js 22.13 or newer** (pdf.js 6, which reads PDFs, requires it).

Atlas itself does not impose an AI request, token, or daily quota — your NaraRouter plan does, and Atlas surfaces the provider's real 429 rather than working around it. Follow **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the key, the model choice, Supabase, and Vercel setup. Without a key the app runs in clearly labeled Demo mode, where every page works and no AI output is persisted as if it were real.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (also serves the optional hosted `/api/invoke-llm` function locally) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` / `npm run typecheck` | Quality checks |
| `npm run verify` | Offline checks of document reading, Materials analysis, the AI Knowledge Base, IB subject handling, the essay/activity quality rules (length bands, repair acceptance, the diff, the prompts, Common App field limits), and a render check of every new component (no browser or model needed) |
| `npm run verify:render` | Just the render check: builds the essay/activity components with Vite's SSR pipeline and renders 21 fixtures, so a component that would crash on real props is caught before it reaches the browser |

## Materials and the AI Knowledge Base

- **Materials** accept a PDF, Word (`.docx`), RTF, HTML or text file, or a web link. Atlas reads the whole document in the browser and starts the analysis as soon as the file is added; there is no Analyze button. Documents up to 200,000 characters (roughly 30 to 40 pages) are analysed in full, one local-model call per part of about 6,000 characters, so a long document can take many minutes. Local AI requests run one at a time, so other AI actions wait until an analysis finishes. Old `.doc` files and scanned or image-only PDFs cannot be read; Atlas says so and asks for another copy. Each material also has an **analysis lens**: Atlas can infer the purpose, or you can mark it as applicant evidence, a writing draft, academic work, personal context, a sample, tips/guide, or a college/application reference. The deep reader extracts literal facts, implied patterns, and what the source is useful for. Only a writing draft receives a writing score and line-level findings; an internal assessment, transcript, guide, or college data sheet is not treated as a personal essay. A sample contributes craft only, never another person's life.
- The **context box** of each material holds your notes. Text that older versions kept in a "Content" box was moved there, under its own heading, without overwriting your notes. Context helps Atlas understand why a source matters but is never analyzed as document text.
- **AI Knowledge Base** (`/ai-knowledge`) keeps dense, evidence-grounded items about you, concrete personal points, craft patterns from samples, and a separate tips/reference guidance layer. Rebuilding needs a connected provider. Items you write yourself are never removed by a rebuild, and you can edit or delete any item.

- **University Research** (`/knowledge-base`) stores one structured report per school in eleven fixed sections — admission overview, academic requirements, ideal student profile, essay requirements, programmes and majors, aid, interview, international notes, campus life and traditions, what the school's readers reward, and sources. The section list is defined once in `src/lib/schoolFit.js`: the research prompt is built from it, and every AI job receives only the sections it should judge or draft against, so a review sees the reader's lens while a draft also sees the named programmes, labs, buildings and clubs an applicant can truthfully mention.

- **The Atlas research pack** (`src/data/schoolResearch/`) is thirteen universities researched by hand from their own published pages — admission sites, department sites, catalogues and bulletins — written into those same eleven sections, with every fact attributed and anything only a third party reported labelled as such. In University Research, pick a school in the pack and load it: no key, no call, no quota. It covers Stanford (Aeronautics & Astronautics), MIT (Course 16), UC Berkeley and UCLA (Aerospace Engineering), Princeton (MAE), Michigan (Aerospace), Johns Hopkins (Mechanical, aerospace focus), Caltech (Chemical Engineering with an aerospace minor), Cornell, Columbia and NYU Tandon (chemical engineering with an aerospace minor), WashU (Chemical Engineering) and Penn (Chemical & Biomolecular Engineering with a MEAM minor). Loading it never overwrites a stored report without asking.
- Every essay has a **required root / direction** field. Use it for the moments, interests, questions, relationships, or qualities the draft must grow from. Generation treats it as a hard constraint and uses the materials to deepen it instead of choosing a random activity.

## Essay quality: what Atlas enforces

Every AI action on an essay is measured by Atlas itself, in the browser, before
the result is shown or saved. The rules live in `src/lib/` and are checked
offline by `npm run verify` (`scripts/verify-quality.mjs`).

- **A length contract, not just a ceiling.** Each essay has a target band —
  90% of its limit up to the limit itself (585–650 words for the Common App
  personal statement, 45–50 for a 50-word supplement), a hard ceiling, and a
  hard floor (60% of the limit; UCAS answers keep their official 350-character
  minimum). The three UCAS answers share one 4,000-character budget, so the band
  for one box is computed from what the other two already use. A draft outside
  its band is drawn as a banded meter in the editor, never as a plain
  "480 / 650" counter that reads like permission to stop.
- **Under-length answers are sent back.** If a generation, edit, or repair comes
  back outside the contract — or the provider reports `finish_reason: 'length'`,
  meaning the model was cut off mid-answer — Atlas asks once more, and keeps the second
  answer only if it is genuinely closer to the band. A second answer that is
  shorter than the first is thrown away. Trimming a 653-word draft down to 300
  words is not accepted as a fix.
- **Edits conserve your draft.** The editing prompt carries a prime directive to
  keep at least 80% of the applicant's own words, the specific findings from the
  last review, and the current measured length. Afterwards Atlas diffs the two
  versions word by word: AI-written or changed words are highlighted, cut words
  are struck through, and a survival rate below 45% raises an explicit warning
  instead of being presented as a normal edit.
- **Nothing is overwritten without a way back.** Before an AI action replaces
  text, the previous version (and the review that went with it) is snapshotted
  in this browser, so the editor can show "compare with the version before the
  last edit" and restore it in one click. Snapshots and revision history live in
  localStorage (`src/lib/persist.js`) — there is no schema change for them.
- **A review reads only the page.** An admissions officer sees the essay and the
  rest of the submitted file; they never see your profile fields, your uploaded
  documents, or Atlas's knowledge base. So a review scores what the sentences do,
  and never reports "you have X but you did not include it" — that would grade the
  draft against information the reader does not have, and it pushes applicants to
  bolt on content and lose the essay they wrote. Everything Atlas knows about you
  is still used, but in two places only: to flag a claim that looks invented or
  inflated, and to offer **Ideas you could consider**, which are listed separately,
  phrased as options, anchored to a place in the draft, and counted against no
  score. The editing prompt receives them the same way — as options it may decline.

- **Scores are comparable.** One rubric of seven dimensions (prompt alignment,
  authenticity, specificity, structure, voice, risk, length) with anchored
  definitions of what 10/10 means, the previous review embedded in the prompt so
  a re-review is a comparison rather than a fresh guess, and a per-essay progress
  timeline showing words and score before → after for every action. An edit can
  re-score automatically; if the score falls, Atlas says so and offers the
  restore.
- **Atlas counts the words.** A model's own word count is discarded and replaced
  with a measured one, so the review panel can never contradict the editor.
- **Craft and voice come from the materials.** Each prompt carries the job of
  that essay type (the personal statement is one story moving forward in time,
  no side quests), the detected shape of the supplement question, and the voice
  of the reader — Oxbridge, UK, UC, highly selective private, large public,
  liberal arts — plus the sample essays and guidance you uploaded, used as craft
  only and never as borrowed biography. A school-specific supplement on a shared
  platform is still allowed to name the school.
- **Activities suggestions are suggestions.** The Profile page can read your
  materials and propose Common App activity entries, sharpen one entry's wording,
  or review the order of the list. Each result shows the evidence it came from, a
  confidence level, and the character count it would take; nothing is written
  until you press Add or Apply. Fields are cut to the real Common App limits
  (10 entries, 50 / 100 / 150 characters) at word boundaries, and the cut is
  reported rather than silent. The editor itself no longer truncates as you type:
  a field past its limit turns red and offers a deliberate Trim.

## Layout

| Path | Contents |
|---|---|
| `src/pages/` | Dashboard, Profile, Universities, UniversityDetail, ApplicationReview, EssayBuilder, Materials, AiKnowledge (AI Knowledge Base), KnowledgeBase (University Research), auth pages |
| `src/api/base44Client.js` | Entry point; picks Supabase or demo backend |
| `src/api/supabaseBackend.js` | Supabase implementation of the entity/auth/storage API |
| `src/api/localBackend.js` | Demo-mode implementation (localStorage) |
| `src/api/aiProvider.js` | AI mode (hosted or demo), the remembered model alias, and the FIFO queue that keeps calls one at a time |
| `src/api/llmClient.js` | Calls `/api/invoke-llm`, `/api/status` and `/api/models`; maps `finish_reason` to `meta.truncated` |
| `src/lib/schoolFit.js` | The eleven-section shape of a university research report, and the slice each AI job is allowed to see |
| `src/data/schoolResearch/` | The hand-researched pack: thirteen universities, official sources only, each entry parsed by `schoolFit` |
| `src/lib/researchSource.js` | Browser fetch and text extraction for a public admissions page |
| `src/lib/documentReader.js` | Reads an uploaded PDF, Word (.docx), RTF, HTML or text file, or a web link, into plain text (pdf.js loads only when a PDF is read) |
| `src/lib/materialJobs.js` | Reads and analyzes each material automatically, one at a time, and keeps each saved result in step with its file |
| `src/lib/applicantKnowledge.js` | Builds and reads the AI Knowledge Base: deep About you items, personal points, sample craft patterns, and tips/reference guidance |
| `src/lib/essayLength.js` | The length contract: target band, ceiling, hard floor, the shared UCAS budget, and whether a repair actually improved the length |
| `src/lib/essayCraft.js` | How each essay type is written, the shapes of supplement questions, the voice of each kind of reader, the anchored 1–10 scale, and the seven review dimensions |
| `src/lib/essayPrompts.js` | Builds the generate / review / polish / length-repair prompts and their JSON schemas; stamps Atlas's own word count onto a review |
| `src/lib/textDiff.js` | Lossless word diff, preservation statistics, and the aggressive-rewrite test |
| `src/lib/activityPrompts.js` | Common App activities limits, the prompts behind the suggestions, and validation that cuts a suggestion to the real form |
| `src/lib/persist.js` | Browser-local cache: last selection, reviews, draft analyses, pre-edit snapshots, per-essay progress history, and preferences |
| `src/components/essay/` | `LengthMeter`, `EssayDiffView`, `RevisionProgress`, `EssayReviewPanel`, `UcasStatementEditor`, `PromptChooser` |
| `api/invoke-llm.js` | Optional hosted-provider endpoint (Gemini grounding only on successful Gemini calls) |
| `supabase/schema.sql` | Database schema + RLS + storage bucket (run once in Supabase SQL Editor) |
| `base44/` | Original Base44 entity schemas — reference only |

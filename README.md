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
- **AI:** [NaraRouter](https://router.bynara.id/docs) through `api/invoke-llm.js`, with the key on the server and the model alias chosen in the app from `api/models.js`. The default alias is `agnes-2.5-flash` — the model the analysis, drafting, and review prompts are tuned around
- **Hosting:** Vercel (static frontend plus the serverless `api/*` functions)
- **Local AI (optional, last resort):** [Ollama](https://ollama.com) can run a model on your own computer when `LLM_PROVIDER=ollama` is set (never chosen automatically; see DEPLOYMENT.md, Part 2.7). It works — reasoning models such as `qwen3:8b` are used at full depth — but every model is a multi-gigabyte download that stays on disk, and a loaded model reserves gigabytes of memory on every call. That footprint is what once filled a machine and broke the app, so the supported path is NaraRouter; see the warning at the top of [LOCAL_SETUP.md](./LOCAL_SETUP.md) before opting in
- **Other providers (optional):** a Gemini, Groq, OpenRouter, OpenAI or Anthropic key is still honoured if set; NaraRouter takes precedence

The app originally ran on Base44. A compatibility layer (`src/api/base44Client.js`)
keeps every page's `base44.*` calls working unchanged on top of Supabase.

## Quick start

```bash
npm install
npm run dev            # no configuration needed -> Demo mode (browser-only data)
```

Atlas needs **Node.js 22.13 or newer** (pdf.js 6, which reads PDFs, requires it).

The AI runs on **NaraRouter**, reached through the deployment's own server
function — follow **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the key, the model
choice (`agnes-2.5-flash` by default), Supabase, and Vercel. There is nothing to
download: the hosted path needs one API key and no local model.

Atlas itself does not impose an AI request, token, or daily quota — your NaraRouter plan does, and Atlas surfaces the provider's real 429 rather than working around it. Without a key the app runs in clearly labeled Demo mode, where every page works and no AI output is persisted as if it were real.

> **About running the AI on your own computer.** [LOCAL_SETUP.md](./LOCAL_SETUP.md) still exists for machines that deliberately want a local model (Ollama, opt-in via `LLM_PROVIDER=ollama`). Read its warning first: each model is a multi-gigabyte download that stays on disk until you delete it, and a loaded model plus its context window can exhaust a machine's disk and memory. It is not needed for Atlas — NaraRouter does the same work with no downloads — and it cannot run on Vercel.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (also serves the optional hosted `/api/invoke-llm` function locally) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` / `npm run typecheck` | Quality checks |
| `npm run verify` | Offline checks of document reading, Materials analysis, the AI Knowledge Base, IB subject handling, the AI instruction rules (the shared clipping rule, material relevance and prompt budgets, knowledge-base density, the root check, the flagged-phrase edit loop), the essay/activity quality rules (length bands, repair acceptance, the diff, the prompts, Common App field limits), the local Ollama provider (its request shape, reasoning models, and every failure a local user can hit), the background layer (the task ledger, edit instructions and their check, activity keywords/ratings/order, drag reordering, refresh-not-rebuild and the person-first filter), the deep-linking rules (a filed item keeps its section and its evidence, a craft rule stays with the kind of writing that governs it, an edit is judged and sent back before you read it, a re-examination queues), and a render check of every component (no browser or model needed) |
| `npm run verify:render` | Just the render check: builds the essay/activity components with Vite's SSR pipeline and renders every fixture, so a component that would crash on real props is caught before it reaches the browser |

## Materials and the AI Knowledge Base

- **Materials** accept a PDF, Word (`.docx`), RTF, HTML or text file, or a web link. Atlas reads the whole document in the browser and starts the analysis as soon as the file is added; there is no Analyze button. Documents up to 200,000 characters (roughly 30 to 40 pages) are analysed in full, one model call per part of about 6,000 characters, so a long document can take many minutes. AI requests run one at a time through a shared queue, so other AI actions wait until an analysis finishes. Old `.doc` files and scanned or image-only PDFs cannot be read; Atlas says so and asks for another copy. Each material also has an **analysis lens**: Atlas can infer the purpose, or you can mark it as applicant evidence, a writing draft, academic work, personal context, a sample, tips/guide, or a college/application reference. The deep reader extracts literal facts, implied patterns, and what the source is useful for. Only a writing draft receives a writing score and line-level findings; an internal assessment, transcript, guide, or college data sheet is not treated as a personal essay. A sample contributes craft only, never another person's life.
- The **context box** of each material holds your notes. Text that older versions kept in a "Content" box was moved there, under its own heading, without overwriting your notes. Context helps Atlas understand why a source matters but is never analyzed as document text.
- **AI Knowledge Base** (`/ai-knowledge`) keeps dense, evidence-grounded items about you, concrete personal points, craft patterns from samples, and a separate tips/reference guidance layer. Every item is held to a **person-first** standard: what kind of person you are, your core mindset, how you act, what you like, and what drives you — with the evidence attached — never a summary of a document or a grade. Explicit statements of your values in your own materials are treated as the most valuable evidence there is. An item that reads like assessment mechanics ("in the IA, annotates Trial 21 as an outlier…") — or like a quantified achievement copied from a résumé ("Achieved a specific impulse of 210 seconds… a result named in both the essay context and the preparation draft") — is marked on the page and re-examined first: the same sentence in Personal points is exactly what belongs there, but in About you it is a filing mistake, not a personality. Items you write yourself are never changed by any AI job, and you can edit or delete any item.
- **Refresh, not rebuild.** **Refresh** re-examines the saved items one by one against the sources as they are now and keeps, rewrites, re-files, or removes each (removals are capped per pass; a re-file writes the destination copy before the original goes, so a true fact is never destroyed for being filed in the wrong section), then adds only what is missing. **Go deeper** reads the same sources again and only appends what the first pass missed. **Rebuild** starts the portrait over and asks before it does. The base is kept compact: a refresh may not leave it longer unless the sources grew.
- **It keeps itself current.** When your profile, a material, or a draft changes, Atlas waits for your own AI work to finish, then files new materials into sections and refreshes the items in the background (`src/lib/knowledgeAutoRefresh.js`). The switch, an **Update now** button, and the outcome of the last automatic pass are on the page. Automatic passes never run in Demo mode.
- **Materials are dissected into sections.** A long material — a full successful application, say — is split into the parts that belong to one school, one essay type, one platform, or one task (a "Stanford" school section, a "Roommate essay" section, an "Activities list" section), and each part is filed with that scope. A draft reads only the sections that match its school and essay kind; the full application review reads the school sections to judge fit; a sample's life is never treated as yours. Your own story is never filed under a school either: an insight drawn from your past writing or notes belongs to every application, so a university named in that kind of text is content, not a filing address — only school-specific guides, requirements, and material you explicitly targeted at a school carry a school binding. Every item also carries the passage it rests on, so a link between two facts can be checked against the words that make it true. Two facts next to each other are never a cause: an achievement, the event it happened at, a number, and a quality are four separate items unless the material itself says one produced the other, and a school, course, or club named in passing never becomes a document's subject. A rule lifted from one kind of writing is filed with that kind — `applies_to` becomes `data.shape_keys`, and a personal-statement structure is withheld from a why-us essay, a 40-word box, and an activities list. The page lists the filed sections by material, and a section follows its material: it is replaced when the material changes, removed when the material is removed, and left alone by a rebuild.
- **How many items it should hold** is derived from how much you gave it: each kind has a floor per source and a ceiling per build, so forty documents are not allowed to produce one personality trait and four facts. The page shows the counts per category, says which part is thinner than the sources support, and flags any item that ends mid-sentence.
- **Questions Atlas can ask you.** The panel at the top of `/ai-knowledge` asks only what the file cannot answer — the missing number, the actual role, the reason behind the choice — and files every answer into the knowledge base: the answer itself as an item *you* wrote (no model needed), plus, when a model is connected, a read-between-the-lines pass that turns the same answer into portrait items and extra personal points. A filed answer is **reference, never an obligation**: every drafting and review prompt is told to use it where it strengthens the piece and leave it out where it does not. Only an answer you mark **must include** becomes an instruction, and prompts are told to honour that one. Re-answer an exchange and its filed items are rebuilt from the new wording; remove the exchange and they go with it. The question list lives in this browser; the knowledge items live in your account like every other item.
- **Re-examining a material queues, it does not block.** "Re-examine sections" on a material, or "Re-examine all" on the shelf, starts one job per material in the order you pressed them and runs them one at a time — like the materials analysis queue — so a dozen sources is a dozen clicks with no waiting in between. Each material's line carries its own status (`Queued`, `Re-examining`, `Saved`, `Could not re-examine`), a waiting one can be taken back out, a failure on one never stops the rest, and asking again while a material is being read re-reads it afterwards so a file you changed mid-flight is never left stale. Nothing is refused because another job happens to be running (`src/lib/dissectionQueue.js`).
- Sections collapse, items are grouped under their category heading, and one search box filters every kind at once. An item scoped to one university, essay, platform, or task is offered only to that context: drafting a Stanford supplement never reads a UCAS item, and a UCAS item never reaches a US review.

- **University Research** (`/knowledge-base`) stores one structured report per school in eleven fixed sections — admission overview, academic requirements, ideal student profile, essay requirements, programmes and majors, aid, interview, international notes, campus life and traditions, what the school's readers reward, and sources. The section list is defined once in `src/lib/schoolFit.js`: the research prompt is built from it, and every AI job receives only the sections it should judge or draft against, so a review sees the reader's lens while a draft also sees the named programmes, labs, buildings and clubs an applicant can truthfully mention.

- **The Atlas research pack** (`src/data/schoolResearch/`) is thirteen universities researched by hand from their own published pages — admission sites, department sites, catalogues and bulletins — written into those same eleven sections, with every fact attributed and anything only a third party reported labelled as such. In University Research, pick a school in the pack and load it: no key, no call, no quota. It covers Stanford (Aeronautics & Astronautics), MIT (Course 16), UC Berkeley and UCLA (Aerospace Engineering), Princeton (MAE), Michigan (Aerospace), Johns Hopkins (Mechanical, aerospace focus), Caltech (Chemical Engineering with an aerospace minor), Cornell, Columbia and NYU Tandon (chemical engineering with an aerospace minor), WashU (Chemical Engineering) and Penn (Chemical & Biomolecular Engineering with a MEAM minor). Loading it never overwrites a stored report without asking.
- An essay is written against the **rest of the file**: the other essays in the application (their titles, schools, and how each one begins) are put in front of the drafting and editing prompts, because one story belongs to one essay — a scene already told in the personal statement is not spent again in a 40-word box, and an image is never reused between pages. The review never sees that list: no page is scored down for what another page contains.
- Every essay has a **required root / direction** field. Use it for the moments, interests, questions, relationships, or qualities the draft must grow from. Generation treats it as a hard constraint and uses the materials to deepen it instead of choosing a random activity.
- Atlas reads that direction as an instruction, not as a keyword list: `src/lib/essayRoot.js` decides whether it asks for ONE of several options or requires all of them, lists the options it found, and shows you that reading under the box while you type. The model is told the same reading, then the finished draft is checked against it word by word. A draft that ignored the direction, or that crammed every listed option in anyway, is sent back once for a correction before you ever see it.
- An edit is measured the same way: the phrases the last review quoted are looked for in the text that comes back. Whatever is still there is listed under the comparison, with a **Fix what is still flagged** button that runs a second edit on those phrases only. A phrase the editor deliberately kept appears with its reason, and the score before and after the edit is printed on the comparison instead of only in a toast.
- Under the root there is an **edit instructions** box: your own list of exactly what to change ("cut the sentence about…", "keep 'the smell of solder' word for word", "replace 'very big' with 'forty-metre'"). Every sentence in it is binding, ranked below the root and above the review's suggestions, and never "interpreted" into something easier. After the edit Atlas checks each instruction against the text itself — a phrase you asked to cut must be gone, a phrase you asked to keep must survive — and lists the ones that were missed, with a button to run them again. An instruction is never declined into an answer: a style direction can always be obeyed in wording, and an instruction that collides with the length contract or with your own root is done as far as that collision allows and the reason is printed. A refusal is counted as an instruction not carried out and sent back with the rest.
- **An edit has to be better, and it is judged before you read it.** An answer that keeps less than 80% of your own words is a rewrite, not an edit: it is sent back once with the reason, and if the second answer still overwrites your draft it is not applied at all — it is kept under the comparison for reference while your version stays in the editor. (Asking for the bigger change yourself is the one thing that lifts that floor.) A second edit after a full review is held to the same floor and the same re-measurement as the first. Then the re-score is compared with the score before it: an edit that scores the same is kept only when everything it was asked to answer is answered, and is reported as unchanged rather than "improved"; an edit that scores lower — or that scores the same while your instructions or the flagged phrases are still open — is restored to your version automatically (a switch next to the editor turns that off), and the comparison says why in the same words the check used.
- **AI work runs in the background.** Drafting, reviewing, editing, the full application review, the activities list jobs, and every knowledge-base job are tasks that keep running when you open another page. The sidebar shows what is running; the essay list marks the essay being worked on while every other essay stays editable; a result that lands while you are elsewhere is waiting when you come back.

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
  or review the list. Each result shows the evidence it came from, a
  confidence level, and the character count it would take; nothing is written
  until you press Add or Apply. Fields are cut to the real Common App limits
  (10 entries, 50 / 100 / 150 characters) at word boundaries, and the cut is
  reported rather than silent. The editor itself no longer truncates as you type:
  a field past its limit turns red and offers a deliberate Trim.
- **The order is yours, and it is read.** Drag an activity by its grip (or use
  the arrows) to any slot; an admissions reader reads the first entries properly
  and skims the rest, so every prompt sees the list in submission order and the
  list review judges the opening first, rates each entry 1–5 on the rubric it is
  given (initiative, impact, commitment, skill, vividness), scores the list as a
  whole, and explains the order it recommends. University cards drag the same way.
- **Keywords, so nothing is invented.** Each activity has a private keywords box
  (facts, numbers, names in shorthand) that is never submitted and never shown
  to a reader. Sharpening builds from those keywords before anything else;
  "Suggest activities" has its own keywords box for what is missing from the
  list. A fact that is in neither the keywords, the entry, the profile, nor the
  materials does not exist to the model.
- **Honors get the same sharpening, and nothing more.** The honors list has no
  suggestion feature by design — the applicant asked for sharper wording, not new
  entries. Each honor can be sharpened (or the whole list in one job) so its
  name carries the official title, the tier, and the stated scale inside the
  real 100-character box; every honor also has a private note box, and a note
  for the whole list sits above it. A sharpen rewrites the name only — grade
  level and recognition level are facts only you know — cites where each added
  word came from, shows the change as a word diff, says so plainly when the
  name already works (no change is never presented as an improvement), and is
  applied only when you press Apply.

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
| `src/lib/applicantQA.js` | The Q&A layer: gap-driven questions, the read-between-the-lines pass over an answer, and the filing rules that keep answers reference-unless-marked-instruction |
| `src/lib/honorPrompts.js` | The Common App honors limits, how the section is read, and the sharpen-only prompt that rewrites a honor name from stated facts |
| `src/lib/essayLength.js` | The length contract: target band, ceiling, hard floor, the shared UCAS budget, and whether a repair actually improved the length |
| `src/lib/essayCraft.js` | How each essay type is written, the shapes of supplement questions, the voice of each kind of reader, the anchored 1–10 scale, and the seven review dimensions |
| `src/lib/essayPrompts.js` | Builds the generate / review / polish / length-repair prompts and their JSON schemas; stamps Atlas's own word count onto a review |
| `src/lib/textDiff.js` | Lossless word diff, preservation statistics, and the aggressive-rewrite test |
| `src/lib/textClip.js` | The one clipping rule every prompt uses: cut at a sentence boundary, say how much was left out, and drop or keep whole items rather than half an item |
| `src/lib/essayRoot.js` | Reads the applicant's direction as an instruction (choose one / include all / one idea), then checks a finished draft against it |
| `src/lib/essayEditCheck.js` | Which phrases the review objected to are still in the text after an edit, and which of the applicant's edit instructions were carried out |
| `src/lib/backgroundTasks.js` | The ledger of AI work that outlives its page (essay jobs, the full review, activities jobs, knowledge-base jobs); the sidebar pill and the per-essay lock read it |
| `src/lib/knowledgeService.js` | The knowledge-base jobs as background tasks: rebuild, go deeper, item-by-item refresh, and filing materials into sections |
| `src/lib/knowledgeAutoRefresh.js` | Keeps the knowledge base current on its own: debounced, never in Demo mode, never in front of the applicant's own AI work, refresh rather than rebuild |
| `src/hooks/use-drag-reorder.js` | Drag-and-drop reordering on the browser's own drag events, shared by the activities list and the university cards |
| `src/lib/materialRole.js` | What each material is for, how strongly it belongs to the current school/essay/task, and how much of it a prompt may hold |
| `src/lib/activityPrompts.js` | Common App activities limits, the prompts behind the suggestions, and validation that cuts a suggestion to the real form |
| `src/lib/persist.js` | Browser-local cache: last selection, reviews, draft analyses, pre-edit snapshots, per-essay progress history, and preferences |
| `src/components/essay/` | `LengthMeter`, `EssayDiffView`, `RevisionProgress`, `EssayReviewPanel`, `UcasStatementEditor`, `PromptChooser` |
| `api/invoke-llm.js` | Optional hosted-provider endpoint (Gemini grounding only on successful Gemini calls) |
| `supabase/schema.sql` | Database schema + RLS + storage bucket (run once in Supabase SQL Editor) |
| `base44/` | Original Base44 entity schemas — reference only |

# Atlas — College Application Command Center

A private, self-hosted platform for building US/UK university applications:
deep knowledge base per college (requirements, ideal-student profile, essay
roles, Common Data Set facts), Common-App-style profile (activities/honors),
per-university roadmaps, an Essay Hub with scope awareness (e.g. the Common App
personal statement is shared by all US schools except UC/MIT), full-application
holistic review with strict acceptance estimates, material import (PDF, Word,
RTF, HTML and text files, and web links, each read in full) that feeds every AI
feature, and an AI Knowledge Base: a short profile of you, and the patterns that
successful applications share, built from your own material.

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

Atlas needs **Node.js 22.13 or newer** (pdf.js 6, which reads PDFs, requires it).

Atlas itself does not impose an AI request, token, or daily quota. A hosted free key is still capped by its provider; the local Ollama path needs no hosted key and is not routed through Vercel. Follow **[DEPLOYMENT.md](./DEPLOYMENT.md)** for exact Ollama install, `ollama pull`, `OLLAMA_ORIGINS`, Supabase, and Vercel setup commands.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server (also serves the optional hosted `/api/invoke-llm` function locally) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` / `npm run typecheck` | Quality checks |
| `npm run verify` | Offline checks of document reading, Materials analysis, the AI Knowledge Base, and IB subject handling (no browser or model needed) |

## Materials and the AI Knowledge Base

- **Materials** accept a PDF, Word (`.docx`), RTF, HTML or text file, or a web link. Atlas reads the whole document in the browser and starts the analysis as soon as the file is added; there is no Analyze button. Documents up to 200,000 characters (roughly 30 to 40 pages) are analysed in full, one local-model call per part of about 6,000 characters, so a long document can take many minutes. Local AI requests run one at a time, so other AI actions wait until an analysis finishes. Old `.doc` files and scanned or image-only PDFs cannot be read; Atlas says so and asks for another copy.
- The **context box** of each material holds your notes. Text that older versions kept in a "Content" box was moved there, under its own heading, without overwriting your notes.
- **AI Knowledge Base** (`/ai-knowledge`) lists what Atlas understands about you and what successful applications look like. Rebuilding needs a connected local model. Items you write yourself are never removed by a rebuild, and you can edit or delete any item.

## Layout

| Path | Contents |
|---|---|
| `src/pages/` | Dashboard, Profile, Universities, UniversityDetail, ApplicationReview, EssayBuilder, Materials, AiKnowledge (AI Knowledge Base), KnowledgeBase (University Research), auth pages |
| `src/api/base44Client.js` | Entry point; picks Supabase or demo backend |
| `src/api/supabaseBackend.js` | Supabase implementation of the entity/auth/storage API |
| `src/api/localBackend.js` | Demo-mode implementation (localStorage) |
| `src/api/ollamaClient.js` | Browser-to-local-Ollama client, setup persistence, JSON retry, and FIFO queue |
| `src/lib/researchSource.js` | Browser fetch and text extraction for a public admissions page |
| `src/lib/documentReader.js` | Reads an uploaded PDF, Word (.docx), RTF, HTML or text file, or a web link, into plain text (pdf.js loads only when a PDF is read) |
| `src/lib/materialJobs.js` | Reads and analyzes each material automatically, one at a time, and keeps each saved result in step with its file |
| `src/lib/applicantKnowledge.js` | Builds and reads the AI Knowledge Base: about you, personal points, and successful-application patterns |
| `api/invoke-llm.js` | Optional hosted-provider endpoint (Gemini grounding only on successful Gemini calls) |
| `supabase/schema.sql` | Database schema + RLS + storage bucket (run once in Supabase SQL Editor) |
| `base44/` | Original Base44 entity schemas — reference only |

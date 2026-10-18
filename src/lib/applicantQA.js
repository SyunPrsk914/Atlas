// "Questions Atlas asks you" — the interview layer of the AI Knowledge Base.
//
// The strategist's complaint was that the app only works with what has already
// been typed in, while the facts that make an application land ("how many
// people did the community actually grow by?", "what was your specific role and
// how did you end up there?") often exist only in the applicant's head. This
// module closes that loop: Atlas asks a few focused questions, the applicant
// answers in their own words, and every accepted answer is filed into the
// knowledge base — the answer itself as an item the applicant wrote, plus (when
// a model is connected) a read-between-the-lines pass that turns the same answer
// into portrait items and reusable facts.
//
// The policy the applicant set is explicit and is enforced in two places:
//   - an answer is REFERENCE, never binding: an item built from a Q&A answer
//     carries `data.from_qa`, and every prompt that reads it is told to use it
//     where it strengthens the piece and leave it out where it does not (see
//     `qaNote` in applicantKnowledge.js);
//   - an answer marked "must include" carries `data.include` too, and the same
//     prompts are told it is an APPLICANT INSTRUCTION that must be honoured.
//
// The question list is this browser's working record (persist.js, like essay
// snapshots); the durable artefacts are the knowledge rows, which live in
// Postgres, are editable in every panel, and survive rebuilds because they are
// written as the applicant's own items. No new table, no schema change.
//
// Pure module: prompts, schemas, normalisation, row building, and the store. The
// UI wires them to runAI and the entity API.

import { ABOUT_CATEGORIES, POINT_CATEGORIES, nearDuplicate, wordSet } from './applicantKnowledge';
import { clipToBoundary } from './textClip';
import { getStored, setStored } from './persist';

/** Where one question's answer will be put to use, as shown on its badge. */
export const QA_FEEDS = {
  activities: 'Activities list',
  honors: 'Honors',
  essays: 'Essays',
  knowledge: 'Knowledge base',
  other: 'General context',
};

/** Answers and questions not touched in this long are archived in the store. */
export const QA_STORE_KEY = 'applicantQa:v1';
/** The most questions Atlas keeps open at one time. */
export const QA_MAX_OPEN = 6;
/** The most questions one generation pass may propose. */
export const QA_ASK_LIMIT = 5;

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// The store (this browser). Each entry:
//   { id, question, why, feeds, asked_at, status: 'open' | 'answered' | 'dismissed',
//     answer, include, answered_at, row_ids: string[],
//     analysis: { status: 'pending' | 'done' | 'deferred' | 'failed', insights, facts, note } }
// ---------------------------------------------------------------------------

export function loadQaEntries() {
  const saved = getStored(QA_STORE_KEY, null);
  if (!saved || !Array.isArray(saved.entries)) return [];
  return saved.entries
    .filter((entry) => entry && typeof entry === 'object' && clean(entry.question))
    .map((entry) => ({
      id: clean(entry.id) || `qa-${Date.now().toString(36)}`,
      question: clean(entry.question),
      why: clean(entry.why),
      feeds: QA_FEEDS[entry.feeds] ? entry.feeds : 'knowledge',
      asked_at: clean(entry.asked_at),
      status: ['open', 'answered', 'dismissed'].includes(entry.status) ? entry.status : 'open',
      answer: clean(entry.answer),
      include: entry.include === true,
      answered_at: clean(entry.answered_at),
      row_ids: Array.isArray(entry.row_ids) ? entry.row_ids.map((id) => String(id)).filter(Boolean) : [],
      analysis: entry.analysis && typeof entry.analysis === 'object' ? entry.analysis : null,
    }));
}

export function saveQaEntries(entries) {
  const list = Array.isArray(entries) ? entries : [];
  // Keep at most the newest 40 exchanges so the store cannot grow without
  // bound; answered rows have already been promoted into the knowledge base.
  setStored(QA_STORE_KEY, { entries: list.slice(-40) });
  return list;
}

/** Add newly generated questions, skipping any that restates a live one. */
export function mergeQuestions(entries, questions) {
  const live = entries.filter((entry) => entry.status !== 'dismissed').map((entry) => wordSet(entry.question));
  const asked = new Set(entries.filter((entry) => entry.status === 'open').map((entry) => entry.question.toLowerCase()));
  const now = new Date().toISOString();
  const fresh = [];
  for (const question of questions) {
    const text = clean(question.question);
    if (!text || asked.has(text.toLowerCase()) || nearDuplicate(text, live)) continue;
    asked.add(text.toLowerCase());
    live.push(wordSet(text));
    fresh.push({
      id: `qa-${now}-${fresh.length}-${Math.random().toString(36).slice(2, 8)}`,
      question: text,
      why: clean(question.why),
      feeds: QA_FEEDS[question.feeds] ? question.feeds : 'knowledge',
      asked_at: now,
      status: 'open',
      answer: '',
      include: false,
      answered_at: '',
      row_ids: [],
      analysis: null,
    });
    if (entries.filter((entry) => entry.status === 'open').length + fresh.length >= QA_MAX_OPEN) break;
  }
  return { entries: [...entries, ...fresh], added: fresh.length };
}

export function patchQaEntry(entries, id, patch) {
  return entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
}

export function removeQaEntry(entries, id) {
  return entries.filter((entry) => entry.id !== id);
}

/** Open questions, oldest first — the applicant should finish what was asked. */
export function openQuestions(entries) {
  return entries.filter((entry) => entry.status === 'open');
}

/** Answered entries whose between-the-lines pass has not run (or should rerun). */
export function pendingAnalysis(entries) {
  return entries.filter((entry) => entry.status === 'answered' && (!entry.analysis || entry.analysis.status === 'pending' || entry.analysis.status === 'failed'));
}

// ---------------------------------------------------------------------------
// 1. Asking: the questions a professional strategist would actually ask
// ---------------------------------------------------------------------------

export const QA_QUESTIONS_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          why: { type: 'string' },
          feeds: { type: 'string', enum: Object.keys(QA_FEEDS) },
        },
      },
    },
  },
};

/**
 * Prompt for question generation.
 *
 * The model sees the portrait, the lists, and the saved sources — so what it
 * asks is what is genuinely missing, not a generic questionnaire. Every answer
 * must earn its place: a question is only worth asking when the answer would
 * change how a specific section reads.
 */
export function buildQaQuestionsPrompt({
  profileText = '', knowledgeText = '', materialsNote = '', limit = QA_ASK_LIMIT,
}) {
  return `You are a senior college-admission strategist preparing one short round of clarifying questions for an applicant. Your job is not to interview for its own sake: you ask ONLY about what the current file cannot answer, because that one answer will make a specific essay, activity entry, or honor line land.

THE APPLICANT'S FILE AS ATLAS KNOWS IT
PROFILE (form data)
${profileText || '(no profile saved)'}

WHAT THE KNOWLEDGE BASE ALREADY SAY ABOUT THEM (never re-ask something answered here)
${knowledgeText || '(the knowledge base is empty — ask for the raw material a first portrait needs)'}

SOURCES ON FILE
${materialsNote || '(no materials beyond the profile)'}

HOW TO CHOOSE THE QUESTIONS
- At most ${limit}. Fewer is better: two questions the applicant actually answers beat six they skim past. If the file is genuinely complete, return an empty list.
- Each question targets ONE specific gap that shows up in drafting: a missing number ("how many students attended the workshops you ran?"), a missing role or origin story ("what was your specific role, and how did you end up there?"), a missing motive or consequence ("what did you do after the first event floored, and why did you keep going?"), a detail the activities list or honors list undersells.
- Ask so the answer is usable verbatim: one concrete fact per question, no compound questions, no essay prompts, nothing the applicant cannot type in two or three sentences.
- Never ask for grades, scores, test results, or anything the profile already holds; never ask a question whose answer could not change how a section reads.
- "why" is one sentence telling the applicant what the answer unlocks ("so the WSC entry can show impact instead of a duty list"). "feeds" is the section the answer will strengthen: activities, honors, essays, knowledge, other.
- You are not gathering facts to force into every essay — answers the applicant gives are reference material, and they decide what becomes binding. Say nothing about scoring or chances.

Return JSON only: {"questions": [{"question": "...", "why": "...", "feeds": "activities|honors|essays|knowledge|other"}]}`;
}

const OPENERS = /^(who|what|when|where|why|how|which|whose|did|do|does|are|is|was|were|can|could|would|should|tell|please|describe|give|name|list|explain|walk)\b/i;

export function normalizeQuestions(raw, { limit = QA_ASK_LIMIT } = {}) {
  const list = Array.isArray(raw?.questions) ? raw.questions : [];
  const out = [];
  for (const item of list) {
    const question = clean(item?.question);
    if (!question || question.length < 12 || question.length > 320) continue;
    // A question should look like one: end in "?" or open with a question or
    // request verb. Anything else is the model writing an essay about a gap.
    if (!/\?$/.test(question) && !OPENERS.test(question)) continue;
    out.push({
      question,
      why: clean(item?.why).slice(0, 240),
      feeds: QA_FEEDS[item?.feeds] ? item.feeds : 'knowledge',
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Learning from an answer: the read-between-the-lines pass
// ---------------------------------------------------------------------------

export const QA_ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: Object.keys(ABOUT_CATEGORIES) },
          text: { type: 'string' },
        },
      },
    },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: Object.keys(POINT_CATEGORIES) },
          text: { type: 'string' },
        },
      },
    },
    note: { type: 'string' },
  },
};

/**
 * Prompt for reading one answer.
 *
 * The answer text itself is already filed as a personal point (no model needed).
 * This pass adds what the answer IMPLIES: a portrait observation tied to the
 * wording the applicant chose, and any concrete facts buried inside it that the
 * file did not have. Two guards, both the applicant's: never inflate what they
 * said into a claim they did not make, and never treat the answer as something
 * that must then appear everywhere.
 */
export function buildQaAnswerPrompt({ entry, profileText = '', knowledgeText = '' }) {
  return `You are a senior college-admission strategist reading ONE answer a college applicant gave to a clarifying question. You extract from it only; you never add to it.

THE QUESTION
${entry.question}

THE APPLICANT'S ANSWER (their own words — this exact text is already saved as a personal point; do not restate it as a fact)
${entry.answer}

${profileText ? `PROFILE (form data)\n${clipToBoundary(profileText, 6000)}\n` : ''}${knowledgeText ? `WHAT ATLAS ALREADY KNOWS (do not repeat an item that already covers this)\n${clipToBoundary(knowledgeText, 9000)}\n` : ''}
WHAT TO RETURN
- "insights": at most 2 items about the APPLICANT AS A PERSON that this answer supports — a mindset, a pattern of action, a motivation, a value. Each is 1-3 complete sentences that quote or closely paraphrase the applicant's own wording as evidence, in their terms. Follow the person-first standard: never a résumé line, never a grade, never "achieved X" without what it shows. If the answer supports no such reading, return [] — an honest empty list beats an inflated one. Mark any reading that goes beyond what they literally said with "suggests".
- "facts": concrete, reusable points this answer ADDS to the file — numbers, roles, scopes, dates, outcomes the applicant stated here that are not already saved. Each keeps the specifics exactly as given, with a self-contained sentence a drafter could use without seeing this exchange. [] is a fine answer. Never turn a guide, a sample's life, or an inference into a fact.
- "note": one sentence for the applicant — what you filed and where it can be edited. Say plainly if the answer raised more questions than it settled; do not lecture.
- These items are REFERENCE for future drafting, not an obligation to include them somewhere. The applicant alone decides what becomes a required inclusion.

Return JSON only: {"insights": [{"category": "personality|actions|mindset|goals", "text": "..."}], "facts": [{"category": "achievement|experience|value|fact", "text": "..."}], "note": "..."}`;
}

const ITEMS_CAP = { insights: 2, facts: 3 };

/** Keep only well-formed, in-category, non-huge entries from a model answer. */
export function normalizeQaAnalysis(raw) {
  const pick = (list, valid, max) => (Array.isArray(list) ? list : [])
    .map((item) => ({
      category: valid[clean(item?.category).toLowerCase()] ? clean(item.category).toLowerCase() : (valid === ABOUT_CATEGORIES ? 'actions' : 'experience'),
      text: clipToBoundary(clean(item?.text), 700, { marker: null }),
    }))
    .filter((item) => item.text.split(/\s+/).length >= 5)
    .slice(0, max);
  return {
    insights: pick(raw?.insights, ABOUT_CATEGORIES, ITEMS_CAP.insights),
    facts: pick(raw?.facts, POINT_CATEGORIES, ITEMS_CAP.facts),
    note: clean(raw?.note).slice(0, 300),
  };
}

// ---------------------------------------------------------------------------
// 3. Rows: what an answer writes into the knowledge base
// ---------------------------------------------------------------------------

/** The shared provenance stamp: prompts read it (see `qaNote`) and the UI marks it. */
function qaData(entry, kindOfItem) {
  return {
    from_qa: true,
    include: entry.include === true,
    qa_id: entry.id,
    question: clipToBoundary(entry.question, 160, { marker: '…' }),
    written: kindOfItem,
  };
}

/**
 * The answer as a personal point — no model call needed, it is the applicant's
 * own sentence. Created on save so a demo-mode applicant still gets their answer
 * into the base; the analysis pass appends its rows later.
 */
export function qaAnswerRow(entry, { sortOrder = 0 } = {}) {
  // The answer is stored complete: a knowledge item is never shortened, because
  // the drafter cannot use the half that was cut. Only the quoted QUESTION is
  // clipped, and only at a boundary, since it rides along for context.
  const answer = clean(entry.answer);
  return {
    kind: 'evidence',
    category: 'fact',
    text: `Asked by Atlas: ${clipToBoundary(entry.question, 160, { marker: '…' })} — the applicant's own answer: “${answer}”`,
    origin: 'manual',
    source_label: 'Your answer to an Atlas question',
    source_id: '',
    platform: 'General',
    sort_order: sortOrder,
    data: qaData(entry, 'answer'),
  };
}

/** The read-between-the-lines rows: portrait insights and extracted facts. */
export function qaAnalysisRows(entry, analysis, { sortOrder = 0 } = {}) {
  const rows = [];
  let order = sortOrder;
  for (const item of analysis?.insights || []) {
    rows.push({
      kind: 'brief',
      category: item.category,
      text: item.text,
      origin: 'manual',
      source_label: 'Your Q&A answer, read between the lines',
      source_id: '',
      platform: 'General',
      sort_order: order++,
      data: qaData(entry, 'insight'),
    });
  }
  for (const item of analysis?.facts || []) {
    rows.push({
      kind: 'evidence',
      category: item.category,
      text: item.text,
      origin: 'manual',
      source_label: 'Extracted from your Q&A answer',
      source_id: '',
      platform: 'General',
      sort_order: order++,
      data: qaData(entry, 'extracted fact'),
    });
  }
  return rows;
}

/** True when a knowledge row was built from a Q&A answer (for badges and re-runs). */
export function isQaRow(row) {
  return row?.data?.from_qa === true;
}

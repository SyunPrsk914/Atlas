// How a material should be read by the AI.
//
// "essay" is the applicant's own past writing. "sample_essay" is someone else's
// successful essay, kept so the model can study craft and must not treat the
// events in it as the applicant's life.
//
// The materials.type check constraint on an un-migrated database rejects
// sample_essay. The tag below lets the row survive as type "other" until
// supabase/schema.sql is re-run, and the read path maps it back.

import {
  analysisMatchesSource, decodeDocumentText, legacyTypedText, mergeLegacyIntoNotes,
  materialDisplayName, materialSource, sourceKey,
} from './materialDocument';

export const SAMPLE_ESSAY_TYPE = 'sample_essay';
export const SAMPLE_ROLE_TAG = '[[atlas-role:sample_essay]]';

export const MATERIAL_TYPES = [
  { value: 'document', label: 'Document', own: true },
  { value: 'link', label: 'Link / Website', own: true },
  { value: 'essay', label: 'My past essay', own: true },
  { value: SAMPLE_ESSAY_TYPE, label: 'Successful essay / Sample', own: false },
  { value: 'resume', label: 'Resume / CV', own: true },
  { value: 'transcript', label: 'Transcript', own: true },
  { value: 'award', label: 'Award / Certificate', own: true },
  { value: 'note', label: 'Note / Context', own: true },
  { value: 'other', label: 'Other', own: true },
];

export function isSampleMaterial(material) {
  if (!material) return false;
  if (material.type === SAMPLE_ESSAY_TYPE) return true;
  return String(material.notes || '').includes(SAMPLE_ROLE_TAG);
}

export function stripSampleTag(notes) {
  return String(notes || '').replace(SAMPLE_ROLE_TAG, '').replace(/^\n+/, '').trim();
}

/** True for a row that presentMaterial has already processed. */
function isPresented(row) {
  return typeof row?.document_state === 'string';
}

/**
 * What the UI and the AI should see, regardless of how the row was stored.
 *
 * - `content` is the document text Atlas read from the current file or link.
 *   Text from an earlier file is reported as `outdated` and not used.
 * - Old free text in `content` is shown in the Context notes instead.
 * - An analysis is shown only when it was made from the current source.
 *
 * Pass a raw database row. A row that is already presented is returned as is.
 */
export function presentMaterial(row) {
  if (!row || isPresented(row)) return row;
  const source = materialSource(row);
  const currentKey = sourceKey(source);
  const decoded = decodeDocumentText(row.content);
  const documentCurrent = !!decoded && !!currentKey && decoded.key === currentKey;
  const analysis = analysisMatchesSource(row.analysis, currentKey) ? row.analysis : null;
  return {
    ...row,
    type: isSampleMaterial(row) ? SAMPLE_ESSAY_TYPE : row.type,
    notes: mergeLegacyIntoNotes(stripSampleTag(row.notes), legacyTypedText(row)),
    content: documentCurrent ? decoded.text : '',
    document_state: !source ? 'none' : documentCurrent ? 'ready' : decoded ? 'outdated' : 'missing',
    document_reader: documentCurrent ? decoded.reader : null,
    analysis,
    analysis_outdated: !!row.analysis && !analysis,
  };
}

/**
 * Payload for a database that may not yet allow the sample_essay check value.
 * `forceLegacy` writes the compatible shape immediately.
 */
export function materialWritePayload(data, { forceLegacy = false } = {}) {
  if (!data || data.type !== SAMPLE_ESSAY_TYPE) return data;
  if (!forceLegacy) return data;
  const notes = stripSampleTag(data.notes);
  return {
    ...data,
    type: 'other',
    notes: notes ? `${SAMPLE_ROLE_TAG}\n${notes}` : SAMPLE_ROLE_TAG,
  };
}

export function isMaterialTypeCheckError(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return /23514|check constraint|materials_type_check/i.test(text) && /type|sample_essay/i.test(text);
}

const SAMPLE_READING = `SAMPLE / SUCCESSFUL ESSAYS — these were NOT written by the applicant.
Do not treat any person, place, event, grade, or sentence in them as the applicant's life, and do not copy their biography into a draft.
Study them as craft, word by word: content, expression, voice, tone, the characteristics of the writing, the emotion it evokes, and how each word is used to show what the writer wants the reader to understand.
Borrow technique. Never borrow a life.

PLATFORM DISTINCTION (CRITICAL):
Some samples are US (Common App, UC PIQ) and some are UK (UCAS). They have completely different conventions:
- US Common App: 650 words max, personal story, one essay shared across schools, supplements are school-specific.
- UC PIQ: 350 words each, 4 answers, direct and evidence-driven.
- UK UCAS: 4000 characters TOTAL across 3 fixed questions, 80% academic, never name a university.
When drafting for a US platform, DO NOT apply UK UCAS structure or tone. When drafting for UCAS, DO NOT apply US Common App structure. Learn voice and evidence density from any sample, but keep the structural rules platform-specific.`;

/** Heuristic to guess whether a material is UK or US based on title/content. */
export function inferRegion(material) {
  const hay = `${material.title || ''} ${material.content || ''} ${material.notes || ''}`.toLowerCase();
  if (/\bucas\b|oxford|cambridge|imperial|ucl|lse|uk personal statement/.test(hay)) return 'UK';
  if (/\bcommon app\b|uc piq|personal insight|stanford|harvard|mit|yale/.test(hay)) return 'US';
  return 'unknown';
}

/** Characters of document text sent per material; the rest of the file is still stored. */
const OWN_DOCUMENT_CHARS = 12000;
const SAMPLE_DOCUMENT_CHARS = 8000;

function budgetPerItem(count, total, floor) {
  return count ? Math.max(floor, Math.floor(total / count)) : total;
}

function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[… ${(text.length - max).toLocaleString()} more characters left out here to fit the AI's context window.]`;
}

const bullets = (items) => items.map((item) => `- ${item}`).join('\n');

// Prompt budgets for one material's analysis. The stored analysis keeps more;
// these keep the prompt inside the model's context window.
const PROMPT_FACTS_CHARS = 2500;
const PROMPT_CRAFT_CHARS = 1200;
const PROMPT_SUMMARY_CHARS = 1500;

/** Items in order until the next one would exceed maxChars. Lists are spread across the document, so a prefix still covers all of it. */
function fitWithin(items, maxChars) {
  const out = [];
  let used = 0;
  for (const item of items || []) {
    const cost = String(item).length + 3;
    if (used + cost > maxChars) break;
    out.push(item);
    used += cost;
  }
  return out;
}

function listWithNote(items, maxChars) {
  const kept = fitWithin(items, maxChars);
  const more = items.length - kept.length;
  return `${bullets(kept)}${more > 0 ? `\n- …and ${more} more in the saved analysis` : ''}`;
}

/** The word-by-word read, only when it was produced from the current source and finished. Facts are the applicant's own, so a sample never contributes them. */
function formatAnalysis(analysis, { sample = false } = {}) {
  if (!analysis || analysis.status !== 'ready') return '';
  const parts = [];
  if (analysis.thesis) parts.push(`Thesis (what it is actually saying): ${analysis.thesis}`);
  if (analysis.summary) parts.push(`Summary: ${clip(analysis.summary, PROMPT_SUMMARY_CHARS)}`);
  const scores = [];
  if (analysis.overall_score != null) scores.push(`overall ${analysis.overall_score}/10`);
  if (analysis.specificity_score != null) scores.push(`specificity ${analysis.specificity_score}/10`);
  if (analysis.rhythm_score != null) scores.push(`rhythm ${analysis.rhythm_score}/10`);
  if (analysis.voice_score != null) scores.push(`voice ${analysis.voice_score}/10`);
  if (scores.length) parts.push(`Scores: ${scores.join(', ')}`);
  if (analysis.sounds_like_ai) parts.push('Flag: reads as machine-generated');
  if (!sample && analysis.facts?.length) parts.push(`Facts about the applicant found in the document:\n${listWithNote(analysis.facts, PROMPT_FACTS_CHARS)}`);
  if (analysis.craft_moves?.length) parts.push(`Craft moves worth reusing:\n${listWithNote(analysis.craft_moves, PROMPT_CRAFT_CHARS)}`);
  if (analysis.top_actions?.length) parts.push(`Top actions from the analysis: ${analysis.top_actions.join(' | ')}`);
  const findings = (analysis.findings || []).slice(0, 8)
    .map((f) => `${f.kind}: "${(f.quote || '').slice(0, 80)}" — ${f.note || ''}`);
  if (findings.length) parts.push(`Key findings:\n${bullets(findings)}`);
  const coverage = analysis.coverage;
  const heading = coverage && !coverage.complete
    ? `Word-by-word analysis (covers ${Number(coverage.analyzed_chars || 0).toLocaleString()} of ${Number(coverage.total_chars || 0).toLocaleString()} characters of the document):`
    : 'Word-by-word analysis of the whole document:';
  return parts.length ? `${heading}\n${parts.join('\n')}` : '';
}

function formatSingleMaterial(material, documentBudget) {
  const title = material.title || 'Untitled';
  const type = material.type;
  const region = inferRegion(material);
  const sample = isSampleMaterial(material);
  const lines = [`--- ${title} [${type}]${region !== 'unknown' ? ` [${region}]` : ''} ---`];
  if (material.link_url) lines.push(`Website: ${material.link_url}`);
  if (material.file_url) lines.push(`Uploaded file: ${materialDisplayName(material)}`);

  const text = String(material.content || '').trim();
  if (text) {
    const origin = material.file_url ? 'uploaded file' : 'web page';
    lines.push(`Document text (read from the ${origin} itself, ${text.length.toLocaleString()} characters):\n${clip(text, documentBudget)}`);
  } else if (material.document_state === 'none') {
    lines.push('Document text: none. There is no file or link to read, so use only the context note and do not invent what the document says.');
  } else {
    lines.push('Document text: not read yet. Do not describe what it says.');
  }

  const context = String(material.notes || '').trim();
  if (context) {
    lines.push(sample
      ? `Context from the applicant about this sample (what it is; it describes the sample's writer, never the applicant):\n${context}`
      : `Context from the applicant about this material (what it is; facts stated here are the applicant's own):\n${context}`);
  }

  const analysis = formatAnalysis(material.analysis, { sample });
  if (analysis) lines.push(analysis);
  return lines.join('\n');
}

/** The applicant's own materials, formatted one block each, with document text budgeted. */
export function formatOwnMaterials(materials, { totalChars = OWN_DOCUMENT_CHARS } = {}) {
  const list = (materials || []).map(presentMaterial).filter((m) => !isSampleMaterial(m));
  const budget = budgetPerItem(list.length, totalChars, 1200);
  return list.map((m) => formatSingleMaterial(m, budget));
}

/** Sample essays, formatted for craft study only, with document text budgeted. */
export function formatSampleMaterials(materials, { totalChars = SAMPLE_DOCUMENT_CHARS } = {}) {
  const list = (materials || []).map(presentMaterial).filter((m) => isSampleMaterial(m));
  const budget = budgetPerItem(list.length, totalChars, 1000);
  return list.map((m) => formatSingleMaterial(m, budget));
}

/**
 * Split materials into the applicant's own evidence and sample essays, so every
 * AI feature gets the same instruction. Document text is read from the file;
 * the context note is never presented as the document.
 * @param {Array} materials raw rows from the database
 * @param {object} [opts]
 * @param {string} [opts.platform] current platform, to prioritise relevant samples
 */
export function formatMaterialsForAI(materials, opts = {}) {
  const own = formatOwnMaterials(materials);
  const samples = formatSampleMaterials(materials);
  const parts = [];
  // Platform-aware header
  const platform = opts.platform || '';
  const platformNote = platform
    ? `CURRENT APPLICATION PLATFORM: ${platform}. Prioritize ${platform === 'ucas' ? 'UK UCAS' : 'US'} samples for structural guidance, but you may learn voice/tone from any. Never apply UK structure to US essays or vice versa.`
    : '';

  parts.push(
    own.length
      ? `APPLICANT'S OWN MATERIALS (facts about this student — USE THESE HEAVILY. Mine them for concrete detail, names, numbers, roles, outcomes, and distinctive voice. These are the primary source for personalization):\n${platformNote ? `${platformNote}\n\n` : ''}${own.join('\n\n')}`
      : `No materials written by the applicant have been added. ${platformNote}`,
  );
  if (samples.length) {
    parts.push(`${SAMPLE_READING}\n\n${platform ? `${platformNote}\n\n` : ''}${samples.join('\n\n')}`);
  } else {
    parts.push('No sample essays added yet. If added, they should be studied for craft only.');
  }
  return parts.join('\n\n');
}

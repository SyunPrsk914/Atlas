// How a material should be read by the AI.
//
// "essay" is the applicant's own past writing. "sample_essay" is someone else's
// successful essay, kept so the model can study craft and must not treat the
// events in it as the applicant's life. A material can also carry an explicit
// analysis lens: this is what stops an internal assessment, a tips document, or
// a college data sheet from being reviewed as though it were a college essay.
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

/**
 * The lens controls what Atlas is allowed to conclude from a document. It is
 * deliberately separate from the broad display type ("Document" remains a
 * useful catch-all). `auto` asks the model to classify the document from its
 * title, context, and contents before it chooses an analysis.
 */
export const MATERIAL_ANALYSIS_ROLES = {
  auto: { label: 'Let Atlas identify the purpose', hint: 'Atlas classifies it before deciding what to extract.' },
  applicant_evidence: { label: 'My evidence / experience', hint: 'Extract facts, values, habits, motivations, and what the material reveals about you.' },
  writing_draft: { label: 'My writing draft', hint: 'Add a writing assessment and exact line-level findings.' },
  sample_craft: { label: 'Someone else’s successful writing', hint: 'Study craft only. Never score it as yours or borrow its life.' },
  academic_work: { label: 'My academic work / assessment', hint: 'Read the thinking, method, curiosity, and intellectual habits — not essay quality.' },
  personal_context: { label: 'Personal context / reflection', hint: 'Read between the lines for identity, values, tensions, and change.' },
  advice: { label: 'Tips / writing guide', hint: 'Extract reusable principles; do not turn the guide into facts about you.' },
  application_reference: { label: 'College / application reference', hint: 'Extract requirements, criteria, and useful application constraints.' },
};

export const MATERIAL_ROLE_VALUES = Object.keys(MATERIAL_ANALYSIS_ROLES);
const ROLE_TAG_RE = /\[\[atlas-analysis-role:([a-z_]+)\]\]/i;

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

const TYPE_ROLE = {
  essay: 'writing_draft',
  sample_essay: 'sample_craft',
  resume: 'applicant_evidence',
  transcript: 'academic_work',
  award: 'applicant_evidence',
  note: 'personal_context',
};

function validRole(value) {
  const role = String(value || '').trim().toLowerCase();
  return MATERIAL_ROLE_VALUES.includes(role) ? role : '';
}

/** Role explicitly saved by the applicant, including the old-database tag. */
export function materialAnalysisRoleChoice(material) {
  const field = validRole(material?.analysis_role);
  if (field) return field;
  const tagged = String(material?.notes || '').match(ROLE_TAG_RE)?.[1];
  return validRole(tagged) || 'auto';
}

export function stripAnalysisRoleTag(notes) {
  return String(notes || '').replace(ROLE_TAG_RE, '').replace(/^\n+/, '').trim();
}

function addAnalysisRoleTag(notes, role) {
  const cleanNotes = stripAnalysisRoleTag(notes);
  if (!role || role === 'auto') return cleanNotes;
  return cleanNotes ? `${ANALYSIS_ROLE_TAG(role)}\n${cleanNotes}` : ANALYSIS_ROLE_TAG(role);
}

function ANALYSIS_ROLE_TAG(role) {
  return `[[atlas-analysis-role:${role}]]`;
}

/**
 * A small metadata heuristic makes the catch-all "Document" useful even
 * before a model has classified it. The model still has the final say after it
 * reads the document, and an explicit applicant choice always wins.
 */
function inferRoleFromMetadata(material) {
  const hay = `${material?.title || ''} ${material?.notes || ''}`.toLowerCase();
  if (/sample|successful essay|model essay|admitted essay/.test(hay)) return 'sample_craft';
  if (/tip|guide|advice|how to|framework|strategy|checklist|writing lesson|essay guide/.test(hay)) return 'advice';
  if (/college data|common data set|admission requirement|application requirement|deadline|supplement|university research|course catalogue|course catalog|school profile/.test(hay)) return 'application_reference';
  if (/internal assessment|extended essay|lab report|research paper|coursework|tok|exam commentary|investigation/.test(hay)) return 'academic_work';
  if (/reflection|journal|diary|background|personal context|statement of circumstance/.test(hay)) return 'personal_context';
  return '';
}

function sourceRole(material) {
  if (isSampleMaterial(material)) return 'sample_craft';
  const choice = materialAnalysisRoleChoice(material);
  if (choice !== 'auto') return choice;
  return inferRoleFromMetadata(material) || TYPE_ROLE[material?.type] || 'auto';
}

/**
 * Whether an existing analysis still matches the source's current lens. A
 * changed type/title/lens must not leave an old writing score visible on a
 * transcript or guide while a model is unavailable.
 */
export function analysisMatchesMaterialRole(material) {
  const expected = sourceRole(material);
  const actual = validRole(material?.analysis?.analysis_role);
  return !!actual && (expected === 'auto' || actual === expected);
}

/** Effective lens used by prompts and the formatter. */
export function materialAnalysisRole(material) {
  const source = sourceRole(material);
  if (source !== 'auto') return source;
  const analyzedRole = validRole(material?.analysis?.analysis_role);
  if (analyzedRole && analyzedRole !== 'auto') return analyzedRole;
  return 'auto';
}

export function materialRoleLabel(role) {
  return MATERIAL_ANALYSIS_ROLES[role]?.label || MATERIAL_ANALYSIS_ROLES.auto.label;
}

export function isWritingMaterial(material) {
  return materialAnalysisRole(material) === 'writing_draft';
}

export function isGuidanceMaterial(material) {
  const role = materialAnalysisRole(material);
  return role === 'advice' || role === 'application_reference';
}

export function isApplicantMaterial(material) {
  const role = materialAnalysisRole(material);
  return !['sample_craft', 'advice', 'application_reference'].includes(role);
}

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
  const analysis = analysisMatchesSource(row.analysis, currentKey)
    && (row.analysis?.status !== 'ready' || analysisMatchesMaterialRole(row)) ? row.analysis : null;
  return {
    ...row,
    type: isSampleMaterial(row) ? SAMPLE_ESSAY_TYPE : row.type,
    analysis_role: materialAnalysisRole(row),
    notes: mergeLegacyIntoNotes(stripAnalysisRoleTag(stripSampleTag(row.notes)), legacyTypedText(row)),
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
  if (!data) return data;
  const role = validRole(data.analysis_role) || (data.type === SAMPLE_ESSAY_TYPE ? 'sample_craft' : 'auto');
  const cleanNotes = stripAnalysisRoleTag(stripSampleTag(data.notes));
  const notes = addAnalysisRoleTag(cleanNotes, role);
  const next = { ...data, notes, analysis_role: role };
  if (data.type !== SAMPLE_ESSAY_TYPE || !forceLegacy) return next;
  return {
    ...next,
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
const PROMPT_FACTS_CHARS = 3500;
const PROMPT_INSIGHTS_CHARS = 6000;
const PROMPT_GUIDANCE_CHARS = 3500;
const PROMPT_CRAFT_CHARS = 2200;
const PROMPT_SUMMARY_CHARS = 2200;

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

/**
 * The deep read, only when it was produced from the current source and
 * finished. Unlike the old formatter, it does not put a writing score on a
 * transcript, internal assessment, tips sheet, or college data document.
 */
function formatAnalysis(analysis, options = {}) {
  const material = options.material;
  if (!analysis || analysis.status !== 'ready') return '';
  const role = analysis.analysis_role || materialAnalysisRole(material);
  const sample = role === 'sample_craft';
  const writing = role === 'writing_draft';
  const parts = [];
  if (analysis.document_type) parts.push(`Atlas identified this as: ${analysis.document_type}`);
  if (analysis.deep_read) parts.push(`Deep read (what this document is really doing): ${clip(analysis.deep_read, PROMPT_SUMMARY_CHARS)}`);
  if (analysis.significance) parts.push(`Why it matters: ${clip(analysis.significance, PROMPT_SUMMARY_CHARS)}`);

  if (writing) {
    const scores = [];
    if (analysis.overall_score != null) scores.push(`overall ${analysis.overall_score}/10`);
    if (analysis.specificity_score != null) scores.push(`specificity ${analysis.specificity_score}/10`);
    if (analysis.rhythm_score != null) scores.push(`rhythm ${analysis.rhythm_score}/10`);
    if (analysis.voice_score != null) scores.push(`voice ${analysis.voice_score}/10`);
    if (scores.length) parts.push(`Writing assessment: ${scores.join(', ')}`);
    if (analysis.sounds_like_ai) parts.push('Writing signal: contains patterns that can sound machine-generated');
  }

  if (!sample && analysis.personal_signals?.length) {
    parts.push(`What this suggests about the applicant (interpretation, not just literal facts):\n${listWithNote(analysis.personal_signals, PROMPT_INSIGHTS_CHARS)}`);
  }
  if (!sample && analysis.facts?.length) {
    const label = role === 'application_reference' ? 'Concrete reference points' : 'Concrete evidence retained';
    parts.push(`${label}:\n${listWithNote(analysis.facts, PROMPT_FACTS_CHARS)}`);
  }
  if (analysis.guidance?.length) {
    const label = role === 'application_reference' ? 'Application guidance and constraints' : 'Guidance worth carrying forward';
    parts.push(`${label}:\n${listWithNote(analysis.guidance, PROMPT_GUIDANCE_CHARS)}`);
  }
  if (analysis.craft_moves?.length) parts.push(`Craft moves worth reusing (technique, never a borrowed life):\n${listWithNote(analysis.craft_moves, PROMPT_CRAFT_CHARS)}`);
  if (writing && analysis.top_actions?.length) parts.push(`Writing actions: ${analysis.top_actions.join(' | ')}`);
  const findings = writing ? (analysis.findings || []).slice(0, 8)
    .map((f) => `${f.kind}: "${(f.quote || '').slice(0, 80)}" — ${f.note || ''}`) : [];
  if (findings.length) parts.push(`Key line findings:\n${bullets(findings)}`);
  const coverage = analysis.coverage;
  const heading = coverage && !coverage.complete
    ? `Deep analysis (covers ${Number(coverage.analyzed_chars || 0).toLocaleString()} of ${Number(coverage.total_chars || 0).toLocaleString()} characters of the document):`
    : 'Deep analysis of the whole document:';
  return parts.length ? `${heading}\n${parts.join('\n')}` : '';
}

function formatSingleMaterial(material, documentBudget) {
  const title = material.title || 'Untitled';
  const type = material.type;
  const region = inferRegion(material);
  const sample = isSampleMaterial(material);
  const role = materialAnalysisRole(material);
  const roleLabel = materialRoleLabel(role);
  const lines = [`--- ${title} [${type}] [analysis lens: ${roleLabel}]${region !== 'unknown' ? ` [${region}]` : ''} ---`];
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
      : ['advice', 'application_reference'].includes(role)
        ? `Context from the applicant about this reference (use it to understand the source; do not turn it into facts about the applicant):\n${context}`
        : `Context from the applicant about this material (what it is; use it as context, not as proof beyond the document):\n${context}`);
  }

  const analysis = formatAnalysis(material.analysis, { material });
  if (analysis) lines.push(analysis);
  return lines.join('\n');
}

/** The applicant's own materials, formatted one block each, with document text budgeted. */
export function formatOwnMaterials(materials, { totalChars = OWN_DOCUMENT_CHARS } = {}) {
  const list = (materials || []).map(presentMaterial).filter((m) => isApplicantMaterial(m));
  const budget = budgetPerItem(list.length, totalChars, 1200);
  return list.map((m) => formatSingleMaterial(m, budget));
}

/** Tips, guides, and college/application references; never treated as applicant biography. */
export function formatGuidanceMaterials(materials, { totalChars = 9000 } = {}) {
  const list = (materials || []).map(presentMaterial).filter((m) => isGuidanceMaterial(m));
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
 * Split materials into evidence, guidance/reference, and sample craft. Every AI
 * feature gets the same safety boundary, while the analysis lens decides how a
 * document is interpreted inside its own section.
 * @param {Array} materials raw rows from the database
 * @param {object} [opts]
 * @param {string} [opts.platform] current platform, to prioritise relevant samples
 */
export function formatMaterialsForAI(materials, opts = {}) {
  const own = formatOwnMaterials(materials);
  const guidance = formatGuidanceMaterials(materials);
  const samples = formatSampleMaterials(materials);
  const parts = [];
  const platform = opts.platform || '';
  const platformNote = platform
    ? `CURRENT APPLICATION PLATFORM: ${platform}. Prioritize ${platform === 'ucas' ? 'UK UCAS' : 'US'} samples for structural guidance, but you may learn voice/tone from any. Never apply UK structure to US essays or vice versa.`
    : '';

  parts.push(
    own.length
      ? `APPLICANT'S OWN MATERIALS (primary evidence about this student — use deeply, but do not flatten every document into an essay or a score. Academic work can reveal intellectual habits; personal reflections can reveal values and tensions; a writing draft can receive line-level feedback):\n${platformNote ? `${platformNote}\n\n` : ''}${own.join('\n\n')}`
      : `No applicant-evidence materials have been added. ${platformNote}`,
  );
  parts.push(
    guidance.length
      ? `TIPS, GUIDES, AND APPLICATION REFERENCES (not biography, not proof of what this student has done. Extract rules, criteria, constraints, and craft ideas; never use them to invent an experience or a personality trait):\n${guidance.join('\n\n')}`
      : 'No tips, guides, or application-reference materials added yet.',
  );
  if (samples.length) {
    parts.push(`${SAMPLE_READING}\n\n${platform ? `${platformNote}\n\n` : ''}${samples.join('\n\n')}`);
  } else {
    parts.push('No sample essays added yet. If added, they should be studied for craft only.');
  }
  return parts.join('\n\n');
}

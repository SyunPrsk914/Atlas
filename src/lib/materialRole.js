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
import { contextTargetLabel, filterByContextTarget } from './contextTargeting';
import { clipToBoundary, omissionNote, packBlocks } from './textClip';

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

/**
 * How much prompt space each group of sources gets.
 *
 * The old rule divided one fixed budget by the number of materials, so 40
 * uploads each arrived as ~1,200 characters cut mid-word, and everything past
 * the budget disappeared without a word — which is how "40+ materials" produced
 * a shallow reading. Now the budget grows with the pile, the sources that
 * actually match this essay get the largest share, and a source that cannot fit
 * is dropped whole and named. Never truncated into nonsense, never vanished.
 */
const GROUP_BUDGETS = {
  own: { base: 24000, per: 2200, max: 120000, floor: 1500, cap: 16000 },
  guidance: { base: 12000, per: 1800, max: 60000, floor: 1200, cap: 12000 },
  sample: { base: 14000, per: 2400, max: 70000, floor: 1200, cap: 16000 },
};

/**
 * Words that carry no topical signal, so a title made of them matches nothing.
 */
const RELEVANCE_STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'about', 'that', 'this', 'your', 'have', 'has',
  'what', 'how', 'why', 'are', 'you', 'can', 'will', 'would', 'should', 'their', 'there',
  'them', 'they', 'been', 'being', 'were', 'was', 'are', 'not', 'but', 'all', 'any',
  'one', 'two', 'our', 'his', 'her', 'its', 'who', 'whom', 'which', 'when', 'where',
  'tell', 'write', 'essay', 'essays', 'describe', 'discuss', 'please', 'more', 'most',
  'into', 'onto', 'over', 'under', 'also', 'than', 'then', 'them', 'some', 'such',
]);

function relevanceTokens(value) {
  return [...new Set(String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !RELEVANCE_STOP.has(word)))];
}

/**
 * How much this source belongs to the job currently being asked.
 *
 * Scoring is deliberately transparent — an explicit target outweighs a keyword
 * match, a keyword match outweighs a platform hint — because the ranking decides
 * whose text reaches the model when the budget runs out, and an applicant
 * deserves to be able to predict that.
 *
 * @returns {number} 0-1
 */
export function materialRelevance(material, {
  essay = null, universityName = '', platform = '', task = '',
} = {}) {
  const row = material || {};
  let score = 0;
  const haystack = `${row.title || ''} ${row.notes || ''} ${row.analysis?.document_type || ''}`.toLowerCase();
  const needsText = `${essay?.title || ''} ${essay?.prompt || ''} ${universityName || ''}`.toLowerCase();

  // An explicit scope the applicant set is the strongest possible signal.
  if (essay?.id && row.target_essay_id && String(row.target_essay_id) === String(essay.id)) score += 0.55;
  if (universityName && row.target_university_id) score += 0.3;
  if (platform && row.target_platform && String(row.target_platform) === String(platform)) score += 0.1;
  if (task && row.target_task && String(row.target_task) === String(task)) score += 0.1;

  // Shared content words: a source that names the same things as this prompt.
  if (needsText.trim() && haystack) {
    const sourceTokens = new Set(relevanceTokens(haystack));
    const hits = relevanceTokens(needsText).filter((word) => sourceTokens.has(word));
    score += Math.min(0.45, hits.length * 0.15);
  }

  // A US prompt should not lean on a UK sample, or the reverse.
  const region = inferRegion(row);
  if (platform && region !== 'unknown') score += (region === (platform === 'ucas' ? 'UK' : 'US')) ? 0.15 : -0.1;

  // An analysed source is denser per character than raw text, so it is worth
  // more of the budget; an unread one is nearly useless here.
  if (row.analysis?.status === 'ready') score += 0.1;
  if (row.document_state && row.document_state !== 'ready') score -= 0.05;

  // Which lens this task is actually looking for.
  const role = materialAnalysisRole(row);
  const preferred = {
    draft: ['applicant_evidence', 'writing_draft', 'advice'],
    polish: ['writing_draft', 'advice', 'applicant_evidence'],
    review: ['writing_draft', 'advice'],
    length: ['applicant_evidence', 'writing_draft'],
    application: ['applicant_evidence', 'academic_work', 'personal_context', 'application_reference'],
    activity: ['applicant_evidence', 'academic_work'],
  }[task] || [];
  if (preferred.includes(role)) score += 0.12;
  if (role === 'sample_craft' && ['draft', 'polish', 'review', 'length'].includes(task)) score += 0.06;

  return Math.max(0, Math.min(1, score));
}

/**
 * Shared document-text budgets, weighted by relevance so the matched sources
 * read in full while an unrelated one still contributes its headline.
 */
function weightedBudgets(count, budget, plan, relevanceOf) {
  if (!count) return [];
  const weights = Array.from({ length: count }, (_, i) => 1
    + relevanceOf(i)
    // Position breaks ties so a stable order stays stable across calls.
    + (count - i) / (4 * count));
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => Math.max(plan.floor, Math.min(plan.cap, Math.floor(budget * (weight / total)))));
}

/**
 * Format one group of materials: rank by relevance, share the budget, and keep
 * whole sources only. `omitted` is every source the budget could not hold, so
 * the caller can name it instead of letting it vanish.
 *
 * @param {Array} materials raw or presented rows
 * @param {object} args
 * @param {'own'|'guidance'|'sample'} args.group
 * @param {(material: object) => boolean} args.include
 * @param {number} [args.totalChars] caller override for the whole group
 * @param {object} [args.context] { essay, universityName, platform, task }
 */
function formatMaterialGroup(materials, { group, include, totalChars, context = {} }) {
  const plan = GROUP_BUDGETS[group] || GROUP_BUDGETS.own;
  const list = (materials || [])
    .map(presentMaterial)
    .filter((material) => include(material))
    .map((material) => ({ material, relevance: materialRelevance(material, context) }))
    // Most relevant first; ties keep the database order, so two runs match.
    .sort((a, b) => b.relevance - a.relevance);
  const budget = Number.isFinite(totalChars) && totalChars > 0
    ? totalChars
    : Math.min(plan.max, plan.base + plan.per * Math.max(0, list.length - 1));
  const budgets = weightedBudgets(list.length, budget, plan, (index) => list[index].relevance);
  const built = list.map(({ material, relevance }, index) => ({
    material,
    relevance,
    text: formatSingleMaterial(material, budgets[index]),
  }));
  const { kept, omitted } = packBlocks(built, budget, (block) => block.text.length + 2);
  return {
    blocks: kept.map((block) => block.text),
    omitted: omitted.map((block) => block.material),
    included: kept.map((block) => block.material),
    budget,
  };
}

function clip(text, max) {
  return clipToBoundary(text, max, {
    marker: (dropped) => `\n[… ${dropped.toLocaleString()} more characters left out here to fit the AI's context window.]`,
  });
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
  const target = material._atlasTargetLabel || '';
  const lines = [`--- ${title} [${type}] [analysis lens: ${roleLabel}]${region !== 'unknown' ? ` [${region}]` : ''}${target ? ` [context: ${target}]` : ''} ---`];
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
export function formatOwnMaterials(materials, { totalChars = 0, context = {} } = {}) {
  return formatMaterialGroup(materials, {
    group: 'own', include: isApplicantMaterial, totalChars, context,
  }).blocks;
}

/** Tips, guides, and college/application references; never treated as applicant biography. */
export function formatGuidanceMaterials(materials, { totalChars = 0, context = {} } = {}) {
  return formatMaterialGroup(materials, {
    group: 'guidance', include: isGuidanceMaterial, totalChars, context,
  }).blocks;
}

/** Sample essays, formatted for craft study only, with document text budgeted. */
export function formatSampleMaterials(materials, { totalChars = 0, context = {} } = {}) {
  return formatMaterialGroup(materials, {
    group: 'sample', include: isSampleMaterial, totalChars, context,
  }).blocks;
}

/**
 * Split materials into evidence, guidance/reference, and sample craft. Every AI
 * feature gets the same safety boundary, while the analysis lens decides how a
 * document is interpreted inside its own section.
 *
 * Ranking is part of this contract: the applicant's pile is ordered by how much
 * each source belongs to the task being asked, and only the sources that fit the
 * prompt budget are sent. Anything left out is named, so "the AI ignored my
 * materials" is always answerable from the text of the prompt itself.
 *
 * @param {Array} materials raw rows from the database
 * @param {object} [opts]
 * @param {string} [opts.platform] current platform, to prioritise relevant samples
 * @param {object} [opts.essay] the essay being drafted, reviewed, or edited
 * @param {string} [opts.universityName] the university this task belongs to
 * @param {string} [opts.task] draft | review | polish | length | application | activity
 */
export function formatMaterialsForAI(materials, opts = {}) {
  const applicable = filterByContextTarget(materials, opts).map((material) => {
    const label = contextTargetLabel(material, opts);
    return { ...material, _atlasTargetLabel: label === 'All applications and tasks' ? '' : label };
  });
  const context = {
    essay: opts.essay || null,
    universityName: opts.universityName || '',
    platform: opts.platform || '',
    task: opts.task || '',
  };
  const own = formatMaterialGroup(applicable, { group: 'own', include: isApplicantMaterial, context });
  const guidance = formatMaterialGroup(applicable, { group: 'guidance', include: isGuidanceMaterial, context });
  const samples = formatMaterialGroup(applicable, { group: 'sample', include: isSampleMaterial, context });
  // The three groups are disjoint, so their leftovers can simply be listed.
  const omission = omissionNote(
    [...own.omitted, ...guidance.omitted, ...samples.omitted],
    'Sources held back from this prompt (least relevant to this task, saved analysis still on record)',
    (material) => material.title || 'Untitled',
  );
  const parts = [];
  const platform = opts.platform || '';
  const targetEssay = opts.essay?.title ? ` · essay: ${opts.essay.title}` : '';
  const targetUniversity = opts.universityName ? ` · university: ${opts.universityName}` : '';
  const targetTask = opts.task ? ` · task: ${opts.task}` : '';
  const scopeNote = `CURRENT CONTEXT:${targetUniversity || ' general applicant context'}${targetEssay}${targetTask}. Only materials whose saved university, essay, platform, and task targets match this context are included, ordered by how directly they serve this task.`;
  const platformNote = platform
    ? `CURRENT APPLICATION PLATFORM: ${platform}. Prioritize ${platform === 'ucas' ? 'UK UCAS' : 'US'} samples for structural guidance, but you may learn voice/tone from any. Never apply UK structure to US essays or vice versa.`
    : '';

  parts.push(scopeNote);
  parts.push(
    own.blocks.length
      ? `APPLICANT'S OWN MATERIALS (primary evidence about this student — use deeply, but do not flatten every document into an essay or a score. Academic work can reveal intellectual habits; personal reflections can reveal values and tensions; a writing draft can receive line-level feedback):\n${platformNote ? `${platformNote}\n\n` : ''}${own.blocks.join('\n\n')}`
      : `No applicant-evidence materials have been added. ${platformNote}`,
  );
  parts.push(
    guidance.blocks.length
      ? `TIPS, GUIDES, AND APPLICATION REFERENCES (not biography, not proof of what this student has done. Extract rules, criteria, constraints, and craft ideas; never use them to invent an experience or a personality trait):\n${guidance.blocks.join('\n\n')}`
      : 'No tips, guides, or application-reference materials added yet.',
  );
  if (samples.blocks.length) {
    parts.push(`${SAMPLE_READING}\n\n${platform ? `${platformNote}\n\n` : ''}${samples.blocks.join('\n\n')}`);
  } else {
    parts.push('No sample essays added yet. If added, they should be studied for craft only.');
  }
  if (omission) parts.push(omission.trimStart());
  return parts.join('\n\n');

}

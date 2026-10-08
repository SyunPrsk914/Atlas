// How a material should be read by the AI.
//
// "essay" is the applicant's own past writing. "sample_essay" is someone else's
// successful essay, kept so the model can study craft and must not treat the
// events in it as the applicant's life.
//
// The materials.type check constraint on an un-migrated database rejects
// sample_essay. The tag below lets the row survive as type "other" until
// supabase/schema.sql is re-run, and the read path maps it back.

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

/** What the UI and the AI should see, regardless of how the row was stored. */
export function presentMaterial(row) {
  if (!row) return row;
  if (!isSampleMaterial(row)) return row;
  return {
    ...row,
    type: SAMPLE_ESSAY_TYPE,
    notes: stripSampleTag(row.notes),
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

/** Heuristic to guess whether a material is UK or US based on title/content */
function inferRegion(material) {
  const hay = `${material.title || ''} ${material.content || ''} ${material.notes || ''}`.toLowerCase();
  if (/\bucas\b|oxford|cambridge|imperial|ucl|lse|uk personal statement/.test(hay)) return 'UK';
  if (/\bcommon app\b|uc piq|personal insight|stanford|harvard|mit|yale/.test(hay)) return 'US';
  return 'unknown';
}

function formatSingleMaterial(material) {
  const title = material.title || 'Untitled';
  const type = material.type;
  const region = inferRegion(material);
  const lines = [];
  lines.push(`--- ${title} [${type}]${region !== 'unknown' ? ` [${region}]` : ''} ---`);
  if (material.link_url) lines.push(`Link: ${material.link_url}`);
  if (material.file_url) lines.push(`File: ${material.file_url}`);
  if (material.content && String(material.content).trim()) {
    lines.push(`Content (THIS IS THE ACTUAL DOCUMENT — analyze/use this):\n${material.content}`);
  } else {
    lines.push(`Content: (no pasted text — ${material.link_url ? 'see link' : 'empty'})`);
  }
  if (material.notes && String(material.notes).trim()) {
    // Notes are context, not content
    const cleanNotes = String(material.notes).replace(/\[\[atlas-role:sample_essay\]\]/g, '').trim();
    if (cleanNotes) {
      lines.push(`Context / Notes from applicant (NOT the document itself, only a hint about what it is): ${cleanNotes}`);
    }
  }
  if (material.analysis) {
    const a = material.analysis;
    const summaryParts = [];
    if (a.summary) summaryParts.push(`Summary: ${a.summary}`);
    if (a.thesis) summaryParts.push(`Thesis / what it is actually saying: ${a.thesis}`);
    const scores = [];
    if (a.overall_score != null) scores.push(`overall ${a.overall_score}/10`);
    if (a.specificity_score != null) scores.push(`specificity ${a.specificity_score}/10`);
    if (a.rhythm_score != null) scores.push(`rhythm ${a.rhythm_score}/10`);
    if (a.voice_score != null) scores.push(`voice ${a.voice_score}/10`);
    if (scores.length) summaryParts.push(`Scores: ${scores.join(', ')}`);
    if (a.sounds_like_ai) summaryParts.push(`Flag: reads as AI-generated`);
    if (Array.isArray(a.top_actions) && a.top_actions.length) {
      summaryParts.push(`Top actions from analysis: ${a.top_actions.join(' | ')}`);
    }
    if (Array.isArray(a.findings) && a.findings.length) {
      const topFindings = a.findings.slice(0, 8).map((f) => `${f.kind}: "${(f.quote || '').slice(0, 80)}" — ${f.note || ''}`).join(' | ');
      if (topFindings) summaryParts.push(`Key findings: ${topFindings}`);
    }
    if (summaryParts.length) {
      lines.push(`Analysis (from word-by-word read):\n${summaryParts.join('\n')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Split materials into the applicant's own evidence and sample essays, so every
 * AI feature gets the same instruction. Includes analysis when available.
 * @param {Array} materials
 * @param {object} [opts]
 * @param {string} [opts.platform] current platform to prioritize relevant samples
 */
export function formatMaterialsForAI(materials, opts = {}) {
  const list = (materials || []).map(presentMaterial);
  const own = [];
  const samples = [];
  for (const material of list) {
    const block = formatSingleMaterial(material);
    if (isSampleMaterial(material)) samples.push(block);
    else own.push(block);
  }
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

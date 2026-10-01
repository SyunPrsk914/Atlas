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
Borrow technique. Never borrow a life.`;

/**
 * Split materials into the applicant's own evidence and sample essays, so every
 * AI feature gets the same instruction.
 */
export function formatMaterialsForAI(materials) {
  const list = (materials || []).map(presentMaterial);
  const own = [];
  const samples = [];
  for (const material of list) {
    const body = material.content || material.notes || (material.link_url ? `(link only: ${material.link_url})` : '(no text)');
    const block = `--- ${material.title || 'Untitled'} [${material.type}]${material.link_url ? ` (${material.link_url})` : ''} ---\n${body}`;
    if (isSampleMaterial(material)) samples.push(block);
    else own.push(block);
  }
  const parts = [];
  parts.push(own.length
    ? `APPLICANT'S OWN MATERIALS (facts about this student — these may be used):\n${own.join('\n\n')}`
    : 'No materials written by the applicant have been added.');
  if (samples.length) parts.push(`${SAMPLE_READING}\n\n${samples.join('\n\n')}`);
  return parts.join('\n\n');
}

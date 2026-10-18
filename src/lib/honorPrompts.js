// The Common App honors list and the one AI job it needs: sharper wording.
//
// The applicant asked for exactly this and nothing more ("You don't need the
// suggestion, but just sharpening the wordings") — so unlike the activities
// section, honors has no "suggest entries" feature. What exists here is the
// real form's constraints (mirrored from activityPrompts' field-fitting so a
// rewrite can never be longer than the box the application enforces), how an
// admissions reader uses the section, and a polish prompt that rewrites the
// honor name from the applicant's own facts and private note — never invented
// ones — and shows the change for the applicant to accept or discard.
//
// Pure module: no React, no browser APIs.

import { fitActivityField } from './activityPrompts';
import { clipToBoundary } from './textClip';

export const HONOR_LIMITS = {
  maxHonors: 5,
  /** The "Name of honor" box on the Common App. */
  name: 100,
  /** The applicant's private note for the AI — never submitted, so it is capped for the prompt, not the form. */
  note: 500,
  gradeLevels: ['9', '10', '11', '12', 'PG'],
  levels: ['School', 'State', 'National', 'International'],
};

/** Reuse the activities list's field-fitting rule for the honors field too. */
const fitName = (value) => fitActivityField(value, HONOR_LIMITS.name);

export const HONOR_SECTION_BRIEF = `HOW THE HONORS SECTION IS READ:
- Five slots, one line each. The reader spends seconds here; the name of the honor has to carry everything the form does not capture in its two structured fields (grade level, level of recognition).
- The name is the official name, not a caption. "National Merit Scholarship — Commended Student" teaches a reader more than "Merit Award". If the award has a formal title, use it; add the qualifier (medal, finalist, citation, rank) that says WHICH tier was earned.
- What the reader checks, in order: what exactly was awarded, at what scope, out of how many / for what. A selective honor named without its selectivity ("Won the dean's research award") reads weaker than the same honor with its real scale ("Dean's Research Award, one of 2 projects chosen from 140 finalists").
- Numbers belong here only when they are the award's own facts: the size of the pool, the rank, the number of years held, the quota. Never an adjective ("prestigious", "highly competitive") standing in for a number, and never an outcome the award did not confer.
- The level field (School/State/National/International) is structured — the name should not repeat it unless qualifying it ("International Physics Olympiad — silver medal, 361 competitors from 86 countries").
- If the honor needs a sentence the 100 characters cannot hold, keep the name exact and let the essay carry the story; an overstuffed honor line reads as insecurity.`;

/** The applicant's private note: the facts an AI rewrite may draw on. */
export function honorNoteBrief(honor) {
  const note = String(honor?.note || '').replace(/\s+/g, ' ').trim();
  if (!note) return '';
  // The editor never truncates what you type; only this prompt block is
  // shortened, at a sentence boundary, and it says so instead of vanishing.
  const clipped = clipToBoundary(note, HONOR_LIMITS.note);
  return `THE APPLICANT'S OWN NOTE FOR THIS HONOR (the ground truth for this entry — build the name from these; never contradict them; a fact in neither this note, the entry, the profile, nor the materials does not exist):
${clipped}`;
}

/**
 * Polish prompt for ONE honor. Rewrites the name field only: grade level and
 * recognition level are facts only the applicant knows, the same rule the
 * activities polish applies to hours and weeks.
 */
export function buildHonorPolishPrompt({ honor, index = 0, honors = [], profileText = '', materialsText = '', applicantText = '' }) {
  const current = honor || {};
  const others = (honors || [])
    .map((item, i) => (i === index ? null : `${i + 1}. ${item.name || '(no name)'} — grade ${item.grade_level || '?'}, ${item.level || '?'} level`))
    .filter(Boolean)
    .join('\n');
  return `You are a college admissions counsellor who has read tens of thousands of Common App honors lines. You are improving ONE of them — its wording, nothing else.

${HONOR_SECTION_BRIEF}

HARD FIELD LIMIT (the Common App form enforces it — longer is truncated, so it is wasted):
- Name of honor: ${HONOR_LIMITS.name} characters including spaces. Count before you answer.

THE HONOR TO IMPROVE (slot ${index + 1} of ${(honors || []).length || 1}):
- Name: ${current.name || '(empty)'}
- Grade level: ${current.grade_level || '(not chosen)'} · Recognition level: ${current.level || '(not chosen)'}
${honorNoteBrief(current) ? `\n${honorNoteBrief(current)}\n` : ''}${others ? `\nTHE OTHER SLOTS (do not repeat what one of these already says):\n${others}\n` : ''}
${profileText ? `APPLICANT PROFILE (context only — never add a fact that is not already in this entry, its note, the profile, or the materials):\n${profileText}\n` : ''}
${materialsText ? `SUPPORTING MATERIALS (use only to recover the official title, the tier, or the scale this student really has; a sample's life is never this student's):\n${materialsText}\n` : ''}
${applicantText ? `WHAT ATLAS KNOWS ABOUT THIS APPLICANT:\n${applicantText}\n` : ''}
Do this:
1. Read the line as the reader does, in two seconds. What does it currently prove? Usually less than the student thinks.
2. Rewrite the NAME so it carries the award's official title, the tier won, and the selectivity that is actually stated somewhere in the evidence above — maximum clarity per character, no marketing.
3. Keep every fact exactly as given. You may reword, expand an abbreviation, reorder, and attach the qualifier that states WHICH tier or how selective. You may NOT invent a number, a rank, a sponsor, a date, a scope, or an outcome. If the missing piece would make this line land, name it in "missing_facts" — do not write it.
4. Do not change grade_level or level: those are the applicant's facts, not yours, and the form reads them from the entry.
5. Never pad: if the name is already exact and inside the limit, say so in "verdict" and return it unchanged.

Return JSON only:
- "name": the improved honor name, inside ${HONOR_LIMITS.name} characters (or the original, unchanged, when it already works).
- "changes": one entry per field you changed, { "field", "original", "revised", "reason" } — "reason" must quote where the added wording came from (the entry, its note, the profile, or a material).
- "missing_facts": what the applicant should add to the note box so the next pass can use it (e.g. "the number of entrants the finalist pool was cut from").
- "verdict": one sentence: what this line now proves to a reader.`;
}

export const HONOR_POLISH_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          original: { type: 'string' },
          revised: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    missing_facts: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
};

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Lay a model's answer over one honor entry: only the NAME is ever touched, and
 * only within the Common App limit (cut at a word boundary, with the UI told it
 * was cut — the same contract as the activities fields).
 */
export function sanitizeHonorPolish(raw, current = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const fitted = fitName(source.name ?? current.name ?? '');
  return {
    honor: { ...current, name: fitted.text },
    truncations: fitted.truncated ? ['name'] : [],
    changes: (Array.isArray(source.changes) ? source.changes : [])
      .map((item) => ({
        field: cleanText(item?.field) || 'name',
        original: cleanText(item?.original),
        revised: cleanText(item?.revised),
        reason: cleanText(item?.reason),
      }))
      .slice(0, 4),
    missingFacts: (Array.isArray(source.missing_facts) ? source.missing_facts : []).map(cleanText).filter(Boolean).slice(0, 4),
    verdict: cleanText(source.verdict).slice(0, 400),
  };
}

/** Whether a polished honor is actually different — an unchanged proposal is not an improvement. */
export function honorPolishDiffers(before, after) {
  return cleanText(before?.name) !== cleanText(after?.name);
}

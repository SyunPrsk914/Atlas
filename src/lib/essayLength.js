// The length contract for every piece of writing in Atlas.
//
// Why this exists: an essay that comes back at 480 words against a 650-word
// limit — or 10 words against a 50-word limit — is unfinished work, and Atlas
// used to save it without a word of complaint. `measureEssay()` was only ever
// used for the counter in the UI, never to judge what a model returned.
//
// This module is the single source of truth for "how long should this be?",
// so the generate prompt, the edit prompt, the length-repair prompt, the
// validation after every AI answer, and the meter in the editor all agree.
// It is pure (no browser, no app imports) so `npm run verify` can test it.

import {
  COMMON_APP_PERSONAL_STATEMENT,
  UCAS_RULES,
  formatLimit,
  isCommonAppPersonalStatement,
  isUcasQuestion,
  limitUnitFor,
  measureEssay,
  ucasCharacterBudget,
  ucasQuestionFor,
} from './applicationData';

/**
 * How much of the space a finished draft must use.
 * 0.9 of 650 = 585 words: admissions readers do treat an empty quarter of the
 * personal statement as a quarter of the story you did not tell. Short-answer
 * prompts get the same ratio, so a 50-word question needs at least 45 words.
 */
export const TARGET_FILL_RATIO = 0.9;

/**
 * Below this share the draft is not "a little short", it is broken: a stub, a
 * truncated model response, or an edit that threw the essay away.
 */
export const SEVERE_FILL_RATIO = 0.6;

/** Default share of a UCAS answer when a question does not state one. */
const DEFAULT_UCAS_SHARE = { low: 0.3, high: 0.34 };

/**
 * Reads "40-50% of the statement" (the researched share in UCAS_QUESTIONS)
 * into fractions. Returns null when the string does not carry a range.
 */
export function parseSuggestedShare(text) {
  const value = String(text || '');
  const range = value.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*%/);
  if (range) {
    const low = Number(range[1]) / 100;
    const high = Number(range[2]) / 100;
    if (Number.isFinite(low) && Number.isFinite(high)) {
      return { low: Math.min(low, high), high: Math.max(low, high) };
    }
  }
  const single = value.match(/(\d+(?:\.\d+)?)\s*%/);
  if (single && Number.isFinite(Number(single[1]))) {
    const share = Number(single[1]) / 100;
    return { low: share, high: share };
  }
  return null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * The numbers a draft is judged against.
 *
 * @param {object} essay        the essay row (word_limit, limit_unit, prompt…)
 * @param {object[]} allEssays  every essay, needed for the shared UCAS budget
 * @param {string} [draftText]  text to measure instead of `essay.content`
 * @returns {{
 *   unit: 'words' | 'characters', count: number, limit: number,
 *   targetLow: number, targetHigh: number, hardFloor: number,
 *   platformMin: number, questionNumber: number | null,
 *   shared: { total: number, limit: number, usedByOthers: number, room: number } | null,
 * }}
 */
export function lengthContract(essay, allEssays = [], draftText) {
  const text = draftText === undefined ? String(essay?.content || '') : String(draftText || '');
  const unit = limitUnitFor(essay);
  const count = measureEssay(text, unit);

  if (isUcasQuestion(essay)) {
    const question = ucasQuestionFor(essay);
    const minChars = Number(question?.minChars) || UCAS_RULES.perAnswerMinChars;
    const rows = (allEssays?.length ? allEssays : [essay])
      .map((row) => (row?.id && essay?.id && row.id === essay.id ? { ...row, content: text } : row));
    const budget = ucasCharacterBudget(rows);
    const usedByOthers = Math.max(0, budget.total - count);
    const room = Math.max(0, budget.limit - usedByOthers);
    const share = parseSuggestedShare(question?.suggestedShare) || DEFAULT_UCAS_SHARE;
    // The three answers share 4,000 characters, so the ceiling for this box is
    // what is left, while the target is the researched share of the whole.
    const targetHigh = clamp(Math.round(budget.limit * share.high), minChars, Math.max(minChars, room));
    const targetLow = clamp(Math.round(budget.limit * share.low), minChars, Math.max(minChars, targetHigh));
    return {
      unit,
      count,
      limit: room,
      targetLow,
      targetHigh,
      hardFloor: Math.min(minChars, Math.max(1, room)),
      platformMin: minChars,
      questionNumber: question?.number ?? null,
      shared: { total: budget.total, limit: budget.limit, usedByOthers, room },
    };
  }

  const limit = Number(essay?.word_limit) || (unit === 'characters' ? UCAS_RULES.totalChars : COMMON_APP_PERSONAL_STATEMENT.maxWords);
  const platformMin = isCommonAppPersonalStatement(essay) ? COMMON_APP_PERSONAL_STATEMENT.minWords : 0;
  const targetLow = clamp(Math.ceil(limit * TARGET_FILL_RATIO), platformMin, limit);
  const targetHigh = limit;
  const hardFloor = clamp(Math.ceil(limit * SEVERE_FILL_RATIO), Math.min(platformMin || 1, limit), limit);
  return {
    unit,
    count,
    limit,
    targetLow,
    targetHigh,
    hardFloor,
    platformMin,
    questionNumber: null,
    shared: null,
  };
}

/**
 * Judge one body of text against its contract.
 *
 * `state`:
 *  - `empty`  nothing there at all
 *  - `over`   past the ceiling — a portal rejects this
 *  - `severe` under 60% of the space — a stub or a truncated model answer
 *  - `short`  inside the ceiling but under the target band
 *  - `ok`     in the target band
 *
 * @returns {object} the contract plus `{ state, ok, needsWork, shortfall, overage, ratio, message }`
 */
export function assessLength(text, essay, allEssays = []) {
  const contract = lengthContract(essay, allEssays, text);
  const { count, limit, targetLow, hardFloor, unit } = contract;
  const words = formatLimit(unit);

  let state;
  if (count <= 0) state = 'empty';
  else if (count > limit) state = 'over';
  else if (count < hardFloor) state = 'severe';
  else if (count < targetLow) state = 'short';
  else state = 'ok';

  const shortfall = Math.max(0, targetLow - count);
  const overage = Math.max(0, count - limit);
  const ratio = limit > 0 ? count / limit : 0;
  const percent = Math.round(ratio * 100);

  let message;
  if (state === 'empty') {
    message = `Nothing written yet. The target is ${targetLow.toLocaleString()}–${limit.toLocaleString()} ${words}.`;
  } else if (state === 'over') {
    message = `${count.toLocaleString()} of ${limit.toLocaleString()} ${words} — ${overage.toLocaleString()} over. The portal will not accept this.`;
  } else if (state === 'severe') {
    message = `Only ${count.toLocaleString()} of ${limit.toLocaleString()} ${words} (${percent}%). This reads as a stub or a cut-off answer, not a finished draft.`;
  } else if (state === 'short') {
    message = `${count.toLocaleString()} of ${limit.toLocaleString()} ${words} (${percent}%). ${shortfall.toLocaleString()} more ${words} of real material would use the space you paid for.`;
  } else {
    message = `${count.toLocaleString()} of ${limit.toLocaleString()} ${words} (${percent}%) — inside the target band.`;
  }

  return {
    ...contract,
    state,
    ok: state === 'ok',
    needsWork: state !== 'ok',
    shortfall,
    overage,
    ratio,
    percent,
    message,
  };
}

/**
 * How far a draft is from its target band, so two candidates can be compared.
 * 0 means the contract is satisfied; otherwise the number of words/characters
 * that would have to be added or removed.
 */
export function lengthDistance(assessment) {
  if (!assessment) return Number.POSITIVE_INFINITY;
  if (assessment.ok) return 0;
  return Math.max(assessment.shortfall || 0, assessment.overage || 0);
}

/** Which of two candidate drafts is closer to the contract. */
export function betterOnLength(left, right) {
  return lengthDistance(left) <= lengthDistance(right) ? left : right;
}

/**
 * How bad a length state is, for choosing between two candidates.
 * Being over the ceiling is worse than being short: a portal rejects an
 * over-length essay outright, while a short one is merely weak.
 */
export function lengthSeverity(assessment) {
  if (!assessment) return 9;
  switch (assessment.state) {
    case 'ok': return 0;
    case 'short': return 1;
    case 'severe': return 2;
    case 'empty': return 3;
    case 'over': return 4;
    default: return 9;
  }
}

/**
 * Whether `candidate` is a better answer to the length contract than `current`.
 * Used to decide if an automatic repair pass is worth keeping: a repair that
 * comes back worse than the draft it was fixing must be thrown away, not saved.
 */
export function isBetterLength(candidate, current) {
  if (!candidate) return false;
  if (!current) return true;
  if (candidate.state === 'ok') return current.state !== 'ok';
  const severity = lengthSeverity(candidate) - lengthSeverity(current);
  if (severity !== 0) {
    // Moving from over-the-ceiling to under-target is only an improvement when
    // the new draft is still a full-length essay rather than a stub: trimming
    // 653 words down to 300 would "fix" the length and destroy the draft.
    if (current.state === 'over') return candidate.count >= candidate.hardFloor;
    return severity < 0;
  }
  return lengthDistance(candidate) < lengthDistance(current);
}

/**
 * The LENGTH CONTRACT block that goes into every drafting, editing, and repair
 * prompt. It is written as a rule the model can check its own output against,
 * because "respect the limit" on its own is what produced 480-word essays.
 */
export function buildLengthContractText(essay, allEssays = [], draftText) {
  const c = lengthContract(essay, allEssays, draftText);
  const words = formatLimit(c.unit);
  const band = c.targetLow === c.targetHigh
    ? `exactly ${c.targetLow.toLocaleString()} ${words}`
    : `${c.targetLow.toLocaleString()} to ${c.targetHigh.toLocaleString()} ${words}`;
  const lines = [
    `LENGTH CONTRACT (checked automatically after you answer — a draft outside it is sent back to you):`,
    `- Target band: ${band}. Aim for the top of that band.`,
    `- Hard ceiling: ${c.limit.toLocaleString()} ${words}${c.unit === 'characters' ? ', counting every space' : ''}. Never exceed it.`,
    `- Anything below ${c.hardFloor.toLocaleString()} ${words} is treated as an unfinished stub and is rejected.`,
  ];
  if (c.platformMin && c.platformMin !== c.hardFloor) {
    lines.push(`- The platform itself refuses fewer than ${c.platformMin.toLocaleString()} ${words}.`);
  }
  if (c.shared) {
    lines.push(
      `- This is UCAS question ${c.questionNumber} of 3. The other two answers already use ${c.shared.usedByOthers.toLocaleString()} of the shared ${c.shared.limit.toLocaleString()} characters, so this box has ${c.shared.room.toLocaleString()} characters of room. Fill your share; do not consume the whole budget here.`,
    );
  }
  lines.push(
    `- Count your own output before you return it. If you are under the band, the answer is not finished: add substance, not words.`,
  );
  return lines.join('\n');
}

/**
 * How to reach the target band honestly. Shared by the generate prompt, the
 * edit prompt, and the repair prompt, so an expansion never means padding.
 */
export const LENGTH_CRAFT_RULES = `HOW TO USE THE FULL SPACE WITHOUT PADDING:
- Reach the target band by DEEPENING what is already there: the exact room, the exact words someone said, the specific object, the number, the moment before and the moment after. A scene that is told in one sentence usually deserves three.
- Never pad. No summary paragraphs, no restating the point, no "what this taught me" coda, no list of extra achievements to fill space, no adjectives doing the work a noun should do.
- If you are over the ceiling, cut the sentences that only announce meaning. Keep the ones that carry evidence.
- Short prompts are not licenses to be brief. A 50-word answer needs 45-50 words: one concrete image and one consequence, compressed until every word is load-bearing.
- A draft that stops at 70% of its limit tells the reader you ran out of things to say. That is the single most common way a strong applicant loses an essay.`;

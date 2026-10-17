// Did the editor actually fix what the review flagged?
//
// The complaint is measured, not imagined: an applicant applies edits, spends a
// second model call, and the score does not move — because the edit improved some
// sentences and quietly left the exact phrases the reviewer objected to in the
// draft. A review already names those phrases verbatim (`quoted_evidence`, and
// the quotes inside `weaknesses` / `priority_improvements` / the per-dimension
// guidance), so whether an edit dealt with them is something Atlas can check in
// the browser instead of trusting the model's own change log.
//
// This module answers one question in one place: which flagged phrases are still
// in the text? The answer drives (a) an honest line in the comparison view, (b) a
// one-click follow-up edit that fixes only those, and (c) the `changes` list the
// editor has to fill in.
//
// Pure module: no browser, no React. `npm run verify` exercises it.

const CURLY = /[\u2018\u2019\u02bc]/g;
const CURLY_DOUBLE = /[\u201c\u201d]/g;

/** The same normalisation the word diff uses, so a curly quote is not a new phrase. */
export function normalizePhrase(value) {
  return String(value || '')
    .replace(CURLY, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Anything inside quotation marks in a sentence of feedback. */
const QUOTED = /[“"'`]([^“”"'`]{8,160})[”"'`]/g;

const isPhrase = (value) => {
  const text = String(value || '').trim();
  if (text.length < 8 || text.length > 220) return false;
  // A whole sentence of advice is not a phrase to find in the draft. Two words is
  // the floor: a reviewer quoting "the system" or "in the end" is naming a line,
  // and those short tics are exactly what an edit is supposed to remove.
  if (text.split(/\s+/).length < 2) return false;
  // An abstract instruction ("add a physical detail here") is not a quote either.
  return /[a-z]{3}/i.test(text);
};

/**
 * Every exact phrase the last review objected to, as it should appear in the text.
 *
 * @param {object} review a stored admissions review
 * @returns {string[]} de-duplicated phrases, in the order the review raised them
 */
export function extractFlaggedPhrases(review) {
  if (!review || typeof review !== 'object') return [];
  const found = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (text) found.push(text);
  };
  for (const item of review.quoted_evidence || []) push(item);
  for (const list of [review.weaknesses, review.priority_improvements, review.ai_patterns_detected]) {
    for (const item of list || []) {
      const text = typeof item === 'string' ? item : item?.suggestion || '';
      for (const match of String(text).matchAll(QUOTED)) push(match[1]);
    }
  }
  for (const item of review.per_dimension || []) {
    for (const field of ['evidence', 'how_to_reach_ten']) {
      for (const match of String(item?.[field] || '').matchAll(QUOTED)) push(match[1]);
    }
  }
  const seen = new Set();
  const out = [];
  for (const phrase of found) {
    if (!isPhrase(phrase)) continue;
    const key = normalizePhrase(phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return out.slice(0, 24);
}

/**
 * Which flagged phrases survived an edit.
 *
 * A phrase is "fixed" when it is no longer in the text, and "still there" when it
 * is. Atlas does not judge whether the fix was worth it — it only refuses to let
 * "the review said X and the edit did nothing about X" pass unnoticed.
 *
 * @param {object} review the review the edit was asked to answer
 * @param {string} afterText the text now in the editor
 * @param {string} [beforeText] the text before the edit, to report what changed
 */
export function findUnaddressedFindings(review, afterText, beforeText = '') {
  const phrases = extractFlaggedPhrases(review);
  if (!phrases.length) {
    return { total: 0, stillPresent: [], fixed: [], message: '', hadNothing: true };
  }
  const haystack = normalizePhrase(afterText);
  const before = normalizePhrase(beforeText);
  const stillPresent = [];
  const fixed = [];
  for (const phrase of phrases) {
    const key = normalizePhrase(phrase);
    if (!key) continue;
    if (haystack.includes(key)) stillPresent.push(phrase);
    else if (before.includes(key)) fixed.push(phrase);
    // A phrase that was never in the draft is the reviewer quoting something it
    // imagined. It is neither fixed nor unfixed, and Atlas does not claim it was.
  }
  const message = stillPresent.length
    ? `${stillPresent.length} of the ${phrases.length} phrase${phrases.length === 1 ? '' : 's'} the review objected to ${stillPresent.length === 1 ? 'is' : 'are'} still in the draft, unchanged.`
    : '';
  return { total: phrases.length, stillPresent, fixed, message, hadNothing: false };
}

/** One honest sentence for the applicant, or '' when there is nothing to report. */
export function unaddressedBrief(result) {
  if (!result || result.hadNothing) return '';
  if (!result.total) return '';
  if (!result.stillPresent.length) {
    return result.fixed.length
      ? `Every phrase the review flagged is gone from the draft (${result.fixed.length} removed or rewritten).`
      : '';
  }
  // Name one of them: "2 phrases are still there" is a statistic, and the
  // applicant needs to see which one to believe it.
  const lead = result.stillPresent[0] || '';
  return `${result.message}${lead ? ` The first is “${lead}”.` : ''}`;
}

// ---------------------------------------------------------------------------
// Did the editor carry out the applicant's own instructions?
// ---------------------------------------------------------------------------
//
// The applicant can write "cut the robotics paragraph", "replace 'I was
// passionate' with 'I kept showing up'", "keep the last line". The model is
// asked to report each one, but a self-report is not evidence. Where an
// instruction quotes text, Atlas can check the draft itself: a REMOVE/REPLACE
// instruction is met when the quoted words are gone, a KEEP instruction when
// they survive, an ADD instruction when they appear. Everything else is shown
// as the model's own claim, marked as unverified, so "followed" never means
// more than Atlas can stand behind.

// Double quotes, curly quotes, backticks, and single quotes that stand at a
// word boundary — never the apostrophe in "don't" or "teacher's".
const QUOTED_ANY = /“([^“”]{3,200})”|"([^"]{3,200})"|`([^`]{3,200})`|(?:^|[\s([{,:;—–-])'([^']{3,200})'(?=$|[\s)\]}.,:;!?—–-])/g;
const REMOVE_WORDS = /\b(cut|delete|remove|drop|take out|get rid of|strike|replace|rewrite|reword|rephrase|change|swap|shorten|trim)\b/i;
const KEEP_WORDS = /\b(keep|leave|preserve|retain|do not (change|touch|cut|remove|edit)|don't (change|touch|cut|remove|edit)|exactly as (it )?is|unchanged|as is)\b/i;
const ADD_WORDS = /\b(add|insert|include|mention|put in|bring in|work in|say that|state that|name)\b/i;

/** Quoted phrases in an instruction, in order. */
function quotedIn(instruction) {
  const out = [];
  let match;
  QUOTED_ANY.lastIndex = 0;
  while ((match = QUOTED_ANY.exec(String(instruction || ''))) !== null) {
    const phrase = String(match[1] || match[2] || match[3] || match[4] || '').trim();
    if (phrase) out.push(phrase);
  }
  return out;
}

/** What one instruction asks for, as far as Atlas can tell from its wording. */
export function classifyInstruction(instruction) {
  const text = String(instruction || '');
  const quotes = quotedIn(text);
  // "Replace 'a' with 'b'" names what goes and what comes; check both.
  if (/\b(replace|swap|change)\b/i.test(text) && quotes.length >= 2) return { kind: 'replace', remove: [quotes[0]], add: [quotes[1]] };
  if (KEEP_WORDS.test(text) && quotes.length) return { kind: 'keep', remove: [], add: [], keep: quotes };
  if (REMOVE_WORDS.test(text) && quotes.length) return { kind: 'remove', remove: quotes, add: [] };
  if (ADD_WORDS.test(text) && quotes.length) return { kind: 'add', remove: [], add: quotes };
  return { kind: 'other', remove: [], add: [], keep: [] };
}

/**
 * Checks each instruction against the text before and after the edit.
 *
 * @param {string[]} instructions the sentences from splitEditInstructions
 * @param {string} beforeText
 * @param {string} afterText
 * @param {{ instructions_followed?: Array<{instruction?: string, how?: string}>, instructions_not_followed?: Array<{instruction?: string, why?: string}> }} [report] the model's own account
 * @returns {{ total: number, items: Array<{ instruction: string, status: string, detail: string }>, missed: number, declined: number, verified: number, message: string, hadNothing: boolean }}
 *   `status` is one of 'done' | 'missed' | 'reported' | 'declined' | 'unverified'.
 */
export function checkInstructionsFollowed(instructions, beforeText, afterText, report = null) {
  const list = (instructions || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!list.length) return { total: 0, items: [], missed: 0, declined: 0, verified: 0, message: '', hadNothing: true };
  const before = normalizePhrase(beforeText);
  const after = normalizePhrase(afterText);
  const claimed = (report?.instructions_followed || []).map((entry) => ({ key: normalizePhrase(entry?.instruction), how: String(entry?.how || '').trim() }));
  const declined = (report?.instructions_not_followed || []).map((entry) => ({ key: normalizePhrase(entry?.instruction), why: String(entry?.why || '').trim() }));
  const matchReport = (entries, instruction) => {
    const key = normalizePhrase(instruction);
    const short = key.replace(/[.!?]+$/, '');
    return entries.find((entry) => entry.key && (entry.key === key || entry.key.includes(short) || short.includes(entry.key.replace(/[.!?]+$/, '')))) || null;
  };

  const items = list.map((instruction) => {
    const shape = classifyInstruction(instruction);
    const refused = matchReport(declined, instruction);
    const has = (text, phrase) => text.includes(normalizePhrase(phrase));
    if (shape.kind === 'remove' || shape.kind === 'replace') {
      const stillThere = shape.remove.filter((phrase) => has(after, phrase));
      const neverThere = shape.remove.filter((phrase) => !has(before, phrase));
      if (neverThere.length === shape.remove.length) {
        return { instruction, status: 'unverified', detail: `“${neverThere[0]}” was not in the draft before the edit, so there was nothing to remove.` };
      }
      if (stillThere.length) {
        return { instruction, status: 'missed', detail: `“${stillThere[0]}” is still in the draft.` };
      }
      const missingAdd = (shape.add || []).filter((phrase) => !has(after, phrase));
      if (missingAdd.length) {
        return { instruction, status: 'missed', detail: `“${shape.remove[0]}” is gone, but “${missingAdd[0]}” did not appear in its place.` };
      }
      return { instruction, status: 'done', detail: shape.kind === 'replace' ? `“${shape.remove[0]}” is gone and “${shape.add[0]}” is in the draft.` : `“${shape.remove[0]}” is gone.` };
    }
    if (shape.kind === 'keep') {
      const lost = shape.keep.filter((phrase) => has(before, phrase) && !has(after, phrase));
      if (lost.length) return { instruction, status: 'missed', detail: `“${lost[0]}” was changed or removed.` };
      const present = shape.keep.filter((phrase) => has(after, phrase));
      return present.length
        ? { instruction, status: 'done', detail: `“${present[0]}” survives word for word.` }
        : { instruction, status: 'unverified', detail: `“${shape.keep[0]}” was not in the draft to begin with.` };
    }
    if (shape.kind === 'add') {
      const added = shape.add.filter((phrase) => has(after, phrase));
      if (added.length) return { instruction, status: 'done', detail: `“${added[0]}” is in the draft.` };
      if (refused) return { instruction, status: 'declined', detail: refused.why || 'The editor said it could not do this.' };
      return { instruction, status: 'missed', detail: `“${shape.add[0]}” does not appear in the draft.` };
    }
    // No quoted words to check: fall back to the model's own account.
    if (refused) return { instruction, status: 'declined', detail: refused.why || 'The editor said it could not do this.' };
    const done = matchReport(claimed, instruction);
    if (done) return { instruction, status: 'reported', detail: done.how ? `The editor reports: ${done.how}` : 'The editor reports it was carried out (not verified by Atlas).' };
    return { instruction, status: 'unverified', detail: 'The editor did not report on this instruction, and it quotes no words Atlas can check.' };
  });

  const missed = items.filter((item) => item.status === 'missed').length;
  const refusedCount = items.filter((item) => item.status === 'declined').length;
  const verified = items.filter((item) => item.status === 'done').length;
  const message = missed
    ? `${missed} of your ${list.length} edit instruction${list.length === 1 ? '' : 's'} ${missed === 1 ? 'was' : 'were'} not carried out.`
    : refusedCount
      ? `The editor declined ${refusedCount} of your ${list.length} instruction${list.length === 1 ? '' : 's'} and said why.`
      : '';
  return { total: list.length, items, missed, declined: refusedCount, verified, message, hadNothing: false };
}

/** One honest sentence about the instructions, or '' when there is nothing to say. */
export function instructionsBrief(result) {
  if (!result || result.hadNothing || !result.total) return '';
  if (result.missed) {
    const first = result.items.find((item) => item.status === 'missed');
    return `${result.message}${first ? ` First: “${first.instruction}” — ${first.detail}` : ''}`;
  }
  if (result.declined) return result.message;
  return result.verified
    ? `All ${result.total} of your edit instruction${result.total === 1 ? ' was' : 's were'} carried out (${result.verified} checked against the text by Atlas).`
    : `The editor reports all ${result.total} of your instruction${result.total === 1 ? '' : 's'} as done; none quoted words Atlas could check itself.`;
}

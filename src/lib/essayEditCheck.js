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

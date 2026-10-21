// Word-level diff between two versions of a text.
//
// Atlas now shows what an AI edit actually changed, instead of silently
// replacing the draft. This module is pure (no React, no app imports) so it can
// be exercised by `npm run verify`, and so the same alignment can drive both
// the highlighted comparison view and the "how much of my draft survived?"
// number that guards against an edit throwing the essay away.
//
// Algorithm: classic longest-common-subsequence over word chunks, with the
// whitespace that follows each word carried along so the rendered result reads
// like the original paragraph structure. Very long inputs fall back to
// sentence-level chunks so the O(n*m) table stays small.

/** Above this many units per side, diff sentences instead of words. */
export const MAX_DIFF_UNITS = 1600;

const CURLY_SINGLE = /[\u2018\u2019\u02bc]/g;
const CURLY_DOUBLE = /[\u201c\u201d]/g;
const DASHES = /[\u2013\u2014\u2015]/g;

/**
 * Comparison key for one unit. Models routinely swap straight quotes for curly
 * ones and hyphens for en-dashes; that is typography, not an edit, so it must
 * not be highlighted as a change.
 */
export function normalizeUnit(value) {
  return String(value || '')
    .replace(CURLY_SINGLE, "'")
    .replace(CURLY_DOUBLE, '"')
    .replace(DASHES, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Splits text into `{ word, space }` chunks, keeping the whitespace that
 * follows each word so the pieces can be concatenated back into the original.
 */
export function wordChunks(text) {
  const value = String(text || '');
  const chunks = [];
  const wordRe = /\S+/g;
  const spaceRe = /\s*/y;
  let match;
  let cursor = 0;
  while ((match = wordRe.exec(value)) !== null) {
    if (match.index > cursor) chunks.push({ word: '', space: value.slice(cursor, match.index) });
    const end = match.index + match[0].length;
    spaceRe.lastIndex = end;
    const following = spaceRe.exec(value)[0];
    chunks.push({ word: match[0], space: following });
    cursor = end + following.length;
  }
  if (cursor < value.length) chunks.push({ word: '', space: value.slice(cursor) });
  return chunks;
}

/**
 * Groups word chunks into sentences (or paragraphs). Used only when a text is
 * too long for a word-level alignment table.
 */
export function sentenceChunks(text) {
  const chunks = [];
  let current = null;
  const flush = () => {
    if (current && (current.word || current.space)) chunks.push(current);
    current = null;
  };
  for (const piece of wordChunks(text)) {
    if (!current) current = { word: '', space: '' };
    if (!piece.word) {
      const breaks = /\n/.test(piece.space) && !!current.word;
      current.space += piece.space;
      if (breaks) flush();
      continue;
    }
    current.word = current.word ? current.word + current.space + piece.word : current.space + piece.word;
    current.space = piece.space;
    if (/[.!?]["')\]]*$/.test(piece.word) || /\n/.test(piece.space)) flush();
  }
  flush();
  return chunks;
}

/** Longest common subsequence, returned as index pairs into `a` and `b`. */
function lcsPairs(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i += 1) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return pairs;
}

/**
 * Aligns two chunk lists into an ordered list of operations.
 * @returns {{ type: 'equal' | 'add' | 'del', word: string, space: string }[]}
 */
export function diffChunks(oldChunks, newChunks) {
  const a = (oldChunks || []).map((chunk) => ({ ...chunk, key: normalizeUnit(chunk.word) }));
  const b = (newChunks || []).map((chunk) => ({ ...chunk, key: normalizeUnit(chunk.word) }));
  const aWords = a.map((chunk, index) => index).filter((index) => a[index].word !== '');
  const bWords = b.map((chunk, index) => index).filter((index) => b[index].word !== '');
  const pairs = lcsPairs(aWords.map((index) => a[index].key), bWords.map((index) => b[index].key));

  /** @type {{ type: 'equal' | 'add' | 'del', word: string, space: string }[]} */
  const ops = [];
  let ia = 0;
  let ib = 0;
  for (const [pa, pb] of pairs) {
    const oa = aWords[pa];
    const ob = bWords[pb];
    while (ia < oa) { ops.push({ type: 'del', word: a[ia].word, space: a[ia].space }); ia += 1; }
    while (ib < ob) { ops.push({ type: 'add', word: b[ib].word, space: b[ib].space }); ib += 1; }
    // Whitespace comes from the new version, so the comparison reads like the
    // text that is now in the editor.
    ops.push({ type: 'equal', word: b[ob].word, space: b[ob].space });
    ia = oa + 1;
    ib = ob + 1;
  }
  while (ia < a.length) { ops.push({ type: 'del', word: a[ia].word, space: a[ia].space }); ia += 1; }
  while (ib < b.length) { ops.push({ type: 'add', word: b[ib].word, space: b[ib].space }); ib += 1; }
  return ops;
}

/**
 * Diff two bodies of text. Picks word granularity for anything essay-sized and
 * sentence granularity for very long inputs so the alignment stays fast.
 * @returns {{ ops: object[], unit: 'word' | 'sentence' }}
 */
export function diffText(oldText, newText) {
  const oldChunks = wordChunks(oldText);
  const newChunks = wordChunks(newText);
  const oldWords = oldChunks.filter((chunk) => chunk.word).length;
  const newWords = newChunks.filter((chunk) => chunk.word).length;
  if (oldWords > MAX_DIFF_UNITS || newWords > MAX_DIFF_UNITS) {
    return { ops: diffChunks(sentenceChunks(oldText), sentenceChunks(newText)), unit: 'sentence' };
  }
  return { ops: diffChunks(oldChunks, newChunks), unit: 'word' };
}

/**
 * What the diff means, in numbers.
 *
 * `preservedRatio` is the share of the ORIGINAL words that survived the edit —
 * the number that tells an applicant whether the editor polished their essay
 * or replaced it. `rewriteRatio` is the share of the NEW text that is newly
 * written. Both are 0-1.
 */
export function diffStats(ops) {
  const list = ops || [];
  const added = list.filter((op) => op.type === 'add' && op.word).length;
  const removed = list.filter((op) => op.type === 'del' && op.word).length;
  const kept = list.filter((op) => op.type === 'equal' && op.word).length;
  const oldTotal = kept + removed;
  const newTotal = kept + added;
  return {
    added,
    removed,
    kept,
    oldTotal,
    newTotal,
    preservedRatio: oldTotal ? kept / oldTotal : 1,
    rewriteRatio: newTotal ? added / newTotal : 0,
    netChange: newTotal - oldTotal,
  };
}

/**
 * The conservation contract, in one place.
 *
 * The editing prompts state a floor ("keep at least 80% of the applicant's own
 * words"); this constant is that same floor, so the number the model is asked to
 * honour and the number Atlas measures the answer against cannot drift apart.
 * A figure below it is not a polish that came out slightly aggressive: it is the
 * contract broken, and the caller acts on it (send the edit back, then put the
 * applicant's text back) rather than only reporting it.
 */
export const PRESERVATION_FLOOR = 0.8;

/**
 * Below this the draft was not edited at all — it was replaced. Kept apart from
 * the contract floor so the UI can tell "you broke the 80% rule" from "you threw
 * the applicant's essay away", which are different failures.
 */
export const REPLACEMENT_FLOOR = 0.55;

/** @deprecated the contract is a floor, not a tolerated share of the rewrite. */
export const MAX_ACCEPTABLE_REWRITE = 1 - PRESERVATION_FLOOR;

/** True when fewer than 80% of the original words survived — the contract, measured. */
export function isAggressiveRewrite(stats) {
  if (!stats || !stats.oldTotal) return false;
  return stats.preservedRatio < PRESERVATION_FLOOR;
}

/** True when fewer than 55% survived: the applicant's draft no longer exists. */
export function isDraftReplaced(stats) {
  if (!stats || !stats.oldTotal) return false;
  return stats.preservedRatio < REPLACEMENT_FLOOR;
}

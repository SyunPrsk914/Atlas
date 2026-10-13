// One clipping rule for every block of text Atlas puts into a prompt.
//
// Why this module exists: the app used to enforce its context budgets with raw
// `text.slice(0, N)` calls scattered over six modules. A character slice knows
// nothing about words or sentences, so a Knowledge Base item ended as
// "…someone who de" and the model received a half-sentence with nothing after
// it — and the reader could not tell that the rest of their own material had
// been dropped. Two things are therefore required of every cut: finish the
// sentence, and never let information disappear without saying so.
//
// Two rules follow from that, and both are checked by `npm run verify`:
//   1. a cut never splits a word, and prefers the end of a sentence or line;
//   2. a cut always announces itself. Text is either whole or marked as cut —
//      it is never silently shortened, and never silently dropped.
//
// Pure module: no browser, no React, no app imports, so Node can test it.

/** The smallest share of the budget a boundary may leave behind before giving up. */
const MIN_FILL = 0.55;

/** `1,234` — the app's other formatters use toLocaleString for counts. */
const num = (value) => Number(value || 0).toLocaleString();

/**
 * Where a slice of `head` may end without cutting a word or a sentence in half.
 * @returns {number} an exclusive end index, always > 0 and <= head.length
 */
function boundaryEnd(head) {
  const floor = Math.floor(head.length * MIN_FILL);
  // A finished sentence is the best place to stop; a paragraph break and then a
  // line break are the next best; a word edge is the last one that still counts.
  const sentence = matchEnd(head, /[.!?]["')\]]*(?=\s|$)/, floor);
  if (sentence !== -1) return sentence;
  const paragraph = head.lastIndexOf('\n\n');
  if (paragraph >= floor) return paragraph;
  const line = head.lastIndexOf('\n');
  if (line >= floor) return line;
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\t'));
  if (space >= floor) return space;
  const anySpace = head.search(/\s+(?=\S*$)/);
  return anySpace > 0 ? anySpace : head.length;
}

/** End index of the last match of `pattern` at or after `floor`, or -1. */
function matchEnd(head, pattern, floor) {
  const scan = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  let best = -1;
  let match;
  while ((match = scan.exec(head))) {
    const end = match.index + match[0].length;
    if (end >= floor) best = end;
  }
  return best;
}

/**
 * Cut `text` to about `max` characters without splitting a word.
 *
 * `marker` decides what happens when text is left out:
 *   - the default sentence names how many characters did not fit;
 *   - `null` returns the kept text with no note (for previews, which have no
 *     room for one — `previewClip` adds the ellipsis instead);
 *   - a string is used verbatim, and a function is called with the number of
 *     dropped characters, so a caller can keep its own wording and its own
 *     count.
 *
 * @param {string} text
 * @param {number} max
 * @param {{ marker?: string | null | ((dropped: number) => string) }} [opts]
 * @returns {string}
 */
export function clipToBoundary(text, max, opts = {}) {
  const value = String(text || '');
  const budget = Number(max);
  if (!Number.isFinite(budget) || budget <= 0 || value.length <= budget) return value;
  const kept = value.slice(0, budget).slice(0, boundaryEnd(value.slice(0, budget))).trimEnd();
  // A pathological input with no boundary at all must not collapse to nothing.
  const safe = kept || value.slice(0, budget).trimEnd();
  const dropped = value.length - safe.length;
  if (dropped <= 0) return safe;
  if (opts.marker === null) return safe;
  const marker = typeof opts.marker === 'function'
    ? opts.marker(dropped)
    : opts.marker ?? `\n[… ${num(dropped)} more characters left out to fit the AI's context window.]`;
  return `${safe}${marker}`;
}

/** A UI preview: cut at a word boundary and end with an ellipsis, never mid-word. */
export function previewClip(text, max) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  const head = value.slice(0, max);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
  const kept = (space > max * MIN_FILL ? head.slice(0, space) : head).trimEnd();
  return `${kept}…`;
}

/**
 * Take whole blocks in priority order until the budget runs out.
 *
 * Blocks are indivisible: a material, a Knowledge Base item, or an essay is
 * either included in full or left out and named. That is what keeps a long
 * item from ending mid-sentence, and it is why `omitted` exists — the caller
 * must show the reader what did not fit instead of letting it vanish.
 *
 * The first block is always kept (clipped if it alone exceeds the budget), so a
 * prompt never arrives empty.
 *
 * @template T
 * @param {T[]} blocks in the order they should be consumed
 * @param {number} totalChars
 * @param {(block: T) => number} [costOf] defaults to String(block).length
 * @returns {{ kept: T[], omitted: T[], used: number }}
 */
export function packBlocks(blocks, totalChars, costOf = (block) => String(block || '').length) {
  const list = Array.isArray(blocks) ? blocks : [];
  const budget = Number(totalChars);
  const kept = [];
  const omitted = [];
  if (!Number.isFinite(budget) || budget <= 0) return { kept: list, omitted: [], used: 0 };
  let used = 0;
  for (let i = 0; i < list.length; i += 1) {
    const block = list[i];
    const cost = costOf(block);
    if (kept.length && used + cost > budget) {
      omitted.push(...list.slice(i));
      break;
    }
    kept.push(block);
    used += cost;
  }
  return { kept, omitted, used };
}

/**
 * The sentence that names what did not fit.
 * Returns '' when nothing was dropped, so callers can append it unconditionally.
 */
export function omissionNote(omitted, label, describe = (item) => String(item)) {
  const list = omitted || [];
  if (!list.length) return '';
  const names = list.slice(0, 12).map(describe).filter(Boolean).join('; ');
  const more = list.length - Math.min(12, list.length);
  return `\n${label}: ${names}${more > 0 ? ` (and ${num(more)} more)` : ''}. Their saved analysis is still on record — add a note to a source, or rebuild, to bring one forward.`;
}

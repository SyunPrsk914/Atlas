// The applicant's required root, read as an instruction rather than a keyword list.
//
// The complaint this answers is specific: an applicant writes "pick the most
// effective one of the below and expand about it", and a model takes all three,
// because three topics in the box look like three requirements. Asking the model
// nicely is already in the prompt (`rootBrief` in ./essayPrompts). This module is
// the part that verifies it afterwards, in Atlas's own code, so a draft that
// ignored or misread the direction is caught before it is presented as a finished
// essay.
//
// Two checks, both deliberately conservative:
//   - `ignored`: nothing in the draft grows from the direction at all;
//   - `crammed`: the direction asked for ONE of a list and the draft used all of them.
// Anything Atlas cannot decide from the words it has is reported as `uncertain`,
// which shows the applicant a note but never rewrites their essay.
//
// Pure module: no browser, no React. `npm run verify` exercises it.

/** "pick the best one", "choose only one of these", "use the most effective". */
const SELECT_ONE = new RegExp([
  // "pick one of these", "use the most effective", "focus on one"
  '\\b(pick|choose|select|use|take|start with|focus on|zero in on)\\b[^.\\n]{0,60}\\b(one|single|best|most|one of them|one of these|one of the)\\b',
  // "just one", "only one of the following"
  '\\b(only|just|exactly)\\s+(one|a single)\\b[^.\\n]{0,40}\\b(of|from)\\b',
  // "narrow to one", "commit to the best"
  '\\b(narrow|focus|zero in|commit)\\b[^.\\n]{0,30}\\b(to one|on one|to the best|to the most|to the one)\\b',
  // "the most effective one of the below"
  '\\bthe (most|best|strongest|most effective|most interesting) (one|of these|of them|of the)\\b',
].join('|'), 'i');

/** "include all three", "mention every one of these" — the opposite instruction. */
const INCLUDE_ALL = /\b(include|cover|mention|use|address|weave in)\b[^.\n]{0,40}\b(all|every|both|each|all of them|all three|each one|all of these)\b/i;

/** Words that make a phrase searchable in the draft. */
const STOP = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'your', 'you', 'about', 'into',
  'onto', 'over', 'under', 'then', 'than', 'them', 'they', 'their', 'what', 'when',
  'where', 'which', 'who', 'whom', 'will', 'would', 'should', 'could', 'have', 'has',
  'had', 'are', 'was', 'were', 'been', 'being', 'not', 'but', 'all', 'any', 'one',
  'two', 'its', 'our', 'his', 'her', 'please', 'more', 'most', 'also', 'because',
  'below', 'above', 'following', 'options', 'idea', 'ideas', 'topic', 'topics',
  'essay', 'prompt', 'something', 'somewhere', 'write', 'writing', 'make', 'makes',
  'pick', 'pick', 'choose', 'chosen', 'select', 'expand', 'effective', 'interesting',
]);

function tokens(text) {
  return [...new Set(String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^['-]+|['-]+$/g, ''))
    .filter((word) => word.length > 3 && !STOP.has(word)))];
}

const LINE_BULLET = /^\s*(?:[-*•–—]|\d+[.)])\s*(.+?)\s*$/;
const SLASH_SPLIT = /\s*(?:\s+or\s+|\s*\|\s*|,\s+and\s+|\s+and\s+|,\s*or\s*)\s*/i;

/**
 * The alternatives the applicant put in the box, if they put any.
 *
 * Bullets and numbered lines are the trusted shape. A comma-separated run is
 * only split when the direction looks like a list of choices, because "write
 * about my grandma's kitchen, and how it smelled" is one idea, not two.
 */
function extractAlternatives(root, { selectionLike }) {
  const lines = String(root || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bulleted = lines
    .map((line) => line.match(LINE_BULLET)?.[1])
    .filter(Boolean);
  if (bulleted.length >= 2) return bulleted.filter((item) => item.length > 1);

  // A numbered list squeezed onto one line, which is how a pasted direction
  // usually arrives: "…expand about it: 1. the robotics build 2. the bakery job".
  const numbered = [...String(root || '').replace(/\r?\n/g, ' ')
    .matchAll(/(?:^|\s)\d{1,2}[.)]\s+([^\n]*?)(?=\s+\d{1,2}[.)]\s|$)/g)]
    .map((match) => match[1].trim().replace(/[.;:]+$/, ''))
    .filter((item) => item.length > 2 && tokens(item).length > 0);
  if (numbered.length >= 2) return numbered.slice(0, 8);

  // A single line such as "robotics, music, or tutoring" after "choose one".
  const inline = lines.find((line) => /(^|\s)(or|\/)(\s|$)/.test(line) || /,\s*[^,]{2,}\s*$/.test(line));
  if (!inline || !selectionLike) return [];
  const parts = inline
    .replace(/^.*\b(?:below|following|options|list)\b\s*[:\-]?\s*/i, '')
    .split(SLASH_SPLIT)
    .map((part) => part.replace(LINE_BULLET, '$1').trim().replace(/[.]+$/, ''))
    .filter((part) => part.length > 2 && tokens(part).length > 0);
  return parts.length >= 2 ? parts.slice(0, 8) : [];
}

/** Sentences that read as instructions about the essay, not as topics to cover. */
function extractConstraints(root) {
  const sentences = String(root || '')
    .split(/(?<=[.!?])\s+|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out = [];
  for (const sentence of sentences) {
    if (LINE_BULLET.test(sentence)) continue;
    const forbidden = /\b(do not|don't|dont|never|avoid|exclude|without|no\b)/i.test(sentence);
    const required = /\b(must|only|needs? to|make sure|keep|include|mention|use)\b/i.test(sentence);
    if (!forbidden && !required) continue;
    const words = tokens(sentence);
    if (!words.length) continue;
    out.push({ text: sentence, polarity: forbidden ? 'avoid' : 'require', words });
  }
  return out.slice(0, 8);
}

/**
 * The structured reading of the direction: is it a choice, what are the options,
 * and what did the applicant forbid or demand.
 */
export function interpretRoot(root) {
  const text = String(root || '').trim();
  if (!text) {
    return { text: '', hasRoot: false, chooseOne: false, includeAll: false, alternatives: [], constraints: [], words: [] };
  }
  const chooseOne = SELECT_ONE.test(text) && !INCLUDE_ALL.test(text);
  const includeAll = INCLUDE_ALL.test(text);
  const alternatives = extractAlternatives(text, { selectionLike: chooseOne || includeAll || /\b(below|following|options|either)\b/i.test(text) });
  return {
    text,
    hasRoot: true,
    chooseOne,
    includeAll,
    alternatives: alternatives.map((label) => ({ label, words: tokens(label) })),
    constraints: extractConstraints(text),
    words: tokens(text),
  };
}

/** Fraction of an item's distinctive words that appear in the draft. */
function coverageOf(words, draftWords) {
  if (!words.length) return 1;
  let hits = 0;
  for (const word of words) {
    // Stem-tolerant: "aerodynamics" matches "aerodynamic", "competing" matches "compete".
    const root = word.replace(/(ing|ed|es|s)$/, '');
    for (const candidate of draftWords) {
      if (candidate === word || (root.length > 4 && (candidate.startsWith(root) || word.startsWith(candidate.replace(/(ing|ed|es|s)$/, ''))))) {
        hits += 1;
        break;
      }
    }
  }
  return hits / words.length;
}

const MATCH_THRESHOLD = 0.5;

/**
 * Judge a finished draft against the direction it was given.
 *
 * @param {string|object} rootOrInterpretation the applicant's root, or `interpretRoot` output
 * @param {string} draft the generated text
 * @returns {{
 *   ok: boolean, status: 'no-root'|'respected'|'ignored'|'crammed'|'uncertain',
 *   message: string, correction: string,
 *   matched: string[], missing: string[], violations: string[],
 *   root: object
 * }}
 */
export function checkDraftAgainstRoot(rootOrInterpretation, draft) {
  const root = typeof rootOrInterpretation === 'string' || !rootOrInterpretation
    ? interpretRoot(rootOrInterpretation)
    : rootOrInterpretation;
  const plain = (status, ok, message, extra = {}) => ({
    ok, status, message, correction: '', matched: [], missing: [], violations: [], root, ...extra,
  });
  if (!root.hasRoot) return plain('no-root', true, '');
  const draftWords = tokens(draft);
  if (!draftWords.length) {
    return plain('uncertain', false, 'There is no draft text to check against the direction.');
  }

  const covered = (words) => coverageOf(words, draftWords) >= MATCH_THRESHOLD;
  const matched = [];
  const missing = [];
  if (root.alternatives.length) {
    for (const item of root.alternatives) {
      (covered(item.words) ? matched : missing).push(item.label);
    }
  }

  const violations = [];
  for (const constraint of root.constraints) {
    const present = covered(constraint.words);
    if (constraint.polarity === 'require' && !present) violations.push(constraint.text);
    if (constraint.polarity === 'avoid' && present && constraint.words.every((word) => draftWords.includes(word))) {
      violations.push(constraint.text);
    }
  }

  const overall = coverageOf(root.words, draftWords);
  const statusOf = () => {
    if (root.alternatives.length >= 2) {
      // "Pick the most effective one" answered with a paragraph about each of
      // them: the direction was read as an outline instead of a choice.
      if (root.chooseOne && matched.length >= 2) return 'crammed';
      if (matched.length === 0) return 'ignored';
      // "Include all of these" and only some arrived: worth telling, not worth
      // rewriting the essay for, because the model may have found one unusable.
      if (root.includeAll && matched.length < root.alternatives.length) return 'uncertain';
      return 'respected';
    }
    if (overall < 0.15) return 'ignored';
    if (overall < 0.35) return 'uncertain';
    return 'respected';
  };
  const status = statusOf();

  const messages = {
    crammed: `The direction asked for one of ${root.alternatives.length} options; the draft uses ${matched.length} of them (${matched.slice(0, 3).join('; ')}).`,
    ignored: 'Nothing in the draft grows from the required root, so the direction was not followed.',
    uncertain: 'Only part of the direction shows up in the draft — check that the essay is built on what you asked for.',
    respected: root.alternatives.length >= 2
      ? `Built on "${matched[0] || 'the stated direction'}", with the other options left out as asked.`
      : 'Built on the required root.',
  };
  const corrections = {
    crammed: `You were told to choose ONE. Rewrite the essay on the single strongest option (${matched[0]}), and delete the paragraphs that develop the others. Do not keep them as side threads: an essay that answers one question with three topics answers none of them.`,
    ignored: `You wrote an essay that does not grow from the applicant's required root. Start again from it — "${root.text}" — and keep everything else in your instructions, including the length contract.`,
  };

  return {
    ok: status === 'respected' || status === 'uncertain',
    status,
    message: messages[status] || '',
    correction: corrections[status] || (violations.length
      ? `The draft also breaks a stated rule: ${violations.join(' | ')}. Fix that without changing the story.`
      : ''),
    matched,
    missing,
    violations,
    root,
  };
}

/**
 * The wording Atlas shows the applicant after a root check, and the sentence it
 * sends back to the model. Kept here so the toast, the editor note, and the retry
 * prompt cannot disagree with each other.
 */
export function rootCheckBrief(check) {
  if (!check || check.status === 'no-root') return '';
  const lines = [];
  if (check.status === 'respected' && check.matched.length) {
    lines.push(`Root check: the draft was built on “${check.matched[0]}”. Options not used: ${check.missing.length ? check.missing.join(', ') : 'none'}.`);
  } else {
    lines.push(`Root check: ${check.message}`);
  }
  if (check.violations?.length) lines.push(`Stated rules the draft still breaks: ${check.violations.join(' | ')}.`);
  return lines.join('\n');
}

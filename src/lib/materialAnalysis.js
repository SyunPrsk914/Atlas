// Word-level analysis of a candidate essay or document.
//
// The brief for the analysis feature was explicit: materials must be read
// word-by-word, not summarised. This module holds the prompt, the JSON schema
// and the line-level annotation model so the Materials screen and the essay
// pipeline agree on what a "finding" looks like.

export const FINDING_KINDS = {
  strength: { label: 'Works', tone: 'positive' },
  issue: { label: 'Fix', tone: 'negative' },
  risk: { label: 'Risk', tone: 'warning' },
  style: { label: 'Style', tone: 'neutral' },
};

/**
 * The instruction block appended to every analysis prompt. It is deliberately
 * strict about granularity: a finding must quote the exact words it is about,
 * otherwise the reviewer UI has nothing to highlight.
 */
const GRANULARITY_RULES = `ANALYSIS METHOD — read the text word by word, not by topic:
1. Break the text into sentences, then examine every sentence for: filler phrases, hedging, passive voice, nominalisation, sentence-length spikes, repeated sentence openers, and word choices that sound machine-generated.
2. For every issue you find, quote the EXACT phrase you are objecting to, give its character offset (the 0-based index of the phrase within the text), and say concretely what to do instead. Never report a finding without a quote and an offset.
3. Score the rhythm and specificity separately. "Specific" means names, numbers, places, and concrete verbs. "Rhythm" means sentence lengths and openings actually vary.
4. Do not invent problems. If the text is clean in an area, say so in the summary rather than manufacturing findings.
5. Do not rewrite the whole piece — this is a diagnosis, not a rewrite.`;

/** Prompt for analysing one part of a material (the whole material when it is short). */
export function buildEssayAnalysisPrompt({
  title,
  text,
  kind = 'essay',
  contextNotes = '',
  partIndex = 1,
  partCount = 1,
  partStart = 0,
  documentChars = text.length,
}) {
  const kindLabel = {
    essay: 'a personal statement or essay written by the applicant',
    sample_essay: 'a successful essay written by someone else',
    resume: 'a resume or CV',
    transcript: 'an academic transcript',
    document: 'a supporting document',
    note: 'a personal note or reflection',
    other: 'a supporting document',
  }[kind] || 'a document';

  const isSample = kind === 'sample_essay';
  const sampleRule = isSample
    ? `THIS IS A SAMPLE. It was not written by the applicant.
Study it as craft, word by word: content, expression, voice, tone, the characteristics of the writing, the emotion it evokes, and how each word is used to show what the writer wants the reader to understand.
Do not score it as the applicant's writing. Do not suggest they submit it. Do not treat any person, place, or event in it as their life.
For a sample, your job is to extract reusable technique (opening, structure, evidence density, reflection move, closing) that the applicant can apply to their OWN story. Put those in "craft_moves". Leave "facts" empty.
`
    : `THIS IS THE APPLICANT'S OWN MATERIAL. It is evidence about their life.
Read it for concrete facts, experiences, values, and voice that can be reused when drafting essays. Put the concrete facts the text states in "facts" (roles, dates, places, numbers, outcomes, responsibilities, relationships, and values they show), one short line each. Leave "craft_moves" empty.
`;

  const contextBlock = contextNotes && String(contextNotes).trim()
    ? `APPLICANT-PROVIDED CONTEXT ABOUT THIS MATERIAL (NOT THE DOCUMENT — do not analyze it, quote it, or score it):
---
${String(contextNotes).trim()}
---
The context above only tells you what kind of document this is. Use it to understand what to expect in the text below, and nothing more.
`
    : '';

  const partBlock = partCount > 1
    ? `This is PART ${partIndex} of ${partCount} of the document (characters ${partStart + 1} to ${partStart + text.length} of ${documentChars}). The other parts are analyzed separately. Judge only this part, and do not guess at text you cannot see. Offsets count from the start of the TEXT TO ANALYZE block below.`
    : 'This is the whole document. Offsets count from the start of the TEXT TO ANALYZE block below.';

  return `You are a meticulous line editor reviewing ${kindLabel} titled "${title}".

${sampleRule}${contextBlock}
${GRANULARITY_RULES}

WHAT THE ADMISSIONS COMMITTEE IS ACTUALLY LOOKING FOR:
- A distinct voice that could only belong to this applicant.
- Evidence rather than assertion: names, numbers, roles, outcomes.
- Reflection that changes something, not a moral at the end of the story.
- For a resume/CV: signal density, quantified impact, and whether it reads as a list of duties.
- For a sample: what craft move makes it work, and how could that move be applied to a completely different life?

CRITICAL RULE ABOUT CONTEXT:
The context note (if any) is NEVER the text to analyze. Analyze ONLY the TEXT TO ANALYZE block below. If you analyze the context note and say "this is not authentic" or "this sounds like AI", you are making a fundamental mistake.

${partBlock}

TEXT TO ANALYZE (between the markers; do not include the markers in offsets):
<<<TEXT
${text}
TEXT>>>

Return findings as a flat list. Use these exact "kind" values:
- "strength" — something that is genuinely working and should be protected while editing.
- "issue"   — a concrete defect that must be fixed.
- "risk"    — something an admissions reader could read as a weakness (generic, overclaiming, résumé-in-prose).
- "style"   — a craft observation (rhythm, sentence variety, diction).

Return JSON only, matching the requested fields.`;
}

export const ESSAY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: { type: 'number' },
    specificity_score: { type: 'number' },
    rhythm_score: { type: 'number' },
    voice_score: { type: 'number' },
    sounds_like_ai: { type: 'boolean' },
    word_count: { type: 'number' },
    reading_level: { type: 'string' },
    thesis: { type: 'string' },
    summary: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string' },
          quote: { type: 'string' },
          offset: { type: 'number' },
          note: { type: 'string' },
          suggestion: { type: 'string' },
        },
      },
    },
    top_actions: { type: 'array', items: { type: 'string' } },
    facts: { type: 'array', items: { type: 'string' } },
    craft_moves: { type: 'array', items: { type: 'string' } },
  },
};

/** Parts are about this long; a model call per part keeps every answer within its context window. */
export const ANALYSIS_PART_CHARS = 6000;
/** Smallest share of a part that a cut may leave; every part but the last holds at least this much. */
const MIN_PART_FILL = 0.8;
/**
 * Parts analysed per document. A part that is cut early still holds at least
 * MIN_PART_FILL of ANALYSIS_PART_CHARS, so the reader's 200,000-character limit
 * needs at most ceil(200000 / 4800) = 42 parts, and every document it accepts is
 * analysed in full. Beyond the cap the analysis stops and says so; the stored
 * coverage shows it. verify-documents.mjs checks this against the reader limit.
 */
export const ANALYSIS_MAX_PARTS = 42;

/**
 * Where the part that starts at `start` should end. It prefers the latest
 * paragraph break, then the latest sentence end, then the latest word gap, and
 * only cuts inside a word when the text has no gap at all. Each choice is at
 * least MIN_PART_FILL of the part size, so parts stay full.
 */
function partEnd(source, start, partChars) {
  if (start + partChars >= source.length) return source.length;
  const limit = start + partChars;
  const floor = start + Math.floor(partChars * MIN_PART_FILL);
  const head = source.slice(start, limit);
  const latestMatchEnd = (pattern) => {
    let best = -1;
    const scan = new RegExp(pattern.source, 'g');
    let match;
    while ((match = scan.exec(head))) {
      const end = start + match.index + match[0].length;
      if (end >= floor) best = end;
    }
    return best;
  };
  const paragraph = latestMatchEnd(/\n[ \t]*\n+/);
  if (paragraph !== -1) return paragraph;
  const sentence = latestMatchEnd(/[.!?]+["')\]]*\s+/);
  if (sentence !== -1) return sentence;
  for (let i = head.length - 1; i >= 0; i -= 1) {
    if (/\s/.test(head[i]) && start + i + 1 >= floor) return start + i + 1;
  }
  return limit;
}

/**
 * Splits text into contiguous parts, preferring paragraph and sentence
 * boundaries. The parts cover the text in order, with no gaps and no overlap.
 * @returns {{ parts: Array<{ index: number, start: number, end: number, text: string }>, total: number }}
 *   `total` is the number of parts the whole text needs, before the cap.
 */
export function splitIntoParts(text, { partChars = ANALYSIS_PART_CHARS, maxParts = ANALYSIS_MAX_PARTS } = {}) {
  const source = String(text || '');
  if (!source.trim()) return { parts: [], total: 0 };
  const spans = [];
  let start = 0;
  while (start < source.length) {
    const end = partEnd(source, start, partChars);
    spans.push([start, end]);
    start = end;
  }
  const parts = spans.slice(0, maxParts).map(([from, to], index) => ({
    index,
    start: from,
    end: to,
    text: source.slice(from, to),
  }));
  return { parts, total: spans.length };
}

// ---------------------------------------------------------------------------
// Normalisation: models are inconsistent about offsets and missing fields,
// so the UI gets a guaranteed-safe shape.
// ---------------------------------------------------------------------------
const clampScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
};

const cleanList = (value, max) => (Array.isArray(value) ? value : [])
  .map((item) => String(item || '').trim())
  .filter(Boolean)
  .slice(0, max);

export function normalizeAnalysis(raw, sourceText = '') {
  if (!raw || typeof raw !== 'object') return null;

  const findings = Array.isArray(raw.findings)
    ? raw.findings
      .filter((f) => f && (f.quote || f.note))
      .map((f, i) => {
        const quote = String(f.quote || '');
        // Trust the model's offset when it lands on the quote; otherwise find it.
        let offset = Number.isFinite(Number(f.offset)) ? Number(f.offset) : -1;
        if (quote && (offset < 0 || sourceText.slice(offset, offset + quote.length) !== quote)) {
          offset = sourceText.indexOf(quote);
        }
        const kind = FINDING_KINDS[f.kind] ? f.kind : 'style';
        return {
          id: `${i}-${kind}`,
          kind,
          quote,
          offset: offset >= 0 ? offset : null,
          note: String(f.note || ''),
          suggestion: String(f.suggestion || ''),
        };
      })
      .sort((a, b) => {
        if (a.offset === null) return 1;
        if (b.offset === null) return -1;
        return a.offset - b.offset;
      })
    : [];

  return {
    overall_score: clampScore(raw.overall_score),
    specificity_score: clampScore(raw.specificity_score),
    rhythm_score: clampScore(raw.rhythm_score),
    voice_score: clampScore(raw.voice_score),
    sounds_like_ai: !!raw.sounds_like_ai,
    word_count: Number(raw.word_count) || textStats(sourceText).words,
    reading_level: String(raw.reading_level || ''),
    thesis: String(raw.thesis || ''),
    summary: String(raw.summary || ''),
    findings,
    top_actions: cleanList(raw.top_actions, 12),
    facts: cleanList(raw.facts, 40),
    craft_moves: cleanList(raw.craft_moves, 20),
  };
}

/**
 * Merges the per-part results into one analysis of the whole document.
 * @param {Array<{ index: number, start: number, text: string, raw: object | null }>} results one entry per part, in order
 * @param {{ fullText?: string }} [opts]
 */
/** Shortens text to about `max` characters, cut at a word boundary. */
function briefly(text, max) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export function mergeAnalysisParts(results, { fullText = '' } = {}) {
  const usable = results
    .map((r) => ({ ...r, analysis: normalizeAnalysis(r.raw, r.text) }))
    .filter((r) => r.analysis);
  if (!usable.length) {
    throw new Error('The model returned no usable analysis for any part of the document.');
  }

  const average = (key) => {
    const values = usable.map((u) => u.analysis[key]).filter((v) => v !== null);
    return values.length
      ? Math.round((values.reduce((sum, v) => sum + v, 0) / values.length) * 10) / 10
      : null;
  };

  // Findings: place each one at its position in the whole document, then drop repeats.
  const seen = new Set();
  const findings = [];
  for (const { start, analysis } of usable) {
    for (const finding of analysis.findings) {
      const offset = finding.offset === null ? null : start + finding.offset;
      const key = `${offset ?? 'none'}|${finding.kind}|${finding.quote}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ ...finding, offset });
    }
  }
  findings.sort((a, b) => {
    if (a.offset === b.offset) return 0;
    if (a.offset === null) return 1;
    if (b.offset === null) return -1;
    return a.offset - b.offset;
  });
  const numbered = findings.map((f, i) => ({ ...f, id: `${i}-${f.kind}` }));

  // Lists are taken round by round across the parts, so a capped list still
  // covers the whole document rather than only its first pages.
  const spread = (lists, max) => {
    const out = [];
    const seen = new Set();
    const longest = Math.max(0, ...lists.map((list) => list.length));
    for (let i = 0; i < longest && out.length < max; i += 1) {
      for (const list of lists) {
        const item = list[i];
        if (item === undefined || seen.has(item)) continue;
        seen.add(item);
        out.push(item);
        if (out.length >= max) break;
      }
    }
    return out;
  };
  // Each part's summary gets an equal share of one overall budget, so 42 parts still fit.
  const summaryBudget = Math.max(150, Math.floor(8000 / Math.max(1, usable.length)));
  const summaries = usable.map((u) => {
    const text = briefly(u.analysis.summary || '', summaryBudget);
    return text ? (usable.length > 1 ? `Part ${u.index + 1}: ${text}` : text) : '';
  }).filter(Boolean);
  const aiFlags = usable.filter((u) => u.analysis.sounds_like_ai).length;
  const partsTotal = results.length;

  return {
    overall_score: average('overall_score'),
    specificity_score: average('specificity_score'),
    rhythm_score: average('rhythm_score'),
    voice_score: average('voice_score'),
    sounds_like_ai: aiFlags > usable.length / 2,
    word_count: textStats(fullText).words,
    reading_level: usable.map((u) => u.analysis.reading_level).find(Boolean) || '',
    thesis: usable.map((u) => u.analysis.thesis).find(Boolean) || '',
    summary: summaries.join('\n').slice(0, 9000),
    findings: numbered,
    top_actions: spread(usable.map((u) => u.analysis.top_actions), 8),
    facts: spread(usable.map((u) => u.analysis.facts), 80),
    craft_moves: spread(usable.map((u) => u.analysis.craft_moves), 40),
    coverage: {
      total_chars: fullText.length,
      analyzed_chars: usable.reduce((sum, u) => sum + u.text.length, 0),
      parts_total: partsTotal,
      parts_analyzed: usable.length,
      parts_failed: partsTotal - usable.length,
      complete: usable.length === partsTotal,
    },
  };
}

/**
 * Reads a whole text through the model, one part at a time, and merges the results.
 * `runAI` is passed in so the same code runs in the app and in tests.
 * Each part gets one retry. A part that still fails is recorded in the coverage.
 * Demo output is refused: it is placeholder text, not an analysis.
 *
 * @returns {Promise<object>} merged analysis (without the version/source fields)
 */
export async function analyzeDocument({
  title,
  kind = 'essay',
  text,
  contextNotes = '',
  runAI,
  onProgress = (_progress) => {},
  partChars = ANALYSIS_PART_CHARS,
  maxParts = ANALYSIS_MAX_PARTS,
}) {
  const fullText = String(text || '');
  const { parts, total } = splitIntoParts(fullText, { partChars, maxParts });
  if (!parts.length) throw new Error('There is no text to analyze.');

  const results = [];
  let lastError = null;
  for (const part of parts) {
    onProgress({ part: part.index + 1, parts: parts.length });
    const prompt = buildEssayAnalysisPrompt({
      title,
      text: part.text,
      kind,
      contextNotes,
      partIndex: part.index + 1,
      partCount: parts.length,
      partStart: part.start,
      documentChars: fullText.length,
    });
    let raw = null;
    for (let attempt = 1; attempt <= 2 && !raw; attempt += 1) {
      const outcome = await runAI({
        prompt,
        response_json_schema: ESSAY_ANALYSIS_SCHEMA,
      }, { quiet: true, fallbackTitle: 'Analysis failed' });
      if (outcome?.meta?.demo || outcome?.meta?.provider === 'demo') {
        throw new Error('No AI model is connected. Demo output is placeholder text and is not saved as an analysis.');
      }
      if (outcome?.ok && outcome.result && typeof outcome.result === 'object') {
        raw = outcome.result;
      } else {
        lastError = outcome?.error || new Error('The model did not return an analysis.');
      }
    }
    results.push({ index: part.index, start: part.start, end: part.end, text: part.text, raw });
  }

  if (!results.some((r) => r.raw)) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError?.message || lastError || 'The model did not return an analysis.'));
  }
  const merged = mergeAnalysisParts(results, { fullText });
  // Coverage is measured against the whole text. Parts beyond the cap were never
  // attempted (skipped); parts that were attempted and failed are counted apart.
  merged.coverage = {
    ...merged.coverage,
    parts_total: total,
    parts_attempted: parts.length,
    parts_skipped: total - parts.length,
    parts_failed: parts.length - merged.coverage.parts_analyzed,
    complete: merged.coverage.parts_analyzed === total,
  };
  return merged;
}

/** Counts used to display the analysis honestly even before the AI runs. */
export function textStats(text = '') {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
  const sentences = trimmed ? trimmed.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()) : [];
  const longSentences = sentences.filter((s) => s.split(/\s+/).length > 30);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z0-9']/g, '')));
  return {
    chars: text.length,
    words: words.length,
    sentences: sentences.length,
    longSentences: longSentences.length,
    averageSentenceLength: sentences.length ? Math.round((words.length / sentences.length) * 10) / 10 : 0,
    lexicalDiversity: words.length ? Math.round((uniqueWords.size / words.length) * 100) / 100 : 0,
  };
}

const AI_PHRASES = [
  'in conclusion', 'this experience taught me', 'through this journey', 'i realized that',
  'it was then that i understood', 'looking back', 'furthermore', 'moreover',
  'in today\'s world', 'it is important to note', 'delve', 'tapestry', 'testament to',
  'a testament', 'navigate the complexities', 'in the modern era', 'not only', 'ultimately',
];

const WEAK_VERBS = /\b(utilize|utilized|utilize|facilitate|leverage|endeavor|endeavour|showcase|embark|underscore|underscores|underscoring)\b/gi;

/** Local, instant signal check so the page is useful before the AI runs. */
export function localSignals(text = '') {
  const lower = ` ${text.toLowerCase()} `;
  const aiPhrases = AI_PHRASES.filter((p) => lower.includes(` ${p} `) || lower.includes(` ${p},`) || lower.includes(` ${p}.`));
  const weakVerbs = [...new Set((text.match(WEAK_VERBS) || []).map((w) => w.toLowerCase()))];
  const hedges = (text.match(/\b(very|really|quite|sort of|kind of|somewhat|perhaps|maybe|I think|I guess)\b/gi) || []).length;
  const stats = textStats(text);
  return {
    ...stats,
    aiPhrases,
    weakVerbs,
    hedges,
    // Passive voice is a rough proxy: a form of "to be" followed by a past participle.
    passiveHint: (text.match(/\b(is|are|was|were|been|being|be)\s+\w+(ed|en)\b/gi) || []).length,
  };
}

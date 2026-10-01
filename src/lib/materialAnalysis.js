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

/** Prompt for analysing an essay-like material. */
export function buildEssayAnalysisPrompt({ title, text, kind = 'essay' }) {
  const kindLabel = {
    essay: 'a personal statement or essay written by the applicant',
    sample_essay: 'a successful essay written by someone else',
    resume: 'a resume or CV',
    transcript: 'an academic transcript',
    document: 'a supporting document',
    note: 'a personal note or reflection',
    other: 'a supporting document',
  }[kind] || 'a document';

  const sampleRule = kind === 'sample_essay'
    ? `THIS IS A SAMPLE. It was not written by the applicant.
Study it as craft, word by word: content, expression, voice, tone, the characteristics of the writing, the emotion it evokes, and how each word is used to show what the writer wants the reader to understand.
Do not score it as the applicant's writing. Do not suggest they submit it. Do not treat any person, place, or event in it as their life.
`
    : '';

  return `You are a meticulous line editor reviewing ${kindLabel} titled "${title}".

${sampleRule}${GRANULARITY_RULES}

WHAT THE ADMISSIONS COMMITTEE IS ACTUALLY LOOKING FOR:
- A distinct voice that could only belong to this applicant.
- Evidence rather than assertion: names, numbers, roles, outcomes.
- Reflection that changes something, not a moral at the end of the story.
- For a resume/CV: signal density, quantified impact, and whether it reads as a list of duties.

TEXT TO ANALYZE (between the markers; do not include the markers in offsets):
<<<TEXT
${text}
TEXT>>>

Return findings as a flat list. Use these exact "kind" values:
- "strength" — something that is genuinely working and should be protected while editing.
- "issue"   — a concrete defect that must be fixed.
- "risk"    — something an admissions reader could read as a weakness (generic, overclaiming, résumé-in-prose).
- "style"   — a craft observation (rhythm, sentence variety, diction).`;
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
  },
};

// ---------------------------------------------------------------------------
// Normalisation: models are inconsistent about offsets and missing fields,
// so the UI gets a guaranteed-safe shape.
// ---------------------------------------------------------------------------
const clampScore = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, Math.round(n * 10) / 10));
};

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
    word_count: Number(raw.word_count) || sourceText.trim().split(/\s+/).filter(Boolean).length,
    reading_level: String(raw.reading_level || ''),
    thesis: String(raw.thesis || ''),
    summary: String(raw.summary || ''),
    findings,
    top_actions: Array.isArray(raw.top_actions) ? raw.top_actions.map(String) : [],
    analyzed_at: new Date().toISOString(),
    analyzed_chars: sourceText.length,
  };
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

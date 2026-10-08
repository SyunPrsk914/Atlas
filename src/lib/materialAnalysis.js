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

/** Prompt for analysing an essay-like material.
 *  `contextNotes` is applicant-provided context ABOUT the document — it must
 *  NOT be analyzed as if it were the document itself.
 */
export function buildEssayAnalysisPrompt({ title, text, kind = 'essay', contextNotes = '', linkUrl = '', fileUrl = '' }) {
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
For a sample, your job is to extract reusable technique (opening, structure, evidence density, reflection move, closing) that the applicant can apply to their OWN story.
`
    : `THIS IS THE APPLICANT'S OWN MATERIAL. It is evidence about their life.
Read it for concrete facts, experiences, values, and voice that can be reused when drafting essays. Extract names, numbers, roles, outcomes, and any distinctive phrasing that is truly theirs.
`;

  const contextBlock = contextNotes && String(contextNotes).trim()
    ? `APPLICANT-PROVIDED CONTEXT ABOUT THIS MATERIAL (DO NOT ANALYZE THIS TEXT FOR AUTHENTICITY, AI PATTERNS, OR STYLE — it is only a hint about what the document is):
---
${String(contextNotes).trim()}
---
The context above is NOT the document. Do NOT quote it, do NOT score it, do NOT say "this is not authentic" about it. Use it only to understand what kind of information to expect in the document below.
`
    : '';

  const sourceBlock = [
    linkUrl ? `SOURCE LINK (if the text below is empty, the document lives at this URL): ${linkUrl}` : '',
    fileUrl ? `ATTACHED FILE: ${fileUrl}` : '',
  ].filter(Boolean).join('\n');

  return `You are a meticulous line editor reviewing ${kindLabel} titled "${title}".

${sampleRule}${contextBlock}${sourceBlock ? `${sourceBlock}\n\n` : ''}${GRANULARITY_RULES}

WHAT THE ADMISSIONS COMMITTEE IS ACTUALLY LOOKING FOR:
- A distinct voice that could only belong to this applicant.
- Evidence rather than assertion: names, numbers, roles, outcomes.
- Reflection that changes something, not a moral at the end of the story.
- For a resume/CV: signal density, quantified impact, and whether it reads as a list of duties.
- For a sample: what craft move makes it work, and how could that move be applied to a completely different life?

CRITICAL RULE ABOUT CONTEXT:
The applicant sometimes writes a short note in a separate "Context / Notes" field to tell you what this file is (e.g., "This is my robotics club reflection" or "UK sample from Oxford 2024"). That note is NEVER the text to analyze. Analyze ONLY the TEXT TO ANALYZE block below. If you analyze the context note and say "this is not authentic" or "this sounds like AI", you are making a fundamental mistake.

TEXT TO ANALYZE (between the markers; do not include the markers in offsets):
<<<TEXT
${text}
TEXT>>>

If the TEXT TO ANALYZE block is empty but a SOURCE LINK is given, say so in the summary: "No pasted text — only a link was provided" and give guidance on what to look for when the applicant opens that link, rather than inventing an analysis.

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

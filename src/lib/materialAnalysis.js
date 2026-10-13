// Word-level analysis of a candidate essay or document.
//
// The brief for the analysis feature was explicit: materials must be read
// word-by-word, not summarised. This module holds the prompt, the JSON schema
// and the line-level annotation model so the Materials screen and the essay
// pipeline agree on what a "finding" looks like.

import { clipToBoundary } from './textClip';

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
const GRANULARITY_RULES = `ANALYSIS METHOD — read the text word by word and interpret it in context, not by topic alone:
1. First decide what kind of source this is and what job it is doing. A document may be an internal assessment, research report, transcript, tips sheet, college data, personal reflection, past essay, or someone else's sample. Do not assume every document is an admissions essay.
2. Read for the literal layer (what it says), the implied layer (what choices, priorities, habits, emotions, tensions, or values those details reveal), and the useful layer (what Atlas should remember or apply later). Separate direct evidence from cautious interpretation.
3. For an applicant's own work, connect observations across the document: why this question, method, example, subject, or detail; what the author persists through; what they notice; how they respond to uncertainty; and what this suggests about the person. Do not invent biography or certainty.
4. Only a writing draft receives a writing assessment and exact word-level findings. Do not score an internal assessment, transcript, guide, data sheet, or reference document as an essay. For non-writing sources, explain the meaning and usefulness instead.
5. For every writing finding, quote the EXACT phrase, give its character offset (0-based within this part), and say concretely what to do instead. Never manufacture a finding just to fill a list.
6. Do not rewrite the whole piece. Return a deep reading that helps the applicant understand what the material means and how it can be used.
7. DENSITY AND SPECIFICITY CONTRACT for every item you return (facts, personal_signals, guidance, craft_moves, top_actions): each item must be self-contained and carry the specifics that make it usable later — proper names, numbers, dates, places, roles, exact quantities, and quoted wording. "The applicant worked on a project" is a failed item; "Rebuilt the robotics club budget after two sponsors left, replacing them with three local firms (2024)" is a usable one. Classify every item into exactly the field it belongs to: a fact never lives in guidance, a sample's craft never becomes an applicant fact, and an interpretation is never presented as a fact. Finish every item as a complete sentence. No filler, no restating the question, no generic praise — a later drafter, reviewer, or knowledge-base build will work only from these items, so every word in them must earn its place.`;

const ANALYSIS_ROLES = {
  auto: 'The lens is automatic. Infer the document role from the title, applicant context, and text, then name it in analysis_role.',
  applicant_evidence: 'This is the applicant\'s evidence. Extract facts, experiences, choices, values, habits, motivations, and the person that emerges between the lines. Do not reduce it to a résumé summary.',
  writing_draft: 'This is the applicant\'s writing draft. Interpret its underlying story and voice, then assess writing quality and add exact line-level findings. The score is about this draft, not the applicant\'s worth.',
  sample_craft: 'This is someone else\'s successful writing. Study its structure, pacing, diction, emotional movement, evidence, and reader effect. Never extract its biography as the applicant\'s facts and never score it as the applicant\'s writing.',
  academic_work: 'This is the applicant\'s academic work or assessment. Do not rate it as a college essay. Read the intellectual problem, method, evidence, curiosity, persistence, standards, and approach to uncertainty; explain what that can reveal about the applicant.',
  personal_context: 'This is the applicant\'s personal context or reflection. Read for identity, relationships, values, tensions, motivations, change, and the details that make the person distinctive. Keep interpretations anchored to evidence.',
  advice: 'This is a tips document or writing guide. Extract principles, warnings, decision rules, and useful process guidance. It is not evidence about the applicant and must not create applicant facts or personality claims.',
  application_reference: 'This is an application or college reference. Extract requirements, criteria, constraints, definitions, and practical implications. It is not the applicant\'s biography and must not be scored as an essay.',
};

const VALID_ANALYSIS_ROLES = Object.keys(ANALYSIS_ROLES);

/** Prompt for analysing one part of a material (the whole material when it is short). */
export function buildEssayAnalysisPrompt({
  title,
  text,
  kind = 'essay',
  analysisRole = 'auto',
  contextNotes = '',
  partIndex = 1,
  partCount = 1,
  partStart = 0,
  documentChars = text.length,
}) {
  const requestedRole = VALID_ANALYSIS_ROLES.includes(analysisRole) ? analysisRole : 'auto';
  const isSample = requestedRole === 'sample_craft' || kind === 'sample_essay';
  const roleInstruction = ANALYSIS_ROLES[isSample ? 'sample_craft' : requestedRole];
  const sampleRule = isSample
    ? `THIS IS A SAMPLE. It was not written by the applicant. Put facts about its writer in neither "facts" nor "personal_signals". Put reusable technique in "craft_moves" only.
`
    : requestedRole === 'advice' || requestedRole === 'application_reference'
      ? `THIS IS NOT THE APPLICANT'S BIOGRAPHY. Do not turn its advice, requirements, examples, or statistics into facts about the applicant. Use "guidance" for what should be remembered.
`
      : `THIS IS THE APPLICANT'S OWN MATERIAL. Its details are evidence, but interpretations must be cautious and tied to the text. Use "facts" for what it directly establishes and "personal_signals" for supported between-the-lines reading.
`;

  const contextBlock = contextNotes && String(contextNotes).trim()
    ? `APPLICANT-PROVIDED CONTEXT ABOUT THIS MATERIAL (NOT THE DOCUMENT — do not analyze it, quote it, or score it):
---
${String(contextNotes).trim()}
---
Use this only to understand what the source is and why the applicant kept it. If the note conflicts with the document, say so cautiously rather than treating the note as proof.
`
    : '';

  const partBlock = partCount > 1
    ? `This is PART ${partIndex} of ${partCount} of the document (characters ${partStart + 1} to ${partStart + text.length} of ${documentChars}). The other parts are analyzed separately. Judge only this part, and do not guess at text you cannot see. Offsets count from the start of the TEXT TO ANALYZE block below.`
    : 'This is the whole document. Offsets count from the start of the TEXT TO ANALYZE block below.';

  return `You are Atlas's deep reader, not an automatic essay scorer. You are reviewing the source titled "${title}".

REQUESTED ANALYSIS LENS: ${requestedRole}
${roleInstruction}

${sampleRule}${contextBlock}
${GRANULARITY_RULES}

WHAT A USEFUL DEEP READ LOOKS LIKE:
- Do not stop at "the document says X." Ask what the selection, ordering, specificity, omissions, method, emotional distance, and repeated concerns imply.
- Name the document's central meaning and why it matters for the applicant's larger story.
- For own material, identify patterns in how the applicant thinks, works, relates to people, handles difficulty, chooses problems, and spends attention — only when the text supports it.
- For advice/reference sources, convert information into usable rules, not personality claims.
- For samples, explain the writer's craft and reader effect without importing any event, identity, or achievement into the applicant's life.

CRITICAL RULE ABOUT CONTEXT:
The context note (if any) is NEVER the text to analyze. Analyze ONLY the TEXT TO ANALYZE block below. If you analyze the context note and say "this is not authentic" or "this sounds like AI", you are making a fundamental mistake.

${partBlock}

TEXT TO ANALYZE (between the markers; do not include the markers in offsets):
<<<TEXT
${text}
TEXT>>>

Return JSON only. Use these fields:
- "analysis_role": one of ${VALID_ANALYSIS_ROLES.join(', ')}. For auto, choose the best role after reading.
- "document_type": a specific plain-language classification (for example, physics internal assessment, writing guide, personal reflection, college requirements, or past essay).
- "deep_read": one dense paragraph about what the source is really doing and what its choices imply, beyond a factual summary.
- "significance": one dense paragraph about why this matters to the applicant's profile or future application, or why it is useful as guidance/reference.
- "personal_signals": several dense, cautious interpretations in the form signal → exact textual evidence (quote or close paraphrase, keeping the names and numbers) → why it may matter. Empty for samples, tips, and references.
- "facts": direct, reusable facts only, each self-contained and specific — the names, numbers, dates, places, roles, and outcomes exactly as the source states them, so a later prompt can use the item without seeing the source again. Empty for samples, tips, and references; do not turn another person's life or a guide's examples into the applicant's facts.
- "guidance": reusable rules, requirements, warnings, or practical implications, each written so a drafter or reviewer can obey it without the source: the rule, its source in substance, and its practical implication. Use this for tips, guides, and references; it may also contain a next step for another source.
- "craft_moves": reusable writing technique — the move, its effect on a reader, and when it earns its place. Required for samples; empty unless craft is genuinely relevant.
- "top_actions": at most a few next actions. These are not sentence-by-sentence writing fixes for non-writing sources.
- "writing_assessment": only for writing_draft; include overall_score, specificity_score, rhythm_score, and voice_score from 0 to 10. For every other role leave it empty.
- "findings": only for writing_draft; each item has kind, exact quote, offset, note, and suggestion. Leave it empty for every other role.

Return JSON only, matching the requested fields.`;
}

export const ESSAY_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    analysis_role: { type: 'string' },
    document_type: { type: 'string' },
    deep_read: { type: 'string' },
    significance: { type: 'string' },
    personal_signals: { type: 'array', items: { type: 'string' } },
    facts: { type: 'array', items: { type: 'string' } },
    guidance: { type: 'array', items: { type: 'string' } },
    craft_moves: { type: 'array', items: { type: 'string' } },
    top_actions: { type: 'array', items: { type: 'string' } },
    writing_assessment: {
      type: 'object',
      properties: {
        overall_score: { type: 'number' },
        specificity_score: { type: 'number' },
        rhythm_score: { type: 'number' },
        voice_score: { type: 'number' },
      },
    },
    // These legacy top-level fields are accepted so an older model can
    // still be normalized; they are ignored for non-writing roles.
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

export function normalizeAnalysis(raw, sourceText = '', fallbackRole = 'writing_draft') {
  if (!raw || typeof raw !== 'object') return null;
  const requested = VALID_ANALYSIS_ROLES.includes(fallbackRole) ? fallbackRole : 'auto';
  const returned = VALID_ANALYSIS_ROLES.includes(String(raw.analysis_role || '').trim())
    ? String(raw.analysis_role).trim()
    : '';
  // "auto" is an instruction, not a useful final classification, when the
  // caller already knows that this is a writing draft or sample.
  // An explicit applicant-selected lens is authoritative. Only automatic
  // materials allow the model to choose a final role; this prevents a model
  // from turning an internal assessment into a writing score by accident.
  const analysisRole = requested !== 'auto'
    ? requested
    : returned || requested;
  const writing = analysisRole === 'writing_draft';
  const sampleOrReference = ['sample_craft', 'advice', 'application_reference'].includes(analysisRole);
  const assessment = raw.writing_assessment && typeof raw.writing_assessment === 'object'
    ? raw.writing_assessment
    : raw;

  const findings = writing && Array.isArray(raw.findings)
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
    analysis_role: analysisRole,
    document_type: String(raw.document_type || ''),
    deep_read: String(raw.deep_read || raw.summary || ''),
    significance: String(raw.significance || ''),
    personal_signals: sampleOrReference ? [] : cleanList(raw.personal_signals, 80),
    overall_score: writing ? clampScore(assessment.overall_score) : null,
    specificity_score: writing ? clampScore(assessment.specificity_score) : null,
    rhythm_score: writing ? clampScore(assessment.rhythm_score) : null,
    voice_score: writing ? clampScore(assessment.voice_score) : null,
    sounds_like_ai: writing && !!raw.sounds_like_ai,
    word_count: Number(raw.word_count) || textStats(sourceText).words,
    reading_level: writing ? String(raw.reading_level || '') : '',
    thesis: String(raw.thesis || ''),
    summary: String(raw.summary || raw.deep_read || ''),
    findings,
    top_actions: cleanList(raw.top_actions, 12),
    facts: sampleOrReference ? [] : cleanList(raw.facts, 80),
    guidance: cleanList(raw.guidance, 60),
    craft_moves: cleanList(raw.craft_moves, 40),
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

export function mergeAnalysisParts(results, { fullText = '', analysisRole: requestedRole = 'writing_draft' } = {}) {
  const usable = results
    .map((r) => ({ ...r, analysis: normalizeAnalysis(r.raw, r.text, r.analysisRole || requestedRole) }))
    .filter((r) => r.analysis);
  const roleCounts = usable.reduce((counts, item) => {
    counts[item.analysis.analysis_role] = (counts[item.analysis.analysis_role] || 0) + 1;
    return counts;
  }, {});
  const analysisRole = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'auto';
  const writing = analysisRole === 'writing_draft';
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
  const summaryBudget = Math.max(150, Math.floor(16000 / Math.max(1, usable.length)));
  const summaries = usable.map((u) => {
    const text = briefly(u.analysis.summary || '', summaryBudget);
    return text ? (usable.length > 1 ? `Part ${u.index + 1}: ${text}` : text) : '';
  }).filter(Boolean);
  const aiFlags = usable.filter((u) => u.analysis.sounds_like_ai).length;
  const partsTotal = results.length;

  // A merged reading can outgrow the storage cap on a 42-part document. The cut
  // is made at a sentence end and announced, because a deep read that stops at
  // "the applicant is someone who de" is worse than one that says where it ended.
  const deepRead = clipToBoundary(summaries.join('\n'), 12000, {
    marker: (dropped) => `\n[… ${dropped.toLocaleString()} further characters of the part-by-part reading are in the document's saved analysis.]`,
  });
  const significance = clipToBoundary(usable
    .map((u) => briefly(u.analysis.significance || '', summaryBudget))
    .filter(Boolean)
    .map((text, i) => usable.length > 1 ? `Part ${i + 1}: ${text}` : text)
    .join('\n'), 9000, {
    marker: (dropped) => `\n[… ${dropped.toLocaleString()} further characters of why it matters are in the saved analysis.]`,
  });

  return {
    analysis_role: analysisRole,
    document_type: usable.map((u) => u.analysis.document_type).find(Boolean) || '',
    deep_read: deepRead,
    significance,
    personal_signals: spread(usable.map((u) => u.analysis.personal_signals), 80),
    overall_score: writing ? average('overall_score') : null,
    specificity_score: writing ? average('specificity_score') : null,
    rhythm_score: writing ? average('rhythm_score') : null,
    voice_score: writing ? average('voice_score') : null,
    sounds_like_ai: writing && aiFlags > usable.length / 2,
    word_count: textStats(fullText).words,
    reading_level: writing ? (usable.map((u) => u.analysis.reading_level).find(Boolean) || '') : '',
    thesis: usable.map((u) => u.analysis.thesis).find(Boolean) || '',
    summary: deepRead,
    findings: writing ? numbered : [],
    top_actions: spread(usable.map((u) => u.analysis.top_actions), 8),
    facts: spread(usable.map((u) => u.analysis.facts), 80),
    guidance: spread(usable.map((u) => u.analysis.guidance), 60),
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
  analysisRole = '',
  text,
  contextNotes = '',
  runAI,
  onProgress = (_progress) => {},
  partChars = ANALYSIS_PART_CHARS,
  maxParts = ANALYSIS_MAX_PARTS,
}) {
  const fullText = String(text || '');
  const requestedRole = VALID_ANALYSIS_ROLES.includes(analysisRole)
    ? analysisRole
    : kind === 'sample_essay' ? 'sample_craft' : kind === 'essay' ? 'writing_draft' : 'auto';
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
      analysisRole: requestedRole,
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
    results.push({ index: part.index, start: part.start, end: part.end, text: part.text, raw, analysisRole: requestedRole });
  }

  if (!results.some((r) => r.raw)) {
    throw lastError instanceof Error ? lastError : new Error(String(lastError?.message || lastError || 'The model did not return an analysis.'));
  }
  const merged = mergeAnalysisParts(results, { fullText, analysisRole: requestedRole });
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

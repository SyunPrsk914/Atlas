// School-fit knowledge: the structured shape of a university research record,
// and the slice of it each AI job is allowed to see.
//
// Why this module exists. A college does not read applications the way another
// college does. Stanford's reader is looking for intellectual vitality and
// initiative; Imperial's is looking for subject mastery; UC's readers work
// against a rubric with no interviews and no letters. An essay that is excellent
// for one can be merely adequate for another. Atlas already stored per-college
// research, but it stored it as one undifferentiated wall of markdown that every
// prompt received whole, with no instruction about which part was the reader's
// lens, which part was logistics, and which part was colour an applicant might
// name in a sentence.
//
// So the research report has a fixed section list, defined once here:
//   - KnowledgeBase.jsx builds its research prompt from RESEARCH_SECTIONS, so the
//     model is asked for exactly the headings the parser understands.
//   - parseSchoolKnowledge() reads any stored report (new or old) back into
//     sections.
//   - buildFitBrief() hands a prompt only the sections that job should judge or
//     draft against, with an instruction about how to use them.
//
// Two rules shape the section list and the briefs:
//   1. Official sources only. A fact about a university belongs in the report if
//      the university publishes it. Traditions, buildings, clubs and named
//      programmes are exactly the material that makes an essay specific, and
//      exactly the material an applicant must not get wrong — so they are
//      collected under one heading with their sources attached.
//   2. Fit is a lens, not a checklist. The reader's values tell Atlas how to
//      judge and what to aim at. They never become "you failed to mention X",
//      because an admissions officer sees the page, not the school's website.

import { detectSupplementShapes } from './essayCraft';
import { isSharedEssay } from './applicationData';

/**
 * The fixed section list of a university research record.
 *
 * `n` is the number printed in the heading, `heading` is the exact title, `ask`
 * is the instruction given to the research model, and `kinds` says which AI jobs
 * receive the section. Keeping the ask next to the heading is what stops the
 * prompt and the parser from drifting apart.
 *
 * @type {{ id: string, n: number, heading: string, ask: string, kinds: string[] }[]}
 */
export const RESEARCH_SECTIONS = [
  {
    id: 'admissions_overview',
    n: 1,
    heading: 'ADMISSIONS OVERVIEW',
    ask: 'Application platform, application fee, the current cycle\'s deadlines (Early/Regular/REA/ED where relevant, with exact dates), and the most recent available acceptance rate with the year it refers to.',
    kinds: ['application'],
  },
  {
    id: 'academic_requirements',
    n: 2,
    heading: 'ACADEMIC REQUIREMENTS',
    ask: 'Required and recommended subjects, the middle 50% GPA range, the middle 50% SAT/ACT range if published, English proficiency minimums (IELTS/TOEFL/Duolingo, including any per-component minimum), and any test-optional policy.',
    kinds: ['application'],
  },
  {
    id: 'ideal_student',
    n: 3,
    heading: 'IDEAL STUDENT PROFILE',
    ask: 'What the university says it looks for and the values behind it; the qualities its own admissions material names; what admitted students actually have in common; and what this school visibly does NOT reward. Quote the university\'s own words where it publishes them, and label each point "officially stated" or "widely reported".',
    kinds: ['draft', 'review', 'polish', 'application'],
  },
  {
    id: 'essay_requirements',
    n: 4,
    heading: 'ESSAY REQUIREMENTS',
    ask: 'For EVERY required essay: the exact prompt text, the word or character limit, and — most importantly — what ROLE that prompt plays in the holistic review (what the committee is trying to learn from that specific question). Flag clearly which writing is shared across the whole platform and which is this school alone.',
    kinds: ['draft', 'review', 'application'],
  },
  {
    id: 'programs_and_majors',
    n: 5,
    heading: 'PROGRAMS AND MAJORS',
    ask: 'Notable programmes, research opportunities for undergraduates, combined or dual degrees, and any programme-specific admissions requirements. Where the intended major is known, go deep on that department: its named tracks or concentrations, its signature courses, its labs and research centres, and how undergraduates get involved.',
    kinds: ['draft', 'application'],
  },
  {
    id: 'financial_aid',
    n: 6,
    heading: 'FINANCIAL AID',
    ask: 'Need-blind or need-aware, specifically for international students. Scholarships open to international applicants. Average award if published.',
    kinds: ['application'],
  },
  {
    id: 'interview',
    n: 7,
    heading: 'INTERVIEW',
    ask: 'Required, optional or none. Format, length, and what it assesses.',
    kinds: ['application'],
  },
  {
    id: 'international_notes',
    n: 8,
    heading: 'INTERNATIONAL APPLICANT NOTES',
    ask: 'Anything specific to international students, plus anything that constrains this student\'s application given the context above.',
    kinds: ['application'],
  },
  {
    id: 'campus_life',
    n: 9,
    heading: 'CAMPUS LIFE, TRADITIONS AND COMMUNITY',
    ask: 'Student life as this university itself describes it: named traditions and annual events, the residential or house system, facilities and buildings an applicant might legitimately name, student clubs and societies relevant to the intended major, and anything in the university\'s own recent news or announcements that shows where it is investing. Every item must be attributable to an official page — this is the material an applicant puts in a sentence, and a wrong name is worse than no name.',
    kinds: ['draft', 'application'],
  },
  {
    id: 'reader_lens',
    n: 10,
    heading: 'WHAT THIS SCHOOL\'S READERS REWARD IN WRITING',
    ask: 'How this university wants an application built: what its readers praise, what they say they skip, how it expects a personal statement or supplement to be structured, what tone suits it, and which habits get an essay downgraded there but not elsewhere. Derive this from the university\'s own admissions guidance, its published essay advice, its reader comments, or its stated review criteria — not from generic college-essay blogs.',
    kinds: ['draft', 'review', 'polish', 'application'],
  },
  {
    id: 'sources',
    n: 11,
    heading: 'SOURCES CONSULTED',
    ask: 'A markdown list of the official pages this report is built from: one bullet per source, each with the exact URL and a four-word description. Official university, department, and admissions domains only. If a fact above came from a non-official source, say so here and label it in place.',
    kinds: ['application'],
  },
];

/** Section ids in report order. */
export const RESEARCH_SECTION_IDS = RESEARCH_SECTIONS.map((s) => s.id);

/** Per-section character cap when a brief is assembled for a prompt. */
export const FIT_SECTION_CHAR_BUDGET = 3000;

/** Whole-brief cap. A research report can run long; prompts should not. */
export const FIT_BRIEF_CHAR_BUDGET = 14000;

const byId = (id) => RESEARCH_SECTIONS.find((s) => s.id === id) || null;

/**
 * The markdown instruction block the research prompt asks for.
 *
 * KnowledgeBase.jsx builds its prompt from this, so the headings the model is
 * told to write and the headings the parser looks for are the same list.
 *
 * @param {{ major?: string }} [args]
 * @returns {string}
 */
export function researchSectionInstructions({ major = '' } = {}) {
  return RESEARCH_SECTIONS.map((s) => {
    const ask = (s.id === 'programs_and_majors' && major)
      ? `Programmes related to ${major}, first and in most detail. ${s.ask}`
      : s.ask;
    return `## ${s.n}. ${s.heading}\n${ask}`;
  }).join('\n\n');
}

/** True when the text carries at least one of the expected section headings. */
export function isStructuredKnowledge(text) {
  return parseSchoolKnowledge(text).structured;
}

// A heading may carry a qualifier after the title ("## 5. PROGRAMS AND MAJORS —
// Aeronautics & Astronautics"), may drop the number, and may use ## through ####.
const headingPattern = (s) => new RegExp(
  `^#{2,4}\\s*(?:${s.n}\\.\\s*)?${s.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*$`,
  'i',
);

/**
 * Read a stored research report back into sections.
 *
 * Tolerates what real reports look like: numbered or unnumbered headings, `##`
 * through `####`, stray blank lines, and content written before this structure
 * existed (which lands in `preamble` and is still shown to the model).
 *
 * @param {string} text the `knowledge` field of a CollegeKnowledge row
 * @returns {{ structured: boolean, sections: Record<string, string>, order: string[], preamble: string }}
 */
export function parseSchoolKnowledge(text) {
  const raw = String(text || '').trim();
  /** @type {Record<string, string>} */
  const sections = {};
  /** @type {string[]} */
  const order = [];
  if (!raw) return { structured: false, sections, order, preamble: '' };

  const patterns = RESEARCH_SECTIONS.map((s) => ({ s, re: headingPattern(s) }));
  const lines = raw.split(/\r?\n/);
  const preambleLines = [];
  /** @type {{ s: object, body: string[] } | null} */
  let current = null;

  for (const line of lines) {
    const hit = patterns.find((p) => p.re.test(line.trim()));
    if (hit) {
      if (current) sections[current.s.id] = current.body.join('\n').trim();
      current = { s: hit.s, body: [] };
      if (!order.includes(hit.s.id)) order.push(hit.s.id);
      continue;
    }
    if (current) current.body.push(line);
    else preambleLines.push(line);
  }
  if (current) sections[current.s.id] = current.body.join('\n').trim();

  return {
    structured: order.length > 0,
    sections,
    order,
    preamble: preambleLines.join('\n').trim(),
  };
}

const cap = (body, budget) => {
  const text = String(body || '').trim();
  if (text.length <= budget) return text;
  // Cut on a line boundary so the brief never ends mid-sentence-looking.
  const slice = text.slice(0, budget);
  const lastBreak = slice.lastIndexOf('\n');
  return `${slice.slice(0, lastBreak > budget * 0.5 ? lastBreak : budget).trim()}\n[section continues in the full research record]`;
};

const KIND_INSTRUCTIONS = {
  draft: 'Use this to write for THIS reader: aim at what it values, structure the piece the way its readers reward, and let the named programmes, facilities, traditions or clubs supply the specific nouns — but only ones this applicant genuinely touched. Never name-drop a place or a club just because it is in the research; a reader spots a borrowed detail instantly.',
  review: 'This is the reader\'s own lens. Judge the draft against what this school says it values and how its readers read. These pages are the school\'s, not the applicant\'s: they tell you what to reward, never what to deduct for. Do not report that the essay failed to mention something listed here.',
  polish: 'Keep the edit aimed at this reader\'s taste. Change tone, structure and emphasis to suit it — do not insert facts from the research that the applicant did not write.',
  application: 'This is the institutional context for the whole file: what the school requires, what it says it values, and how its readers read. Judge the application as this committee would, against its own stated criteria.',
};

/** Significant prompt words for matching a saved research entry to one essay. */
const STOP_WORDS = new Set([
  'about', 'after', 'also', 'and', 'are', 'because', 'been', 'being', 'between',
  'could', 'describe', 'does', 'each', 'from', 'have', 'into', 'more', 'most',
  'other', 'please', 'that', 'their', 'them', 'there', 'these', 'they', 'this',
  'those', 'through', 'time', 'what', 'when', 'where', 'which', 'while', 'will',
  'with', 'would', 'your', 'you', 'ours', 'tell', 'share', 'write', 'essay',
]);

const promptWords = (value) => String(value || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .split(/\s+/)
  .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

/** Return only the prompt and its numbered role from the research essay list. */
function essayRequirementSlice(body, essay) {
  const lines = String(body || '').split(/\r?\n/);
  const prompt = String(essay?.prompt || '').trim();
  const tokens = [...new Set(promptWords(`${essay?.title || ''} ${prompt}`))];
  const isRoleLine = (line) => /^(?:[-*]\s*)?role in review\s*:/i.test(line.trim());
  const promptLineIndexes = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line && !isRoleLine(line));

  let best = null;
  for (const candidate of promptLineIndexes) {
    const candidateTokens = new Set(promptWords(candidate.line));
    const overlap = tokens.filter((word) => candidateTokens.has(word)).length;
    const score = tokens.length ? overlap / tokens.length : 0;
    if (!best || score > best.score) best = { ...candidate, score };
  }

  // Exact prompt inclusion always wins. Return the applicant's selected prompt,
  // not the surrounding paragraph: older research records sometimes list
  // several supplements in one bullet, and copying that whole bullet would
  // accidentally turn alternatives into a checklist.
  const normalizedPrompt = prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  let exact = null;
  if (normalizedPrompt) {
    exact = promptLineIndexes.find(({ line }) =>
      line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(normalizedPrompt));
    if (exact) best = { ...exact, score: 1 };
  }

  const noMatch = () => {
    const label = essay?.title || 'the selected essay';
    return `No unambiguous matching entry for ${label} was found in the saved essay-requirements section. Current prompt: ${prompt || '(none saved)'}. Do not borrow a role or requirement from another essay.`;
  };
  if (!best || best.score < 0.28) return noMatch();

  const number = best.line.match(/^\s*(?:[-*]\s*)?(\d+)[.)]/)?.[1];
  const roleLine = lines.find(isRoleLine);
  const selected = [];
  if (exact) {
    selected.push(number ? `${number}. ${prompt}` : `Matched prompt: ${prompt}`);
  } else {
    const questionWords = (best.line.match(/\b(?:why|what|how|describe|tell|share|list)\b/gi) || []).length;
    const semicolonPrompts = /;\s*(?:why|what|how|describe|tell|share|list|which)\b/i.test(best.line);
    if (!number && (semicolonPrompts || questionWords > 2)) return noMatch();
    selected.push(best.line);
  }
  if (number && roleLine) {
    const role = roleLine.split(/;\s*/).find((part) => part.includes(`#${number}`));
    if (role) selected.push(role.trim());
  }
  return selected.join('\n');
}

function essayResearchSections(kind, essay) {
  const text = `${essay?.title || ''} ${essay?.prompt || ''}`;
  const shapes = detectSupplementShapes({
    prompt: essay?.prompt || '',
    limit: Number(essay?.word_limit) || 0,
    unit: essay?.limit_unit || 'words',
  }).map((shape) => shape.key);
  const whySchool = essay?.type === 'why_this_school' || shapes.includes('why_school')
    || /why (?:this|our|the) (?:school|university|college)|why are you interested in (?:studying|attending)|what attracts you to/i.test(text);
  const community = shapes.includes('community') || shapes.includes('contribution')
    || /roommate|community|campus|contribut(?:e|ion)|residential|neighbou?r/i.test(text);
  const academic = shapes.includes('intellectual')
    || /major|programme|program|course|department|academic|research opportunity/i.test(text);

  const ids = ['ideal_student', 'essay_requirements', 'reader_lens'];
  if (whySchool || academic) ids.push('programs_and_majors');
  if (whySchool || community) ids.push('campus_life');
  const permitted = new Set(RESEARCH_SECTIONS.filter((section) => section.kinds.includes(kind)).map((section) => section.id));
  return ids.filter((id) => permitted.has(id));
}

/**
 * The slice of a research record one AI job should see. Essay jobs receive a
 * prompt-specific slice rather than every essay requirement for the school.
 *
 * @param {string} knowledgeText the stored report
 * @param {object} [args]
 * @param {'draft'|'review'|'polish'|'application'} [args.kind] which job is asking
 * @param {object} [args.essay] the selected essay, used to narrow school context
 * @param {number} [args.sectionBudget] per-section character cap
 * @param {number} [args.totalBudget] whole-brief character cap
 * @param {string[]} [args.extraSections] section ids to include beyond the kind's default
 * @returns {string} prompt-ready markdown, or '' when there is no relevant research
 */
export function buildFitBrief(knowledgeText, {
  kind = 'draft',
  essay = null,
  sectionBudget = FIT_SECTION_CHAR_BUDGET,
  totalBudget = FIT_BRIEF_CHAR_BUDGET,
  extraSections = [],
} = {}) {
  const stored = String(knowledgeText || '').trim();
  if (!stored || /^no (?:university )?research/i.test(stored)) return '';
  // A shared essay must be identical wherever it is used. School-specific
  // research therefore has no place in its draft, review, or polish context.
  if (essay && isSharedEssay(essay) && ['draft', 'review', 'polish'].includes(kind)) return '';

  const parsed = parseSchoolKnowledge(stored);
  const wanted = essay && ['draft', 'review', 'polish'].includes(kind)
    ? essayResearchSections(kind, essay)
    : RESEARCH_SECTIONS.filter((section) => section.kinds.includes(kind)).map((section) => section.id);
  const selectedIds = [...new Set([...wanted, ...extraSections])];

  if (!parsed.structured) {
    if (essay && ['draft', 'review', 'polish'].includes(kind)) {
      return `UNSTRUCTURED UNIVERSITY RESEARCH WITHHELD: Atlas could not safely match this legacy report to one essay, so it is not included. Current essay: ${essay.title || 'Untitled essay'} — ${essay.prompt || '(no prompt saved)'}. Do not import a requirement or school fact from another essay; use only the applicant's materials and facts supplied in a structured research section.`;
    }
    return `UNIVERSITY RESEARCH (unstructured — no section headings, so treat it as background):\n${cap(stored, totalBudget)}`;
  }

  const blocks = [];
  for (const id of selectedIds) {
    const section = byId(id);
    let body = parsed.sections[id];
    if (!section || !body) continue;
    if (id === 'essay_requirements' && essay) {
      body = essayRequirementSlice(body, essay);
    }
    blocks.push(`### ${section.n}. ${section.heading}\n${cap(body, sectionBudget)}`);
  }
  if (parsed.preamble && !essay) blocks.unshift(`### BEFORE THE SECTIONS\n${cap(parsed.preamble, sectionBudget)}`);
  if (!blocks.length) return '';

  const essayNote = essay
    ? `\nCURRENT ESSAY TARGET: ${essay.title || 'Untitled essay'}\nExact prompt: ${essay.prompt || '(none saved)'}\nUse only the matching requirements above. Do not blend this prompt with another supplement or try to answer multiple prompts.`
    : '';
  let out = `WHAT THIS UNIVERSITY PUBLISHES ABOUT ITSELF (kind: ${kind}):\n${KIND_INSTRUCTIONS[kind] || KIND_INSTRUCTIONS.draft}${essayNote}\n\n${blocks.join('\n\n')}`;
  if (out.length > totalBudget) out = `${out.slice(0, totalBudget).trimEnd()}\n[brief trimmed to fit the prompt — the full record is stored with this university]`;
  return out;
}

/**
 * One-line summary of a research record, for cards and status rows.
 *
 * @param {string} knowledgeText
 * @returns {{ sections: number, hasFit: boolean, hasSources: boolean, values: string }}
 */
export function fitSummary(knowledgeText) {
  const parsed = parseSchoolKnowledge(knowledgeText);
  const values = (parsed.sections.ideal_student || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
  return {
    sections: parsed.order.length,
    hasFit: Boolean(parsed.sections.ideal_student),
    hasSources: Boolean(parsed.sections.sources),
    values,
  };
}

/**
 * Section headings a report is missing, so the UI can offer to re-run research
 * instead of silently showing a half-built record.
 *
 * @param {string} knowledgeText
 * @param {string[]} [kinds] which jobs must be served
 * @returns {string[]} missing section headings
 */
export function missingSections(knowledgeText, kinds = ['draft', 'review']) {
  const parsed = parseSchoolKnowledge(knowledgeText);
  return RESEARCH_SECTIONS
    .filter((s) => s.kinds.some((k) => kinds.includes(k)) && !parsed.sections[s.id])
    .map((s) => `${s.n}. ${s.heading}`);
}

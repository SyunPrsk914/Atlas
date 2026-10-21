// The AI knowledge base: a private, editable picture of the applicant, and of
// what successful applications look like, kept apart from university research.
//
// It has four kinds of item:
//   brief    — About you: personality, actions, mindset, goals (AI-built, editable)
//   evidence — Personal points: concrete, reusable facts with a source label
//   pattern  — Successful-application patterns: craft and judgement rules, tagged
//              US, UK, or General. They come from sample essays and never copy a life.
//   guidance — Tips, writing principles, and application-reference constraints,
//              kept separate from the applicant portrait.
//
// Items are either built by the AI (origin "ai") or written by the applicant
// (origin "manual"). A rebuild writes the new AI items first and only then
// removes the old AI items. Manual items are never removed by a rebuild.
// Drafting, review, and the holistic review read the items through
// `applicantKnowledgeForPrompt`.
//
// Three ways the AI items change, from safest to most destructive:
//   refreshApplicantKnowledge — re-examines every AI item one by one against
//       the sources as they are now: keep, revise, or remove, then add what is
//       missing. This is what the automatic update runs.
//   extendApplicantKnowledge  — "Go deeper": appends only.
//   rebuildApplicantKnowledge — rewrites the AI items of each kind it rebuilds.
// `dissectMaterialKnowledge` reads one material and files its parts under the
// school, essay, platform, or task they belong to, so a successful full
// application becomes a "Stanford" section plus a "roommate essay" section
// rather than one undifferentiated pile.

import { buildProfileContext } from './profileContext';
import {
  formatOwnMaterials, formatGuidanceMaterials, formatSampleMaterials, isGuidanceMaterial, isSampleMaterial, presentMaterial,
  materialAnalysisRole,
} from './materialRole';
import { sourceKey } from './materialDocument';
import { contextTargetLabel, filterByContextTarget } from './contextTargeting';
import { clipToBoundary, packBlocks } from './textClip';
import { detectSupplementShapes } from './essayCraft';
import { universityNamesMatch, limitUnitFor, PLATFORMS } from './applicationData';

export const KNOWLEDGE_KINDS = {
  brief: { label: 'About you', hint: 'Who you are, from your profile, materials, and drafts.' },
  evidence: { label: 'Personal points', hint: 'Concrete facts you can use. Atlas never adds to these without a source.' },
  pattern: { label: 'Successful-application patterns', hint: 'What made the sample essays work. Technique, never someone else’s life.' },
  guidance: { label: 'Tips & reference guidance', hint: 'Reusable rules from guides and college/application sources, kept separate from your biography.' },
};

export const ABOUT_CATEGORIES = {
  personality: 'Personality',
  actions: 'Actions',
  mindset: 'Mindset',
  goals: 'Goals',
};

export const POINT_CATEGORIES = {
  achievement: 'Achievement',
  experience: 'Experience',
  value: 'Value',
  fact: 'Fact',
};

export const PATTERN_CATEGORIES = {
  opening: 'Opening',
  structure: 'Structure',
  evidence: 'Evidence',
  reflection: 'Reflection',
  voice: 'Voice',
  length: 'Length',
  judgement: 'Judgement',
};

export const PATTERN_PLATFORMS = { US: 'US', UK: 'UK', General: 'General' };
export const GUIDANCE_CATEGORIES = {
  writing_principle: 'Writing principle',
  application_rule: 'Application rule',
  requirement: 'Requirement',
  warning: 'Warning',
  process: 'Process',
};

/**
 * The floors and ceilings for one build.
 *
 * The caps exist so a build cannot stop at "1 personality item, 4 facts", which
 * is what a fixed per-kind cap plus a truncated source list used to produce:
 * 40+ materials were read as a handful of one-liners. Limits now scale with how
 * many sources are actually in front of the model, and a minimum makes a thin
 * answer visible instead of normal.
 */
export const KNOWLEDGE_BASE_LIMITS = { about: 14, points: 35, patterns: 20, guidance: 25 };

/** Per-kind floor: what a build must at least attempt when the sources support it. */
const MIN_PER_SOURCE = { about: 0.5, points: 1.2, patterns: 1.5, guidance: 1.2 };
/** The ceiling per kind, however large the pile. Exported for the UI and tests. */
export const MAX_LIMITS = { about: 56, points: 220, patterns: 90, guidance: 90 };

/**
 * @param {{ materials?: number, samples?: number, guidance?: number, essays?: number, profile?: number }} counts
 * @returns {{about:{min:number,max:number},points:{min:number,max:number},patterns:{min:number,max:number},guidance:{min:number,max:number}}}
 */
export function knowledgeLimitsFor(counts = {}) {
  const evidence = (counts.materials || 0) + (counts.essays || 0) + (counts.profile ? 1 : 0);
  const samples = counts.samples || 0;
  const guides = counts.guidance || 0;
  const limit = (kind, sources) => {
    const max = Math.max(KNOWLEDGE_BASE_LIMITS[kind], Math.min(MAX_LIMITS[kind], KNOWLEDGE_BASE_LIMITS[kind] + Math.round(sources * 1.5)));
    const min = Math.min(max, Math.round(sources * MIN_PER_SOURCE[kind]));
    return { min, max };
  };
  return {
    about: limit('about', evidence),
    points: limit('points', evidence),
    patterns: limit('patterns', samples),
    guidance: limit('guidance', guides),
  };
}

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/** Drafts are corroborating evidence, so each gets its own cap and the rest wait. */
const PROMPT_BUDGET = { profile: 12000, essays: 26000, draft: 4000 };
/** Room kept for the line that says what did not fit, so the budget is honest. */
const KNOWLEDGE_NOTE_CHARS = 210;
/** Below this, a section gets no room at all rather than a broken sentence. */
const MIN_KNOWLEDGE_LINE_CHARS = 200;

/** Region a platform's samples belong to. */
export function platformRegion(platform) {
  return platform === 'ucas' ? 'UK' : 'US';
}

function clip(text, max) {
  return clipToBoundary(text, max);
}

/** True when an item ends in the middle of a sentence, which the UI flags. */
export function itemLooksCutOff(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  return !/[.!?:;"')\]]$/.test(value) && value.length > 40;
}

/** The inputs a rebuild reads, and a fingerprint that changes when any of them change. */
export function buildKnowledgeInputs({ profile, materials = [], essays = [] }) {
  const profileRow = Array.isArray(profile) ? profile[0] : profile;
  // A global applicant portrait must not absorb a school-, essay-, platform-,
  // or task-specific source and then leak that fact into every future prompt.
  const globalMaterials = filterByContextTarget(materials, {});
  const globalEssays = essays.filter((essay) => essay.scope === 'common'
    || (!essay.scope && !essay.university_id));
  const presented = globalMaterials.map(presentMaterial);
  const profileText = profileRow ? buildProfileContext(profileRow) : '';
  // Each group brings its whole sources and its own analysis. The formatter
  // drops a source whole when the prompt cannot hold it, and names it — the
  // portrait is never built from the first pages of the first three files.
  const ownText = formatOwnMaterials(globalMaterials).join('\n\n');
  const guidanceText = formatGuidanceMaterials(globalMaterials).join('\n\n');
  const sampleText = formatSampleMaterials(globalMaterials).join('\n\n');
  const draftBlocks = globalEssays
    .filter((essay) => String(essay.content || '').trim())
    .map((essay) => `--- Draft: ${essay.title || essay.university_name || 'Untitled'} (${essay.type || 'essay'}) ---\n${clip(essay.content, PROMPT_BUDGET.draft)}`);
  const essayPacked = packBlocks(draftBlocks, PROMPT_BUDGET.essays);
  const essayText = essayPacked.kept.join('\n\n');
  const omittedDrafts = globalEssays.length - essayPacked.kept.length;
  const sampleCount = presented.filter((m) => isSampleMaterial(m)).length;
  const guidanceCount = presented.filter((m) => isGuidanceMaterial(m)).length;
  const evidenceCount = presented.filter((m) => !isSampleMaterial(m) && !isGuidanceMaterial(m)).length;
  const fingerprintSource = JSON.stringify([
    profileRow ? [profileRow.id, profileRow.updated_at, profileRow.full_name, profileRow.background_summary, profileRow.ib_subjects] : null,
    ...globalMaterials.map((m) => [m.id, m.updated_at, m.type, m.analysis_role, m.file_url, m.link_url, m.notes, m.analysis?.version || '', m.analysis?.analysis_role || '', m.analysis?.analyzed_at || '', m.target_university_id || '', m.target_essay_id || '', m.target_platform || '', m.target_task || '']),
    ...globalEssays.map((e) => [e.id, e.updated_at, String(e.content || '').length, e.scope || '', e.university_id || '']),
  ]);
  return {
    profileText: clip(profileText, PROMPT_BUDGET.profile),
    ownText,
    guidanceText,
    essayText: omittedDrafts > 0
      ? `${essayText}\n\n[${omittedDrafts} older draft${omittedDrafts === 1 ? '' : 's'} left out to fit the prompt — the newest drafts were read.]`
      : essayText,
    sampleText,
    fingerprint: sourceKey(fingerprintSource),
    counts: {
      profile: profileText ? 1 : 0,
      materials: evidenceCount,
      samples: sampleCount,
      guidance: guidanceCount,
      essays: globalEssays.filter((e) => String(e.content || '').trim()).length,
    },
    empty: !profileText && !ownText && !essayText && !sampleText && !guidanceText,
  };
}

// ---------------------------------------------------------------------------
// Prompts and schemas
// ---------------------------------------------------------------------------
export const ABOUT_AND_POINTS_SCHEMA = {
  type: 'object',
  properties: {
    about: {
      type: 'array',
      items: {
        type: 'object',
        properties: { category: { type: 'string' }, text: { type: 'string' } },
      },
    },
    points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          text: { type: 'string' },
          source_label: { type: 'string' },
          evidence: { type: 'string' },
        },
      },
    },
  },
};

/**
 * A pattern or a tip is only as good as the kind of writing it was drawn from.
 *
 * `applies_to` is how the model says so: the essay kinds the rule governs, or
 * nothing at all when the rule really is universal. It is stored as
 * `data.shape_keys` and read back by `shapeAllows`, so a craft rule taken from a
 * personal statement never arrives in the prompt for a 40-word roommate answer —
 * the mixing the applicant has to correct by hand otherwise.
 */
export const APPLIES_TO_ANY = 'any';

/** The model's `applies_to` list, kept to essay kinds Atlas actually recognises. */
export function appliesToKeys(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  const out = [];
  for (const raw of list) {
    const key = String(raw || '').trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z_]/g, '');
    if (!key || key === APPLIES_TO_ANY || key === 'all' || key === 'universal') continue;
    if (!ESSAY_KINDS.includes(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out.slice(0, 6);
}

export const PATTERNS_SCHEMA = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          platform: { type: 'string' },
          text: { type: 'string' },
          applies_to: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

export const GUIDANCE_SCHEMA = {
  type: 'object',
  properties: {
    guidance: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          text: { type: 'string' },
          applies_to: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

/**
 * The standard every portrait item is held to.
 *
 * The applicant's complaint was precise: items like "In the physics IA, the
 * applicant annotates Trial 21 as an outlier" describe a lab notebook, not a
 * person. A drafter cannot write a human being from that. Every item has to
 * answer at least one of the five questions below, and academic work may only
 * ever be read for what it shows about how the person thinks.
 */
export const PERSON_FOCUS_RULES = `PERSON FIRST — THE STANDARD EVERY ITEM IS HELD TO
Every item about the applicant answers at least one of these, in the applicant's own terms:
  (1) what kind of person this is;  (2) what their core mindset is — how they think, learn, and decide;
  (3) how they act when it matters, and when nobody is watching;  (4) what they like and keep returning to;
  (5) what drives them — the reason under the choices.
- The single most valuable thing in any material is a sentence where the applicant states a value, a belief, or a reason in their own words ("I keep doing this because…", "what matters to me is…", "I could not accept that…"). Quote or closely paraphrase it, say where it was said, and build the portrait around those sentences before anything else.
- Read between the lines: the subject they chose when they could have chosen anything, the detail they linger on, what they apologise for, what they are proud of without saying so, who they mention and how, what they do repeatedly without being asked, and the gap between what they say and what they do. Say what it suggests about the person, always tied to the evidence, and label an uncertain reading "suggests" or "the materials do not establish".
- Academic work — an Internal Assessment, an Extended Essay, a lab report, a research paper, a transcript — tells you how this person thinks: what question they picked, how they handle uncertainty, whether they persist, what standard they hold themselves to. Use it ONLY for that. Never record its mechanics: no trial numbers, no outliers, no data tables, no uncertainties, no section summaries, no "annotates Trial 21 as an outlier". If a sentence would read naturally in a lab notebook or a mark scheme, it does not belong in this portrait.
- Grades, scores, and course lists already live in the profile. Do not restate them as personality, and never let academic detail crowd out the person: an item about how someone treats a struggling teammate is worth more than three about their methodology.
- Achievements are evidence, not the point. "Founded a tutoring club" says what happened; the portrait has to say what it shows — that they build the thing that is missing, that they would rather teach than be seen, that they stay after the applause.
- An ABOUT YOU item that reads like a résumé line is a filing mistake, not a portrait: "Achieved a specific impulse of 210 seconds using L-menthol as propellant in the microwave-arc thruster built during a research placement, a quantitative result explicitly named in both the essay context and the preparation draft" records a result and cites two documents — no personality in it. The quantified result belongs in PERSONAL POINTS exactly as stated; ABOUT YOU then says what chasing that number shows about the person (they take an idea from a kitchen chemistry hunch to a working apparatus; they hold themselves to instrument-verified claims). Provenance clauses ("named in both the … and the …") belong in the source label of an evidence item, never inside a portrait sentence.
- Compact beats long. One item that integrates three pieces of evidence into one true observation beats three items that each report one. Merge overlapping observations; never pad.`;

const MECHANICS_PATTERNS = [
  /\btrial\s*#?\s*\d+/i,
  /\boutlier(s)?\b/i,
  /\b(internal assessment|\bIA\b)[^.]{0,80}\b(annotat|tabulat|record|plot|calculat|graph)/i,
  /\b(data|results?) table\b/i,
  /\buncertaint(y|ies) of\b|±\s*\d/i,
  /\br\s*(\^|²)\s*2?\s*(=|value)/i,
  /\b(standard deviation|error bars?|p-value|regression line|line of best fit)\b/i,
  /\b(section|part|page)\s+\d+(\.\d+)?\s+(of the|in the)\s+(IA|report|essay)/i,
  /\b(scored|achieved|received|got)\s+(a\s+)?\d+\s*(\/|out of)\s*\d+\b/i,
  /\bpredicted (grade|score) of\b/i,
];

const PERSON_SIGNALS = /\b(because|values?|believ|cares? about|mindset|drives?|motivat|tends? to|habit|would rather|notices?|returns? to|when (it|things|the plan) (matters|fail|goes wrong)|treats?|refus|insist|curious|patient|stubborn|honest|generous|restless|afraid|proud|ashamed|joy|love|hate|wants?|needs?|chooses?|chose)\b/i;

/**
 * Quantified achievements and provenance citations masquerading as personality.
 *
 * The applicant's own example was precise: "Achieved a specific impulse of 210
 * seconds using L-menthol as propellant in the microwave discharge plasma
 * thruster built during the Kyushu University research placement, a quantitative
 * result explicitly named in both the Common App essay context and the UCAS
 * academic preparation draft." Nothing in that is lab-notebook wording, so the
 * mechanics patterns above miss it — but it is still a fact list, not a portrait.
 * These patterns only ever run on ABOUT YOU items, where a number with a unit
 * and an "explicitly named in the X and the Y" clause is a filing mistake, not
 * content: the same sentence in PERSONAL POINTS is exactly what belongs there.
 */
const FACT_DUMP_PATTERNS = [
  /\b(achieved|achieves?|attained|secured|recorded|obtained|earned|built|developed|designed|engineered|implemented|constructed|calculated|measured|fabricated|synthesi[sz]ed)\b[^.\n]{0,140}\b\d+(\.\d+)?\s*(seconds?|secs?|minutes?|hours?|newtons?|kilonewtons?|m\/s|watts?|kilowatts?|volts?|amperes?|kg\b|grams?|kelvin|millimetres?|millimeters?|people|students?|members|participants|schools?|events?|teams?|medals?|places?|rank|impulse|thrust|efficiency|accuracy|growth|reduction|increase|percent|%)/i,
  /\b(specific impulse|thrust (to|of)|power (to|of)|torque (to|of))\s+of?\s*\d/i,
  /\b(explicitly |clearly |directly )?named in both\b/i,
  /\ba quantitative (result|figure|outcome)\b[^.\n]{0,60}\bin (both|the)\b/i,
  /\b(named|stated|listed|documented|recorded|specified) (in|within|across) (both|the)\b[^.\n]{0,120}\band the\b[^.\n]{0,40}\b(draft|essay|context|application|file|profile)\b/i,
];

/** True when a quantified-achievement row is standing in for a portrait item. */
export function looksLikeFactDump(text) {
  const value = String(text || '');
  if (!value.trim()) return false;
  if (!FACT_DUMP_PATTERNS.some((pattern) => pattern.test(value))) return false;
  return !PERSON_SIGNALS.test(value);
}

/**
 * True when an item reads like an assessment detail rather than a portrait.
 *
 * The test is deliberately conservative: it only fires on lab-notebook wording
 * (trial numbers, outliers, data tables, uncertainties, grade fractions) that
 * is NOT accompanied by any language about the person. For ABOUT YOU items it
 * also fires on quantified-achievement rows and provenance citations, which are
 * personal points filed in the wrong section, not personality. The
 * knowledge-base page marks such items, and the refresh pass re-examines them
 * first — where they are rewritten, re-filed to the section they belong in,
 * or removed.
 *
 * @param {string} text the saved item
 * @param {string} [kind] the row's kind; the fact-dump check only applies to 'brief'
 */
export function looksLikeMechanicsDump(text, kind = '') {
  const value = String(text || '');
  if (!value.trim()) return false;
  if (kind === 'brief' && looksLikeFactDump(value)) return true;
  const mechanical = MECHANICS_PATTERNS.some((pattern) => pattern.test(value));
  if (!mechanical) return false;
  return !PERSON_SIGNALS.test(value);
}

export function buildAboutAndPointsPrompt({ profileText, ownText, essayText, limits = null }) {
  const cap = limits || knowledgeLimitsFor({ materials: 1, essays: 1, profile: 1 });
  return `You are building a private, editable, evidence-grounded portrait of one college applicant. Essay drafting and holistic review will use it, so it has to describe a PERSON — how they think, act, and what they want — with enough evidence that a drafter could write in their voice. Depth and accuracy matter more than flattering slogans.

${PERSON_FOCUS_RULES}

WHAT "DEEP" MEANS HERE
A literal inventory ("did physics IA on aerodynamics; joined three clubs") is worthless to a drafter — it already has those words. The portrait has to say what the choices imply: why this question rather than another, what the applicant returns to, what they do when the plan fails, how they treat other people's time, what they notice. Read a document the way a literature teacher reads it: the selection, the ordering, the omissions, and the emotional distance are all information.

RULES FOR A NON-SHALLOW READ
- Use only what the profile and own material state or strongly support. Never invent an experience, number, relationship, result, diagnosis, or motive. When an interpretation is uncertain, label it as "suggests", "may indicate", or "the materials do not establish".
- Read across documents, not just within one paragraph. Look for repeated choices, what the applicant notices, what they spend time on, how they respond when a plan fails, the kinds of questions they ask, how they work with people, and the tension between what they say and what they do.
- ABOUT YOU is not a collection of one-line compliments. Each item is a dense, specific paragraph of 3-5 sentences (60-140 words): the interpretation first, then the evidence in the applicant's own terms, then why that pattern matters for an application. A one-line item is a failed item; so is an item that only summarises a document.
- Cover every category the sources can support — "personality" (how they come across), "actions" (what they repeatedly do), "mindset" (how they think, learn, handle uncertainty, and treat others), "goals" (what they are moving towards). Do not return one item for the whole set when ${cap.about.min}+ are supported: aim for at least ${Math.max(2, Math.ceil(cap.about.min / 4))} in each category the evidence reaches — but merge rather than pad.
- PERSONAL POINTS are separate and concrete: achievements with numbers, roles, places, dates, outcomes, responsibilities, and values shown in actions. Each point is self-contained: carry the names, numbers, dates, places, roles, and outcomes exactly as the source states them, so a drafter can use the point without ever seeing the source — a point that says only "worked on a project" is a failed point. End a point with what it shows about the person when that is not obvious. Do not repeat an About item as a fact. Each point needs a source_label naming the material or profile section it came from, and "evidence" — up to two sentences quoted from that source, which is what the point is a claim about. Aim for ${cap.points.min}+ points; every material listed below should contribute at least one, or you must say in a point that it holds nothing usable. A point from academic work records the question, the choice, or the standard — never a measurement.
- File an achievement, an event, a number, and a quality as separate points unless one source states the connection between them. Never write "X led to Y", "because of that summer she…", or "his research made him a leader" as a fact: two true items side by side is filing, not causation, and a drafter who inherits a false link puts it in the essay. Where the source is silent about why, say what happened and leave the reason out.
- A past essay can provide both concrete events and a voice pattern, but a claim in an AI draft is not confirmed unless the profile or own materials support it. Do not use sample essays, tips, guides, or college references as evidence about the applicant, and do not treat a school named inside the applicant's own story as a school-specific fact about them.
- Do not judge the applicant's chances and do not compare them with other people.
- Write in complete sentences and finish every one of them. Never stop mid-word, never write "someone who de", never leave a clause hanging: an item that is cut off is worse than no item, because the drafter will quote from it.
- Return at most ${cap.about.max} ABOUT YOU items and ${cap.points.max} personal points. Density means substance per item, not padding: two 120-word items beat eight one-liners.

STUDENT PROFILE (form data)
${profileText || '(no profile saved)'}

OWN MATERIALS (written or supplied by the applicant; each has its own analysis lens)
${ownText || '(none added)'}

ESSAY DRAFTS (may include AI-written drafts that the applicant edited. Use them only as corroborated evidence of voice or experience.)
${essayText || '(none)'}

Return JSON only: {"about": [{"category": "personality|actions|mindset|goals", "text": "3-5 dense sentences"}], "points": [{"category": "achievement|experience|value|fact", "text": "...", "source_label": "...", "evidence": "up to two sentences quoted from the source"}]}`;
}

export function buildPatternsPrompt({ sampleText, limits = null }) {
  const cap = limits || knowledgeLimitsFor({ samples: 1 });
  return `You are studying successful college application essays that the applicant chose as models. They were written by other people. They are not the applicant's life.

Read them comparatively and critically. Explain not only what the samples do, but why the choice works on a reader: what is withheld, where the emotional or intellectual turn happens, how evidence earns trust, how diction controls distance, and what a weaker imitation would get wrong. Convert those observations into general rules that can be applied to a completely different life. Never copy a person, place, event, grade, or sentence from a sample.

Be critical of the samples too. A successful essay is not automatically a good one, and a rule like "successful essays open with a scene" is useless to a drafter. Say which move works for which reader, where the sample is weak or risky to imitate, and what a reader with 40 files in front of them would actually remember.

PLATFORM: each sample's label may say [US] or [UK]. Tag a pattern "US" or "UK" when the rule depends on that system, and "General" otherwise. Never apply UK structure (three fixed questions sharing 4,000 characters) to a US essay, or US structure to a UK answer.

WHICH WRITING THE RULE GOVERNS — this is the field a drafter trusts most. A pattern is drawn from one kind of piece, and a rule taken from a personal statement ("open inside a moment", "one story, forward in time") is not a law for a 40-word answer, a why-us argument, an activities list, or a UCAS academic statement. Name the kinds each rule governs in "applies_to", from: ${ESSAY_KINDS.join(', ')}. Use ["any"] only for a rule that is true of every kind of writing (e.g. "cut the sentence that announces the lesson"). A pattern about structure, opening, or length almost never governs every kind — say which one it does.

Categories: opening, structure, evidence, reflection, voice, length, judgement.
Each pattern is one dense, usable rule of 2-4 sentences: the technique, the reason it works on a reader, and the failure mode it prevents. Quote a phrase from the sample where the rule is hard to state without it, and keep the writer's life out of the rule. Aim for at least ${Math.max(1, cap.patterns.min)} patterns across every sample you were given, and at most ${cap.patterns.max}. A sample that produced no pattern should be named in one pattern about what it does badly.

Do not build a causal claim out of adjacent items. If one sample ties an achievement to an event, that is the sample writer's link, not a rule and not the applicant's life; record the technique only.

SAMPLE ESSAYS (craft only)
${sampleText}

Return JSON only: {"patterns": [{"category": "...", "platform": "US|UK|General", "text": "a critical, reusable rule", "applies_to": ["personal_statement"]}]}`;
}

export function buildGuidancePrompt({ guidanceText, limits = null }) {
  const cap = limits || knowledgeLimitsFor({ guidance: 1 });
  return `You are extracting a separate guidance layer from tips, writing guides, college requirements, and application reference documents. These sources are not the applicant's biography and their examples, statistics, and advice must never become facts about the applicant.

Read for the underlying decision rules: what the reader is looking for, what a writer should do or avoid, how to choose evidence, structural constraints, deadlines or requirements, and where common advice becomes misleading. Preserve useful nuance and conflicts between sources instead of flattening everything into slogans. Each item should state the rule, the source it came from in substance, and the practical implication for drafting or review — 2-4 sentences, complete and finished.

Write every rule so a drafter can obey it without reading the original document: "in a 50-word box, answer in the first sentence and spend the rest on one detail" is a rule; "be concise" is not. Where two sources disagree, record both and say which is more specific.

Name which writing each rule governs in "applies_to", from: ${ESSAY_KINDS.join(', ')}. A requirement from a school's own page, or a chapter of a guide about the personal statement, is not a rule for a supplemental or a UCAS answer; only put ["any"] on a rule that is true for every kind of writing (a deadline, a character count, "never invent"). Keep a rule with the essay kind, platform, or school that wrote it — that scope is what makes it usable.

A rule about the applicant's life is a different thing: if the source states a fact about the applicant, quote its exact words in "evidence" so the item cannot drift into an inference.

Categories: writing_principle, application_rule, requirement, warning, process.
Aim for at least ${Math.max(1, cap.guidance.min)} items and at most ${cap.guidance.max}. Keep source-specific constraints in the item rather than presenting them as universal, and note which essay type or platform each rule governs.

GUIDANCE AND REFERENCE SOURCES
${guidanceText || '(none)'}

Return JSON only: {"guidance": [{"category": "...", "text": "a precise rule with its implication", "applies_to": ["why_us", "personal_statement"]}]}`;
}

/**
 * The second kind of build: add what the first one missed.
 *
 * A rebuild replaces Atlas's own items. A deeper pass keeps every one of them and
 * only appends, which is what makes it safe to run the same pile of materials
 * twice when the first pass came back thin. Existing items are shown to the model
 * so it cannot restate them, and near-duplicates are dropped on the way in.
 */
export const DEEPER_SCHEMA = {
  type: 'object',
  properties: {
    about: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' } } } },
    points: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' }, source_label: { type: 'string' }, evidence: { type: 'string' } } } },
    patterns: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, platform: { type: 'string' }, text: { type: 'string' }, applies_to: { type: 'array', items: { type: 'string' } } } } },
    guidance: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' }, applies_to: { type: 'array', items: { type: 'string' } } } } },
  },
};

export function buildDeeperPrompt({ inputs, existingText, limits }) {
  return `You are adding to an existing, evidence-grounded portrait of one college applicant. Everything you return is APPENDED; nothing you return replaces what is already saved.

THE ONLY JOB: write what is missing.
- The items under ALREADY SAVED are complete. Do not repeat them, do not restate them in other words, do not "improve" them, and do not answer with an empty list unless the sources genuinely hold nothing more.
- Go back through the sources one at a time. For each one, ask what it establishes that ALREADY SAVED does not mention: a detail, a habit, a tension, a number, a choice, a way of working, a constraint, a craft move.
- Read between the lines as before: what a document implies about how this person thinks and what they value, always tied to what the text actually says.
- Do not invent an experience, number, relationship, result, or motive. Label an uncertain reading "suggests" or "the materials do not establish".
- Every item is a dense paragraph of 2-5 sentences and a COMPLETE sentence: never stop mid-word, never leave a clause hanging.
- ${limits.about.max} new ABOUT items, ${limits.points.max} new personal points, ${limits.patterns.max} new patterns, ${limits.guidance.max} new guidance items at most. Prefer fewer, fuller items to one-line compliments.
- Sample essays supply craft only, never another person's life. Tips and references supply rules, never biography. Academic work is never scored as a college essay.
- Carry the same fields the first build used: "source_label" and "evidence" (the source's own words) on a new point, and "applies_to" on a new pattern or guidance item — the essay kinds it governs, or ["any"]. An item filed without a scope is read as universal, so an unfamiliar rule is a risk, not a bonus.

${PERSON_FOCUS_RULES}

ALREADY SAVED (do not repeat)
${existingText || '(nothing yet — read every source)'}

STUDENT PROFILE (form data)
${inputs.profileText || '(no profile saved)'}

OWN MATERIALS
${inputs.ownText || '(none)'}

ESSAY DRAFTS
${inputs.essayText || '(none)'}

SAMPLE ESSAYS (craft only)
${inputs.sampleText || '(none)'}

TIPS, GUIDES, AND REFERENCES
${inputs.guidanceText || '(none)'}

Return JSON only: {"about": [...], "points": [...], "patterns": [...], "guidance": [...]} — each entry in the same shape as the first-build schema, and every entry new.`;
}

// ---------------------------------------------------------------------------
// Normalising what the model returned
// ---------------------------------------------------------------------------
/**
 * Keep whole, distinct items up to a cap. A fragment the model returned with a
 * trailing "de" is kept as it is — Atlas does not invent an ending — but the
 * Knowledge Base marks it as cut off so the applicant can finish or delete it.
 */
function cleanItems(list, validCategories, fallbackCategory, max, extra = (_item) => ({}), seen = new Set()) {
  const out = [];
  const limit = Number(max);
  for (const item of Array.isArray(list) ? list : []) {
    const text = clean(item?.text);
    if (!text || text.split(/\s+/).length < 2) continue;
    const category = validCategories[String(item?.category || '').toLowerCase()] ? String(item.category).toLowerCase() : fallbackCategory;
    const key = `${category}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, text, ...extra(item) });
    if (Number.isFinite(limit) && out.length >= limit) break;
  }
  return out;
}

const capOf = (limits, kind, fallback) => (Number.isFinite(Number(limits?.[kind]?.max)) ? Number(limits[kind].max) : fallback);

/** A source's own words, kept whole enough to quote and short enough to travel. */
function sourceEvidence(value) {
  const text = clean(value);
  if (!text) return '';
  return clipToBoundary(text, 320, { marker: '…' });
}

export function normalizeAboutAndPoints(raw, limits = null) {
  return {
    about: cleanItems(raw?.about, ABOUT_CATEGORIES, 'personality', capOf(limits, 'about', KNOWLEDGE_BASE_LIMITS.about)),
    points: cleanItems(raw?.points, POINT_CATEGORIES, 'fact', capOf(limits, 'points', KNOWLEDGE_BASE_LIMITS.points), (item) => ({
      // A source label is a label, not an essay: keep it in full rather than
      // cutting it at an arbitrary character count.
      source_label: clean(item?.source_label) || 'Profile or materials',
      evidence: sourceEvidence(item?.evidence),
    })),
  };
}

export function normalizePatterns(raw, limits = null) {
  return cleanItems(raw?.patterns, PATTERN_CATEGORIES, 'judgement', capOf(limits, 'patterns', KNOWLEDGE_BASE_LIMITS.patterns), (item) => {
    const platform = String(item?.platform || '').trim();
    const match = Object.keys(PATTERN_PLATFORMS).find((p) => p.toLowerCase() === platform.toLowerCase());
    return { platform: match || 'General', shape_keys: appliesToKeys(item?.applies_to) };
  });
}

export function normalizeGuidance(raw, limits = null) {
  return cleanItems(raw?.guidance, GUIDANCE_CATEGORIES, 'writing_principle', capOf(limits, 'guidance', KNOWLEDGE_BASE_LIMITS.guidance), (item) => ({
    shape_keys: appliesToKeys(item?.applies_to),
  }));
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
/** Database rows for a rebuild. Every AI row carries the fingerprint of the inputs it came from. */
export function knowledgeRowsFor({ about = [], points = [], patterns = [], guidance = [] }, { fingerprint, builtAt, model }) {
  const data = { fingerprint, built_at: builtAt, model: model || null };
  /**
   * What a row adds to the shared stamp: the essay kinds a pattern or a tip
   * governs, and the source wording an evidence item rests on. An item that
   * declared neither is filed exactly as it was before.
   */
  const stamp = (item) => {
    const extra = {};
    if (item?.shape_keys?.length) extra.shape_keys = item.shape_keys;
    if (item?.evidence) extra.evidence = item.evidence;
    return Object.keys(extra).length ? { ...data, ...extra } : data;
  };
  return [
    ...about.map((item, i) => ({
      kind: 'brief', category: item.category, text: item.text, origin: 'ai',
      source_label: 'Built from your profile and materials', source_id: '', platform: 'General',
      sort_order: i, data: stamp(item),
    })),
    ...points.map((item, i) => ({
      kind: 'evidence', category: item.category, text: item.text, origin: 'ai',
      source_label: item.source_label, source_id: '', platform: 'General',
      sort_order: i, data: stamp(item),
    })),
    ...patterns.map((item, i) => ({
      kind: 'pattern', category: item.category, text: item.text, origin: 'ai',
      source_label: 'From sample essays you chose', source_id: '', platform: item.platform || 'General',
      sort_order: i, data: stamp(item),
    })),
    ...guidance.map((item, i) => ({
      kind: 'guidance', category: item.category, text: item.text, origin: 'ai',
      source_label: 'From tips, guides, and application references', source_id: '', platform: 'General',
      sort_order: i, data: stamp(item),
    })),
  ];
}

/**
 * How current the AI items are: whether they were built, when, and whether the
 * profile, materials, or drafts have changed since.
 */
export function knowledgeStatus(rows, currentFingerprint) {
  const aiRows = (rows || []).filter((r) => r.origin === 'ai');
  // Sections filed from one material carry no portrait fingerprint: they follow
  // their material (see `materialsNeedingDissection`), not the whole source set.
  const stamps = aiRows.map((row) => row.data).filter((data) => data?.fingerprint);
  const latestStamp = stamps.sort((a, b) => String(b.built_at || '').localeCompare(String(a.built_at || '')))[0] || null;
  const latestRefresh = stamps.map((data) => String(data.refreshed_at || '')).filter(Boolean).sort().reverse()[0] || null;
  return {
    built: aiRows.length > 0,
    builtAt: latestStamp?.built_at || null,
    refreshedAt: latestRefresh,
    stale: aiRows.length > 0 && stamps.some((data) => data.fingerprint !== currentFingerprint),
    // Only portrait items are counted: the refresh pass re-examines those, while
    // a filed section follows its material.
    flagged: aiRows.filter((row) => !row.data?.dissected && looksLikeMechanicsDump(row.text, row.kind)).length,
    dissected: aiRows.filter((row) => row.data?.dissected).length,
    counts: {
      brief: (rows || []).filter((r) => r.kind === 'brief').length,
      evidence: (rows || []).filter((r) => r.kind === 'evidence').length,
      pattern: (rows || []).filter((r) => r.kind === 'pattern').length,
      guidance: (rows || []).filter((r) => r.kind === 'guidance').length,
    },
  };
}

/**
 * Rebuilds the AI items. Steps:
 *  1. Ask the model for About you and personal points (required).
 *  2. Ask it for patterns from the sample essays, if there are any (optional).
 *  3. Create the new AI items.
 *  4. Remove the old AI items, but only the kinds that were rebuilt.
 * A failed step keeps the items it would have replaced.
 *
 * @returns {Promise<{ counts: object, warnings: string[] }>}
 */
export async function rebuildApplicantKnowledge({ inputs, existingRows = [], runAI, isLive, createRows, deleteRow, now = () => new Date().toISOString(), model = null }) {
  if (inputs.empty) {
    throw new Error('Add a profile, a material, or an essay draft first. Atlas builds this from what you have entered.');
  }
  const warnings = [];
  // One budget per build, derived from how much there actually is to read. The
  // model is told both the floor and the ceiling, so a thin answer is a visible
  // failure instead of the default outcome.
  const limits = knowledgeLimitsFor(inputs.counts || {});
  let about = { about: [], points: [] };

  // A source-only rebuild is valid: for example, someone may add only a tips
  // guide or only sample essays. Do not ask the model for a fake applicant
  // portrait when there is no applicant evidence to support one.
  if (inputs.profileText.trim() || inputs.ownText.trim() || inputs.essayText.trim()) {
    const first = await runAI({
      prompt: buildAboutAndPointsPrompt({ ...inputs, limits }),
      response_json_schema: ABOUT_AND_POINTS_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build your profile' });
    if (isLive(first)) about = normalizeAboutAndPoints(first.result, limits);
    else throw first?.error || new Error('The AI did not return a profile. Your existing items were kept.');
  }

  let patterns = null;
  if (inputs.sampleText.trim()) {
    const second = await runAI({
      prompt: buildPatternsPrompt({ ...inputs, limits }),
      response_json_schema: PATTERNS_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build the patterns' });
    if (isLive(second)) patterns = normalizePatterns(second.result, limits);
    else warnings.push('The sample-essay patterns could not be built, so the existing patterns were kept.');
  }

  let guidance = null;
  if (inputs.guidanceText?.trim()) {
    const third = await runAI({
      prompt: buildGuidancePrompt({ ...inputs, limits }),
      response_json_schema: GUIDANCE_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build the guidance layer' });
    if (isLive(third)) guidance = normalizeGuidance(third.result, limits);
    else warnings.push('The tips and reference guidance could not be built, so the existing guidance was kept.');
  }

  // Density is the point of the feature. Say out loud when the answer came back
  // thinner than the pile of sources supports, and point at "Go deeper".
  const thin = [
    limits.about.min > 0 && about.about.length > 0 && about.about.length < limits.about.min
      ? `only ${about.about.length} item${about.about.length === 1 ? '' : 's'} about you from ${(inputs.counts?.materials || 0) + (inputs.counts?.essays || 0) + (inputs.counts?.profile ? 1 : 0)} source${(inputs.counts?.materials || 0) + (inputs.counts?.essays || 0) === 1 ? '' : 's'}` : '',
    limits.points.min > 0 && about.points.length > 0 && about.points.length < limits.points.min
      ? `only ${about.points.length} personal point${about.points.length === 1 ? '' : 's'}` : '',
    limits.patterns.min > 0 && patterns && patterns.length > 0 && patterns.length < limits.patterns.min
      ? `only ${patterns.length} pattern${patterns.length === 1 ? '' : 's'} from ${inputs.counts?.samples || 0} sample${(inputs.counts?.samples || 0) === 1 ? '' : 's'}` : '',
    limits.guidance.min > 0 && guidance && guidance.length > 0 && guidance.length < limits.guidance.min
      ? `only ${guidance.length} guidance item${guidance.length === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  if (thin.length) {
    warnings.push(`This build came back thinner than the sources allow (${thin.join('; ')}). Press “Go deeper” to append what was missed without losing anything already saved.`);
  }

  const builtAt = now();
  const fresh = knowledgeRowsFor({
    about: about.about,
    points: about.points,
    patterns: patterns || [],
    guidance: guidance || [],
  }, { fingerprint: inputs.fingerprint, builtAt, model });
  // Only a kind that produced new items replaces its old items. An empty answer
  // never removes what was there before.
  const replacing = new Set([
    ...(about.about.length ? ['brief'] : []),
    ...(about.points.length ? ['evidence'] : []),
    ...(patterns?.length ? ['pattern'] : []),
    ...(guidance?.length ? ['guidance'] : []),
  ]);
  if (!replacing.size) warnings.push('The AI returned nothing new, so your existing items were kept.');

  if (fresh.length) await createRows(fresh);

  // Sections filed from one material (dissected rows) are not part of the
  // portrait: they follow their material and are replaced only when it changes
  // or is removed, so a rebuild must not take them with it.
  const stale = existingRows.filter((row) => row.origin === 'ai' && !row.data?.dissected && replacing.has(row.kind));
  let failedDeletes = 0;
  for (const row of stale) {
    try {
      await deleteRow(row.id);
    } catch {
      failedDeletes += 1;
    }
  }
  if (failedDeletes) warnings.push(`${failedDeletes} earlier AI item${failedDeletes === 1 ? '' : 's'} could not be removed. They are still listed; remove them by hand if they are out of date.`);

  return {
    counts: {
      brief: about.about.length,
      evidence: about.points.length,
      pattern: patterns ? patterns.length : 0,
      guidance: guidance ? guidance.length : 0,
    },
    warnings,
  };
}

/**
 * Whether a new item is really the same claim as a saved one.
 *
 * A deeper pass reads the whole saved portrait, and a model asked not to repeat
 * itself will still paraphrase occasionally. Comparing the shared content words
 * catches that: two items describing the same thing in different words have
 * almost the same vocabulary, two different facts do not.
 */
export function nearDuplicate(text, seenList) {
  const words = new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4));
  if (!words.size) return false;
  for (const other of seenList) {
    let shared = 0;
    for (const word of other) if (words.has(word)) shared += 1;
    const smaller = Math.min(words.size, other.size) || 1;
    if (shared / smaller > 0.62) return true;
  }
  return false;
}

export const wordSet = (text) => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4));

/**
 * `cleanItems` keeps only `category` and `text`. A deeper pass writes database
 * rows, and a row without its source label or platform loses its provenance in the
 * UI, so this mirrors the same cleaning and carries those two fields through.
 */
function itemsWithProvenance(list, valid, fallback, maxChars) {
  const limit = Number.isFinite(maxChars) ? Math.max(0, maxChars) : (list || []).length;
  return (Array.isArray(list) ? list : []).map((item) => {
    const text = String(item?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 700);
    if (!text) return null;
    const category = valid && !Object.prototype.hasOwnProperty.call(valid, item?.category) ? fallback : item.category;
    // The source's own words travel with the item (see the dissection brief):
    // a drafter can quote what the applicant actually wrote instead of the
    // summary of it, and the applicant can see what an item was built on.
    const evidence = clipToBoundary(String(item?.evidence ?? '').replace(/\s+/g, ' ').trim(), 320, { marker: '…' });
    return {
      category,
      text,
      evidence,
      source_label: String(item?.source_label ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      platform: String(item?.platform ?? '').replace(/\s+/g, ' ').trim(),
      applies_to: Array.isArray(item?.applies_to) ? item.applies_to : [],
    };
  }).filter(Boolean).slice(0, limit);
}

/**
 * Turns a model's { about, points, patterns, guidance } answer into new rows,
 * dropping anything that restates a saved item. Shared by "Go deeper" and the
 * in-place refresh, so both append under the same rules.
 *
 * @param {object} result the model answer
 * @param {{ saved: object[], ask: object, countOf: (kind: string) => number, data: object }} options
 */
function additionRows(result, { saved, ask, countOf, data }) {
  const seenLists = {
    about: saved.filter((r) => r.kind === 'brief').map((r) => wordSet(r.text)),
    points: saved.filter((r) => r.kind === 'evidence').map((r) => wordSet(r.text)),
    patterns: saved.filter((r) => r.kind === 'pattern').map((r) => wordSet(r.text)),
    guidance: saved.filter((r) => r.kind === 'guidance').map((r) => wordSet(r.text)),
  };
  const fresh = [];
  const add = (list, kind, valid, fallback, bucket) => {
    for (const item of itemsWithProvenance(list, valid, fallback, ask[bucket].max)) {
      const set = wordSet(item.text);
      if (nearDuplicate(item.text, seenLists[bucket])) continue;
      seenLists[bucket].push(set);
      const extra = {};
      // A new pattern or tip may name the kinds it governs; a new point may
      // carry the source's own words. Both are filed, not dropped, so "Go
      // deeper" is held to the same standard as a first build.
      const shapes = appliesToKeys(item?.applies_to);
      if (shapes.length) extra.shape_keys = shapes;
      if (item?.evidence) extra.evidence = item.evidence;
      fresh.push({
        kind,
        category: item.category,
        text: item.text,
        origin: 'ai',
        source_label: item.source_label || '',
        source_id: '',
        platform: item.platform || 'General',
        sort_order: countOf(kind) + fresh.filter((row) => row.kind === kind).length,
        data: { ...data, ...extra },
      });
    }
  };
  add(result?.about, 'brief', ABOUT_CATEGORIES, 'personality', 'about');
  add(
    (Array.isArray(result?.points) ? result.points : []).map((item) => ({ ...item, source_label: clean(item?.source_label) || 'Profile or materials' })),
    'evidence', POINT_CATEGORIES, 'fact', 'points',
  );
  const patternItems = (Array.isArray(result?.patterns) ? result.patterns : []).map((item) => {
    const match = Object.keys(PATTERN_PLATFORMS).find((p) => p.toLowerCase() === String(item?.platform || '').trim().toLowerCase());
    return { ...item, platform: match || 'General' };
  });
  add(patternItems, 'pattern', PATTERN_CATEGORIES, 'judgement', 'patterns');
  add(result?.guidance, 'guidance', GUIDANCE_CATEGORIES, 'writing_principle', 'guidance');
  return fresh;
}

/**
 * "Go deeper": read the same sources again and append only what is new.
 *
 * Nothing here deletes a row, so a longer portrait is always safe to build. The
 * saved items are passed to the model as a do-not-repeat list and used again on
 * the way in, so an item that restates one already saved is dropped rather than
 * doubling the list.
 *
 * @returns {Promise<{ counts: object, warnings: string[] }>}
 */
export async function extendApplicantKnowledge({ inputs, existingRows = [], runAI, isLive, createRows, model = null, now = () => new Date().toISOString() }) {
  if (inputs.empty) {
    throw new Error('Add a profile, a material, or an essay draft first. Atlas builds this from what you have entered.');
  }
  const saved = (existingRows || []).filter((row) => String(row.text || '').trim());
  const existingText = saved.map((row) => `- [${row.kind}] ${row.text}`).join('\n');
  // Room is measured against the absolute ceiling for a kind, not against the
  // size of this build — a portrait that stopped short is the thing a deeper pass
  // exists to fix. One pass still asks for at most a build's worth of new items,
  // so the list grows in steps the applicant can read rather than without bound.
  const limits = knowledgeLimitsFor(inputs.counts || {});
  const countOf = (kind) => saved.filter((row) => row.kind === kind).length;
  const headroom = (kind, base, ceiling) => Math.min(base, Math.max(0, ceiling - countOf(kind)));
  const ask = {
    about: { min: 0, max: headroom('brief', limits.about.max, MAX_LIMITS.about) },
    points: { min: 0, max: headroom('evidence', limits.points.max, MAX_LIMITS.points) },
    patterns: { min: 0, max: headroom('pattern', limits.patterns.max, MAX_LIMITS.patterns) },
    guidance: { min: 0, max: headroom('guidance', limits.guidance.max, MAX_LIMITS.guidance) },
  };
  if (!ask.about.max && !ask.points.max && !ask.patterns.max && !ask.guidance.max) {
    return { counts: { about: 0, points: 0, patterns: 0, guidance: 0 }, warnings: ['Every kind is already at the largest size Atlas allows for one knowledge base. Remove or merge an item to make room, or edit an existing item so it carries more.'] };
  }

  const outcome = await runAI({
    prompt: buildDeeperPrompt({ inputs, existingText, limits: ask }),
    response_json_schema: DEEPER_SCHEMA,
  }, { quiet: true, fallbackTitle: 'Could not go deeper' });
  if (!isLive(outcome)) throw outcome?.error || new Error('The AI did not return anything. Your existing items were kept.');

  const fresh = additionRows(outcome.result || {}, {
    saved, ask, countOf, data: { fingerprint: inputs.fingerprint, built_at: now(), model: model || null, appended: true },
  });

  if (fresh.length) await createRows(fresh);
  const byKind = (kind) => fresh.filter((row) => row.kind === kind).length;
  const warnings = [];
  if (!fresh.length) {
    warnings.push('The model found nothing new to add at this depth. What is already saved stays exactly as it is.');
  }
  return {
    counts: { about: byKind('brief'), points: byKind('evidence'), patterns: byKind('pattern'), guidance: byKind('guidance') },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Refresh: re-examine the saved items one by one instead of starting over
// ---------------------------------------------------------------------------
export const REFRESH_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          item: { type: 'number' },
          action: { type: 'string', enum: ['keep', 'revise', 'remove', 'move'] },
          text: { type: 'string' },
          category: { type: 'string' },
          to: { type: 'string', enum: ['about', 'points', 'patterns', 'guidance'] },
          reason: { type: 'string' },
        },
      },
    },
    additions: DEEPER_SCHEMA,
  },
};

/** The most AI items one refresh may remove, as a share of the AI items it saw. */
export const REFRESH_REMOVAL_CAP = 0.4;

export function buildRefreshPrompt({ inputs, numbered, manualText, limits }) {
  return `You are re-examining a saved, private knowledge base about one college applicant ITEM BY ITEM against the sources as they are now. This is maintenance, not a rebuild: keep what is still true and useful, update what is stale or weak, remove only what fails the standard, and add only what is genuinely missing. The items the applicant wrote themselves are shown for context and are never yours to change.

${PERSON_FOCUS_RULES}

FOR EVERY NUMBERED AI ITEM, DECIDE:
- keep — still accurate, person-focused, and not a duplicate. Do not list it; unlisted items are kept.
- revise — the substance is right but the item fails PERSON FIRST (it records mechanics, restates grades, summarises a document, or stops at "did X" without saying what it shows), is weaker than the sources now support, or is partly out of date. Return the complete replacement text (2-5 finished sentences) and, if it should move, the new category within the same kind.
- move — the item is true and worth keeping but it is filed in the wrong section: a quantified fact, date, or outcome sitting in ABOUT YOU belongs in PERSONAL POINTS ("points"); a person-level insight — what the fact shows about the applicant — sitting in PERSONAL POINTS belongs in ABOUT YOU ("about"); a craft rule belongs in "patterns"; a reusable rule or requirement belongs in "guidance". Return "to" (one of about, points, patterns, guidance), the text to carry over (the item as saved, lightly reframed so it reads well in the destination section — never a new fact), a destination category, and the reason. A move keeps the evidence and fixes the filing; prefer it to remove whenever the content is real but the section is wrong.
- remove — contradicted by the current sources, a near-duplicate of another item (name its number in the reason), or an assessment-mechanics note with nothing about the person in it. Prefer revising to removing whenever the item holds one true thing about the person; prefer moving to removing whenever the thing is true but filed in the wrong section; a removal destroys evidence and the applicant asked for that to be rare.
Items marked [CHECK] were flagged by Atlas as reading like lab-notebook detail or a fact list rather than a portrait. Each one needs an explicit decision: move it to the section it belongs in, revise it into something about the person, or remove it.

THEN, UNDER "additions", ADD ONLY WHAT IS MISSING
- Go through the sources once more and add an item only where no saved item (AI or applicant-written) covers it. New items follow the same standard: a complete observation about the person, with its evidence, in 2-5 finished sentences.
- At most ${limits.about.max} new ABOUT items, ${limits.points.max} new personal points, ${limits.patterns.max} new patterns, ${limits.guidance.max} new guidance items. Zero is a fine answer.
- Keep the whole base compact. After your pass it should be at most as long as before unless the sources genuinely grew.
- Never invent an experience, number, relationship, result, or motive. Sample essays supply craft only, never another person's life; tips and references supply rules, never biography.

SAVED AI ITEMS (numbered; decide each one)
${numbered || '(none)'}

WRITTEN BY THE APPLICANT (context only — never revise or remove these, and do not duplicate them)
${manualText || '(none)'}

STUDENT PROFILE (form data)
${inputs.profileText || '(no profile saved)'}

OWN MATERIALS
${inputs.ownText || '(none)'}

ESSAY DRAFTS
${inputs.essayText || '(none)'}

SAMPLE ESSAYS (craft only)
${inputs.sampleText || '(none)'}

TIPS, GUIDES, AND REFERENCES
${inputs.guidanceText || '(none)'}

Return JSON only: {"decisions": [{"item": <number>, "action": "revise|remove|move", "text": "<full replacement when revising; carried or lightly reframed text when moving>", "category": "<optional>", "to": "about|points|patterns|guidance (only for move)", "reason": "<one sentence>"}], "additions": {"about": [...], "points": [...], "patterns": [...], "guidance": [...]}}`;
}

const CATEGORIES_BY_KIND = {
  brief: ABOUT_CATEGORIES, evidence: POINT_CATEGORIES, pattern: PATTERN_CATEGORIES, guidance: GUIDANCE_CATEGORIES,
};

/** Runs `work` over `items` with at most `limit` in flight: a refresh touches many rows. */
async function eachWithLimit(items, limit, work) {
  const queue = [...items];
  const failures = [];
  const workers = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await work(item);
      } catch (error) {
        failures.push({ item, error });
      }
    }
  });
  await Promise.all(workers);
  return failures;
}

/** The destination a refresh decision names, as the kind it writes under. */
export const REFRESH_MOVE_KINDS = { about: 'brief', points: 'evidence', patterns: 'pattern', guidance: 'guidance' };
/** Where an item lands when the model moves it but leaves the category invalid. */
const MOVE_FALLBACK_CATEGORY = {
  brief: 'personality', evidence: 'fact', pattern: 'judgement', guidance: 'writing_principle',
};

/**
 * Reads the model's decisions against the numbered list. Unknown numbers,
 * repeated numbers, revisions without text, and moves that would duplicate the
 * destination are dropped; the removal cap is applied in the order the model
 * gave, so a model that wants to delete half the base can only delete the
 * share Atlas allows.
 */
export function normalizeRefreshDecisions(raw, aiRows) {
  const decisions = Array.isArray(raw?.decisions) ? raw.decisions : [];
  const seen = new Set();
  const out = { revise: [], remove: [], move: [], ignored: 0, capped: 0 };
  // A tiny base (one or two items) cannot lose anything; otherwise at most the
  // capped share, but always at least one so a plain duplicate can go.
  const maxRemovals = aiRows.length >= 3 ? Math.max(1, Math.floor(aiRows.length * REFRESH_REMOVAL_CAP)) : 0;
  for (const decision of decisions) {
    const index = Number(decision?.item);
    const row = Number.isInteger(index) && index >= 1 ? aiRows[index - 1] : null;
    const action = String(decision?.action || '').toLowerCase();
    if (!row || seen.has(row.id) || action === 'keep') { if (!row || seen.has(row?.id)) out.ignored += 1; continue; }
    if (action === 'revise') {
      const text = clean(decision?.text);
      if (!text || text.split(/\s+/).length < 4) { out.ignored += 1; continue; }
      const table = CATEGORIES_BY_KIND[row.kind] || {};
      const category = table[String(decision?.category || '').toLowerCase()] ? String(decision.category).toLowerCase() : row.category;
      seen.add(row.id);
      out.revise.push({ row, text, category, reason: clean(decision?.reason) });
    } else if (action === 'move') {
      // A move re-files content that stays; the cap on destruction is about
      // losing evidence, and a move loses none — the destination row is
      // written before the original is deleted, so this is exempt from it.
      const to = REFRESH_MOVE_KINDS[String(decision?.to || '').toLowerCase()];
      if (!to || to === row.kind) { out.ignored += 1; continue; }
      const text = clean(decision?.text) || clean(row.text);
      if (!text || text.split(/\s+/).length < 4) { out.ignored += 1; continue; }
      const table = CATEGORIES_BY_KIND[to] || {};
      const category = table[String(decision?.category || '').toLowerCase()] ? String(decision.category).toLowerCase() : MOVE_FALLBACK_CATEGORY[to];
      seen.add(row.id);
      out.move.push({ row, to, text, category, reason: clean(decision?.reason) });
    } else if (action === 'remove') {
      if (out.remove.length >= maxRemovals) { out.capped += 1; continue; }
      seen.add(row.id);
      out.remove.push({ row, reason: clean(decision?.reason) });
    } else {
      out.ignored += 1;
    }
  }
  return out;
}

/**
 * The in-place update. Steps:
 *  1. Show the model every AI item, numbered, with the sources as they are now.
 *  2. Revise, re-file (move), or remove the items it names — removals are
 *     capped, and a move writes its destination before the original goes —
 *     and keep the rest.
 *  3. Append what is missing, under the same no-repeat rule as "Go deeper".
 *  4. Stamp every surviving AI item with the current fingerprint, so the base is
 *     no longer reported as stale.
 * Manual items are never touched. Nothing is deleted before its replacement is
 * written, and a failed model call changes nothing at all.
 *
 * @returns {Promise<{ counts: { revised: number, removed: number, added: number, kept: number, moved: number, flagged: number }, warnings: string[] }>}
 */
export async function refreshApplicantKnowledge({
  inputs, existingRows = [], runAI, isLive, createRows, updateRow, deleteRow,
  model = null, now = () => new Date().toISOString(), concurrency = 4,
}) {
  if (inputs.empty) {
    throw new Error('Add a profile, a material, or an essay draft first. Atlas builds this from what you have entered.');
  }
  const saved = (existingRows || []).filter((row) => String(row.text || '').trim());
  const aiRows = saved.filter((row) => row.origin === 'ai' && !row.data?.dissected);
  const manualRows = saved.filter((row) => row.origin !== 'ai');
  if (!aiRows.length) {
    return { counts: { revised: 0, removed: 0, added: 0, kept: 0, moved: 0, flagged: 0 }, warnings: ['There are no AI-built items to re-examine yet. Build the knowledge base first.'] };
  }
  const flagged = aiRows.filter((row) => looksLikeMechanicsDump(row.text, row.kind));
  const numbered = aiRows.map((row, i) => `${i + 1}. [${row.kind}/${row.category}]${looksLikeMechanicsDump(row.text, row.kind) ? ' [CHECK]' : ''} ${row.text}`).join('\n');
  const manualText = manualRows.map((row) => `- [${row.kind}] ${row.text}`).join('\n');
  const limits = knowledgeLimitsFor(inputs.counts || {});
  const countOf = (kind) => saved.filter((row) => row.kind === kind).length;
  const headroom = (kind, base, ceiling) => Math.min(base, Math.max(0, ceiling - countOf(kind)));
  const ask = {
    about: { min: 0, max: headroom('brief', Math.ceil(limits.about.max / 2), MAX_LIMITS.about) },
    points: { min: 0, max: headroom('evidence', Math.ceil(limits.points.max / 2), MAX_LIMITS.points) },
    patterns: { min: 0, max: headroom('pattern', Math.ceil(limits.patterns.max / 2), MAX_LIMITS.patterns) },
    guidance: { min: 0, max: headroom('guidance', Math.ceil(limits.guidance.max / 2), MAX_LIMITS.guidance) },
  };

  const outcome = await runAI({
    prompt: buildRefreshPrompt({ inputs, numbered, manualText, limits: ask }),
    response_json_schema: REFRESH_SCHEMA,
  }, { quiet: true, fallbackTitle: 'Could not refresh the knowledge base' });
  if (!isLive(outcome)) throw outcome?.error || new Error('The AI did not return anything. Your existing items were kept exactly as they were.');

  const result = outcome.result || {};
  const decisions = normalizeRefreshDecisions(result, aiRows);
  const warnings = [];
  const stamp = { fingerprint: inputs.fingerprint, refreshed_at: now(), model: model || null };

  // 2. Revisions first, then additions, then removals — a removal only happens
  //    after everything that replaces or complements it has been written.
  const revisedIds = new Set();
  const revisionFailures = await eachWithLimit(decisions.revise, concurrency, async ({ row, text, category, reason }) => {
    const updated = await updateRow(row.id, {
      text, category,
      data: { ...(row.data || {}), ...stamp, revised_at: stamp.refreshed_at, revision_reason: reason || '' },
    });
    if (!updated) throw new Error('update not confirmed');
    revisedIds.add(row.id);
  });
  if (revisionFailures.length) warnings.push(`${revisionFailures.length} item${revisionFailures.length === 1 ? '' : 's'} could not be updated and ${revisionFailures.length === 1 ? 'was' : 'were'} left as ${revisionFailures.length === 1 ? 'it was' : 'they were'}.`);

  const removingIds = new Set(decisions.remove.map(({ row }) => row.id));
  // 2b. Moves re-file content that stays true: the destination row is written
  //     first and the original removed after, so a move can never lose evidence.
  //     A destination that already says the same thing gets no duplicate and the
  //     original is kept for the applicant to see (and delete) by hand.
  const movedIds = new Set();
  const movedRows = [];
  const destinationWords = new Map();
  for (const { row, to, text, category, reason } of decisions.move) {
    if (!destinationWords.has(to)) destinationWords.set(to, saved.filter((r) => r.kind === to).map((r) => wordSet(r.text)));
    if (nearDuplicate(text, destinationWords.get(to))) {
      warnings.push(`“${clipToBoundary(text, 70, { marker: '…' })}” was not moved: ${to === 'brief' ? 'ABOUT YOU' : to === 'evidence' ? 'PERSONAL POINTS' : to === 'pattern' ? 'the patterns' : 'the guidance'} already covers it. The saved item was kept either way.`);
      continue;
    }
    const created = await createRows([{
      kind: to,
      category,
      text,
      origin: 'ai',
      source_label: clean(row.source_label) || 'Re-filed by Atlas from another section',
      source_id: String(row.source_id || ''),
      platform: to === 'pattern' ? (row.platform || 'General') : 'General',
      sort_order: saved.filter((r) => r.kind === to).length + movedRows.filter((r) => r.kind === to).length,
      target_university_id: row.target_university_id || null,
      target_essay_id: row.target_essay_id || null,
      target_platform: row.target_platform || null,
      target_task: row.target_task || null,
      data: { ...stamp, moved_from: row.kind, moved_at: stamp.refreshed_at, move_reason: reason || '' },
    }]).catch(() => null);
    if (!created) {
      warnings.push(`“${clipToBoundary(text, 70, { marker: '…' })}” could not be moved, so the original stayed where it was.`);
      continue;
    }
    movedRows.push({ kind: to, text, source_label: clean(row.source_label) || '' });
    destinationWords.get(to).push(wordSet(text));
    try {
      await deleteRow(row.id);
      movedIds.add(row.id);
    } catch {
      warnings.push(`The moved copy of “${clipToBoundary(text, 70, { marker: '…' })}” was saved, but its original could not be removed. Delete the old one by hand if you see both.`);
    }
  }
  const fresh = additionRows(result.additions || {}, {
    saved: [...saved.filter((row) => !removingIds.has(row.id) && !movedIds.has(row.id)), ...movedRows],
    ask, countOf, data: { ...stamp, built_at: stamp.refreshed_at, appended: true },
  });
  if (fresh.length) await createRows(fresh);

  let removed = 0;
  for (const { row } of decisions.remove) {
    try {
      await deleteRow(row.id);
      removed += 1;
    } catch {
      warnings.push(`“${clipToBoundary(row.text, 80, { marker: '…' })}” could not be removed and is still listed.`);
    }
  }
  if (decisions.capped) {
    warnings.push(`The model wanted to remove ${decisions.capped} more item${decisions.capped === 1 ? '' : 's'} than Atlas allows in one pass (at most ${Math.round(REFRESH_REMOVAL_CAP * 100)}% of the AI items). They were kept; run Refresh again if the next pass still objects to them.`);
  }

  // 4. Stamp the kept items so the base stops reporting itself as stale.
  const kept = aiRows.filter((row) => !revisedIds.has(row.id) && !removingIds.has(row.id) && !movedIds.has(row.id));
  const stampFailures = await eachWithLimit(kept.filter((row) => row.data?.fingerprint !== inputs.fingerprint), concurrency, async (row) => {
    const updated = await updateRow(row.id, { data: { ...(row.data || {}), ...stamp } });
    if (!updated) throw new Error('update not confirmed');
  });
  if (stampFailures.length) warnings.push(`${stampFailures.length} kept item${stampFailures.length === 1 ? '' : 's'} could not be re-stamped, so the base may still show as out of date.`);

  return {
    counts: { revised: revisedIds.size, removed, added: fresh.length, kept: kept.length, moved: movedIds.size, flagged: flagged.length },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Dissection: one material, filed by school / essay / platform / task
// ---------------------------------------------------------------------------
export const ESSAY_KINDS = [
  'why_us', 'why_major', 'community', 'challenge', 'activity', 'identity', 'intellectual', 'talent',
  'goals', 'contribution', 'explain', 'gratitude', 'micro', 'personal_statement', 'activities_list', 'other',
];

export const DISSECTION_SCHEMA = {
  type: 'object',
  properties: {
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          section: { type: 'string' },
          school: { type: 'string' },
          essay_kind: { type: 'string' },
          platform: { type: 'string' },
          audience: { type: 'string', enum: ['sample', 'own', 'guide', 'school'] },
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                category: { type: 'string' },
                text: { type: 'string' },
                evidence: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

/** Roles whose documents can hold parts that belong to one school or one essay. */
const DISSECTABLE_ROLES = new Set(['auto', 'applicant_evidence', 'writing_draft', 'sample_craft', 'personal_context', 'advice', 'application_reference']);
/** Shorter than this, a material has nothing to dissect. */
const MIN_DISSECT_CHARS = 700;
/** The most text one dissection call reads. */
const DISSECT_TEXT_CHARS = 48000;

/** What the dissection of a material depends on. Changes when the text, the analysis, or the row's own scope changes. */
export function materialDissectionKey(material) {
  const presented = presentMaterial(material);
  return sourceKey(JSON.stringify([
    'person-first-v2', presented?.id, presented?.title, presented?.type, presented?.analysis_role,
    String(presented?.content || ''), presented?.analysis?.analyzed_at || '',
    String(presented?.notes || ''),
    presented?.target_university_id || '', presented?.target_essay_id || '', presented?.target_platform || '', presented?.target_task || '',
  ]));
}

/** The text a dissection reads: the document, else the notes, plus the deep analysis when there is one. */
function dissectionText(presented) {
  const body = String(presented?.content || '').trim() || String(presented?.notes || '').trim();
  const analysis = presented?.analysis?.status === 'ready' ? presented.analysis : null;
  const absorbed = analysis
    ? ['deep_read', 'significance'].map((key) => clean(analysis[key])).filter(Boolean).join('\n')
    : '';
  return clipToBoundary([body, absorbed ? `\n\nATLAS'S DEEP READING OF THIS MATERIAL:\n${absorbed}` : ''].join(''), DISSECT_TEXT_CHARS);
}

/** Whether a material is worth a dissection call at all. */
export function canDissectMaterial(material) {
  const presented = presentMaterial(material);
  if (!presented) return false;
  const role = materialAnalysisRole(presented);
  if (!DISSECTABLE_ROLES.has(role)) return false;
  const text = String(presented.content || '').trim() || String(presented.notes || '').trim();
  return text.length >= MIN_DISSECT_CHARS;
}

/**
 * Materials whose sections have not been filed yet, or whose text changed
 * since they were. Rows written by a dissection carry `data.dissection_key`.
 */
export function materialsNeedingDissection(materials, rows) {
  const filed = new Map();
  for (const row of rows || []) {
    if (row?.data?.dissected && row.source_id) filed.set(String(row.source_id), row.data.dissection_key || '');
  }
  return (materials || []).filter((material) => {
    if (!canDissectMaterial(material)) return false;
    const key = materialDissectionKey(material);
    return filed.get(String(material.id)) !== key;
  });
}

/** Dissected rows whose material no longer exists, or whose material changed. */
export function staleDissectionRows(materials, rows) {
  const keys = new Map((materials || []).map((material) => [String(material.id), materialDissectionKey(material)]));
  return (rows || []).filter((row) => row?.data?.dissected && row.source_id
    && (!keys.has(String(row.source_id)) || keys.get(String(row.source_id)) !== row.data.dissection_key));
}

export function buildDissectionPrompt({ material, text, universities = [], essays = [] }) {
  const presented = presentMaterial(material);
  const role = materialAnalysisRole(presented);
  const schools = universities.map((u) => u.name).filter(Boolean);
  const essayList = essays.map((e) => `${e.title || 'Untitled'}${e.university_name ? ` (${e.university_name})` : ''}: ${clipToBoundary(String(e.prompt || ''), 140, { marker: '…' }) || '(no prompt)'}`);
  return `You are filing ONE material into the sections an admissions reader would keep apart, so that later drafting reads only the part that is relevant. A successful full application is an activities list plus a personal statement plus several supplements for several schools; a guide has chapters per essay type; the applicant's own notes may address one school. Each of those parts teaches something different and must not be mixed into one pile.

WHAT THIS DOCUMENT IS ACTUALLY ABOUT — DECIDE THIS BEFORE YOU FILE ANYTHING
A title, one school name, and one passing mention are not subjects. Say what the document as a whole is FOR: whose application, which essay, which task. A guide that mentions Stanford in an example is a guide, not a Stanford document. A draft that mentions "Course 16" is not MIT's own material. A resume, a transcript, or an assessment of the applicant's writing is none of those things at once. Never name or scope a section after a single mention, and never let a rule written for one kind of writing become a universal law: a tip about the personal statement is filed with that kind and nowhere else.

THE MATERIAL
Title: ${presented.title || '(untitled)'}
Type: ${presented.type || 'document'} · Lens: ${role}
${presented.notes ? `Applicant's context notes: ${clipToBoundary(presented.notes, 600, { marker: '…' })}\n` : ''}
<<<MATERIAL
${text}
MATERIAL>>>

THE APPLICANT'S OWN LIST (match sections to these when they fit; never force a match)
Schools: ${schools.length ? schools.join('; ') : '(none saved)'}
Essays: ${essayList.length ? `\n- ${essayList.join('\n- ')}` : '(none saved)'}

WHAT TO RETURN
Personal experiences, values, goals and biographical facts are shared across ALL applications, including when they are found inside a UCAS or school-specific draft: extract them as audience "own" with school "", platform "", and essay_kind "other", and still give the section its real name — the name is how a later reader knows which part of the applicant's writing a fact came out of. The source title is provenance, NEVER a restriction. Only writing guidance or school references may be school/platform-specific. Match school references only to the saved school list; never invent a target. Separate personal evidence from school-specific fit claims.
Return [] in "sections" when the material has no part that belongs to a specific school, essay kind, platform, or task — a resume, a transcript, or a single general reflection usually has none, and that is the correct answer.
A section describes only its own part of the material. Never carry a rule, a fact, or a name across from another chapter, page, or essay into this one, and never summarise the whole document in one section: file what a drafter working on THIS part would obey.
Otherwise, one entry per distinct section, at most 8:
- "section": a short name a reader would recognise ("Stanford — roommate essay", "Activities list", "Common App personal statement", "How to write a why-us essay").
- "school": the university the section is FOR, exactly as written in the material, or "". Fill it ONLY when the material itself targets that school — a supplement written for it, that school's own guide or requirements. NEVER name a school for the applicant's own story, reflection, or past writing: a personal statement or a life experience is the applicant's biography, which every school reads. If such a text mentions a university in passing, the section still gets "school": "" — that mention is content, not a filing address.
- General guidance ("how to write Ivy League essays", "Common App tips") is platform- or kind-level, never school-level: leave "school" empty for it even if the guide name-drops schools.
- "essay_kind": one of ${ESSAY_KINDS.join(', ')}.
- "platform": common_app, uc, ucas, coalition, direct, or "".
- "audience": "sample" (someone else's successful work), "own" (the applicant's own writing or notes), "guide" (advice or reference about how to write), or "school" (information about a school, its readers, atmosphere, or student body).
- "items": 1-4 items, each {"category", "text", "evidence"}, 2-3 finished sentences, and specific:
    · "evidence" is what this item rests on: up to two sentences quoted from THIS section of the material (the applicant's own wording where it is stronger than yours). Nothing may go in "text" that "evidence" does not support, and an item with no evidence behind it is left out rather than inferred.
    · for "sample": the craft that made THIS section work for THIS reader — the move, why it lands, what a weak imitation gets wrong. Never copy the writer's life. Categories: opening, structure, evidence, reflection, voice, length, judgement.
    · for "own": what this part shows about the applicant as a person, usable for this essay kind — their mindset, how they act, what drives them — with the concrete evidence. Categories: personality, actions, mindset, goals, achievement, experience, value, fact.
    · for "guide": the decision rule a drafter can obey without reading the guide, and the kind of writing it governs. Categories: writing_principle, application_rule, requirement, warning, process.
    · for "school": what this school's readers reward, the atmosphere, the student body, programmes named — for judging fit. Categories: requirement, judgement.
- EARN EVERY LINK. An achievement, an event, a number, and a quality are four separate items unless this material says one produced another. Never write "the internship led to the thesis", "because of that season she built…", or "his research made him a leader" on your own reading: where the source keeps two facts apart, file them apart, and let the drafter make the connection only if the applicant's own words support it. The same holds for a person's motive — do not supply a reason the text never states.
Keep it compact: a section with nothing specific to teach is left out. Return JSON only: {"sections": [...]}`;
}

const ESSAY_KIND_WORDS = {
  why_us: /why (us|this|our|here)|why [a-z .]+(university|college|school)/i,
  why_major: /why .{0,20}(major|field|subject|course|programme|program)/i,
  community: /community|roommate|belong|neighbo/i,
  challenge: /challenge|setback|failure|obstacle|disagree/i,
  activity: /activit|extracurricular|leadership/i,
  identity: /identity|background|heritage|culture|perspective/i,
  intellectual: /intellectual|curio|idea|topic/i,
  talent: /talent|skill/i,
  goals: /future|career|goal|aspir/i,
  contribution: /contribut|unique|bring/i,
  explain: /additional|explain|circumstance/i,
  gratitude: /grateful|gratitude|thank/i,
  micro: /short answer|micro/i,
  personal_statement: /personal statement|common app essay|main essay/i,
};

/** The essay kinds an applicant's own essay answers, for matching dissected sections. */
export function essayKindsFor(essay) {
  if (!essay) return [];
  const kinds = new Set();
  if (essay.type === 'personal_statement') kinds.add('personal_statement');
  if (essay.type === 'activity') kinds.add('activity');
  if (essay.type === 'why_this_school') kinds.add('why_us');
  if (essay.type === 'other') kinds.add('other');
  for (const shape of detectSupplementShapes({ prompt: essay.prompt || '', limit: Number(essay.word_limit) || 0, unit: limitUnitFor(essay) })) {
    kinds.add(shape.key);
  }
  for (const [kind, pattern] of Object.entries(ESSAY_KIND_WORDS)) {
    if (pattern.test(String(essay.title || ''))) kinds.add(kind);
  }
  return [...kinds];
}

/**
 * Where a dissected section belongs in the applicant's own list.
 *
 * A school named in the material is matched to a saved university by name; an
 * essay kind is matched to that university's essays (or to the shared essays
 * when the kind is a personal statement). A section for a school the applicant
 * is not applying to keeps its essay kind only, so its craft still reaches the
 * right KIND of essay without ever being bound to the wrong school.
 */
export function dissectionTargets(section, { universities = [], essays = [] } = {}) {
  const school = clean(section?.school);
  const kind = ESSAY_KINDS.includes(String(section?.essay_kind || '').toLowerCase()) ? String(section.essay_kind).toLowerCase() : 'other';
  const platformRaw = String(section?.platform || '').toLowerCase().trim();
  const platform = PLATFORMS[platformRaw] ? platformRaw : '';
  const university = school ? universities.find((u) => universityNamesMatch(u.name, school)) || null : null;
  const candidates = essays.filter((essay) => {
    if (kind === 'personal_statement') return essay.scope === 'common' || (!essay.scope && !essay.university_id);
    if (!university) return false;
    return String(essay.university_id || '') === String(university.id);
  });
  const essay = kind !== 'activities_list' && kind !== 'other'
    ? candidates.find((item) => essayKindsFor(item).includes(kind)) || null
    : null;
  return {
    target_university_id: university ? String(university.id) : null,
    target_essay_id: essay ? String(essay.id) : null,
    target_platform: !university && !essay && platform ? platform : null,
    target_task: kind === 'activities_list' ? 'activity' : null,
    shape_keys: kind === 'other' ? [] : [kind],
    school,
    kind,
  };
}

const AUDIENCE_KIND = { sample: 'pattern', own: 'evidence', guide: 'guidance', school: 'guidance' };

/**
 * Reads one material and writes its sections as targeted rows.
 *
 * Rows from an earlier dissection of the same material are removed only after
 * the new ones exist. A material with nothing to file produces no rows, and a
 * failed model call changes nothing.
 *
 * @returns {Promise<{ sections: number, rows: number, warnings: string[] }>}
 */
export async function dissectMaterialKnowledge({
  material, existingRows = [], universities = [], essays = [], runAI, isLive, createRows, deleteRow,
  model = null, now = () => new Date().toISOString(),
}) {
  const presented = presentMaterial(material);
  if (!canDissectMaterial(presented)) return { sections: 0, rows: 0, warnings: [] };
  const text = dissectionText(presented);
  const outcome = await runAI({
    prompt: buildDissectionPrompt({ material: presented, text, universities, essays }),
    response_json_schema: DISSECTION_SCHEMA,
  }, { quiet: true, fallbackTitle: `Could not dissect “${presented.title || 'material'}”` });
  if (!isLive(outcome)) throw outcome?.error || new Error('The AI did not return anything for this material.');

  const key = materialDissectionKey(presented);
  const stamp = { dissected: true, dissection_key: key, source_key: key, built_at: now(), model: model || null, fingerprint: null };
  const sections = (Array.isArray(outcome.result?.sections) ? outcome.result.sections : []).slice(0, 8);
  const fresh = [];
  const region = presented.target_platform ? platformRegion(presented.target_platform) : null;
  for (const section of sections) {
    const audience = ['sample', 'own', 'guide', 'school'].includes(String(section?.audience || '')) ? section.audience : (isSampleMaterial(presented) ? 'sample' : isGuidanceMaterial(presented) ? 'guide' : 'own');
    const rowKind = AUDIENCE_KIND[audience];
    const targets = dissectionTargets(section, { universities, essays });
    // The applicant's own life is one independent value: an insight drawn from
    // their writing or story belongs to EVERY application, so a school named in
    // the prose or in the source's own scope must never turn it into
    // school-specific knowledge. A guide or a school-reference section keeps its
    // binding — those are written for one school.
    const ownLife = audience === 'own';
    const ownUniversity = ownLife ? null : targets.target_university_id;
    const ownEssay = ownLife ? null : targets.target_essay_id;
    // The section keeps the name the material gave it. Sharing an item across
    // every application is a fact about its SCOPE, which the row carries by
    // having no targets at all; overwriting its name would throw away which part
    // of the applicant's writing the item came out of, and that context is what
    // lets a drafter use it correctly instead of pasting it anywhere.
    const label = clean(section?.section)
      || (ownLife ? 'Personal evidence — all applications'
        : (targets.school ? `${targets.school} — ${targets.kind}` : targets.kind));
    // An "own" section may teach the portrait OR the evidence list, so its items
    // are validated against BOTH category tables — otherwise a personality or
    // mindset item is silently downgraded to a fact here and never reaches the
    // portrait it was extracted for.
    const valid = audience === 'own'
      ? { ...ABOUT_CATEGORIES, ...POINT_CATEGORIES }
      : CATEGORIES_BY_KIND[rowKind];
    const fallback = rowKind === 'pattern' ? 'judgement' : rowKind === 'guidance' ? (audience === 'school' ? 'requirement' : 'writing_principle') : 'experience';
    for (const item of itemsWithProvenance(section?.items, valid, fallback, 4)) {
      const own = audience === 'own' && ABOUT_CATEGORIES[item.category];
      fresh.push({
        kind: own ? 'brief' : rowKind,
        category: item.category,
        text: item.text,
        origin: 'ai',
        source_label: `${presented.title || 'Material'} · ${label}`,
        source_id: String(presented.id),
        platform: rowKind === 'pattern'
          ? (targets.target_platform ? platformRegion(targets.target_platform) : region || 'General')
          : 'General',
        sort_order: fresh.length,
        target_university_id: ownLife ? null : (presented.target_university_id || ownUniversity),
        target_essay_id: ownLife ? null : (presented.target_essay_id || ownEssay),
        target_platform: ownLife ? null : (presented.target_platform || targets.target_platform),
        target_task: ownLife ? null : (presented.target_task || targets.target_task),
        data: {
          ...stamp,
          previous_sections: [],
          section: label,
          school: ownLife ? '' : targets.school,
          shape_keys: ownLife ? [] : targets.shape_keys,
          audience,
          // `shared` is what the row's emptiness means, stated once so a later
          // pass can tell an intentionally shared item from a forgotten target.
          ...(ownLife ? { shared: true } : {}),
          ...(item.evidence ? { evidence: item.evidence } : {}),
        },
      });
    }
  }
  const warnings = [];
  if (!fresh.length) return { sections: 0, rows: 0, warnings: ['No usable sections returned; existing sections were kept.'] };
  // Keep a recoverable record of the previous AI extraction in replacement
  // metadata. User-edited rows stay live, and original materials never change.
  const previous = existingRows.filter((row) => row.origin === 'ai' && row.data?.dissected
    && String(row.source_id || '') === String(presented.id));
  fresh[0].data.previous_sections = previous.map(({ id, text, category, kind, source_label, data }) => ({
    id, text, category, kind, source_label,
    data: { ...data, previous_sections: undefined },
  }));
  const created = await createRows(fresh);
  if (!Array.isArray(created) || created.length !== fresh.length) {
    throw new Error('Replacement sections were not fully confirmed. Existing sections were kept.');
  }
  const old = (existingRows || []).filter((row) => row.origin === 'ai' && row?.data?.dissected && String(row.source_id || '') === String(presented.id));
  for (const row of old) {
    try {
      await deleteRow(row.id);
    } catch {
      warnings.push(`An older section from “${presented.title || 'this material'}” could not be removed.`);
    }
  }
  return { sections: sections.length, rows: fresh.length, warnings };
}

/**
 * How well the saved portrait covers the sources, per category.
 *
 * The applicant asked for the thin list to be impossible to miss: "1 personality,
 * 4 facts" against 40 documents is a report on the build, not a finished
 * feature. This returns the numbers the page needs to say so.
 */
export function knowledgeCoverage(rows, inputs) {
  const saved = (rows || []).filter((row) => String(row.text || '').trim());
  const counts = inputs?.counts || {};
  const limits = knowledgeLimitsFor(counts);
  const byKind = (kind) => saved.filter((row) => row.kind === kind);
  const perCategory = (list, table) => Object.keys(table).reduce((out, key) => {
    out[key] = list.filter((row) => row.category === key).length;
    return out;
  }, {});
  const brief = byKind('brief');
  const evidence = byKind('evidence');
  const patterns = byKind('pattern');
  const guidance = byKind('guidance');
  const thin = [
    limits.about.min > 0 && brief.length < limits.about.min ? 'About you' : '',
    limits.points.min > 0 && evidence.length < limits.points.min ? 'Personal points' : '',
    limits.patterns.min > 0 && (counts.samples || 0) > 0 && patterns.length < limits.patterns.min ? 'Patterns' : '',
    limits.guidance.min > 0 && (counts.guidance || 0) > 0 && guidance.length < limits.guidance.min ? 'Guidance' : '',
  ].filter(Boolean);
  const cutOff = saved.filter((row) => itemLooksCutOff(row.text)).length;
  return {
    limits,
    thin,
    cutOff,
    sources: (counts.materials || 0) + (counts.samples || 0) + (counts.guidance || 0) + (counts.essays || 0),
    about: perCategory(brief, ABOUT_CATEGORIES),
    points: perCategory(evidence, POINT_CATEGORIES),
    patterns: perCategory(patterns, PATTERN_CATEGORIES),
    guidance: perCategory(guidance, GUIDANCE_CATEGORIES),
    totals: { brief: brief.length, evidence: evidence.length, pattern: patterns.length, guidance: guidance.length },
  };
}

// ---------------------------------------------------------------------------
// What drafting, review, and the holistic review read
// ---------------------------------------------------------------------------
/** The saved item's own scope, as the model sees it. '' when it is general. */
function targetLabel(row, options) {
  const label = contextTargetLabel(row, options);
  const scope = label === 'All applications and tasks' ? '' : label;
  // A section filed from a material names itself ("Stanford — roommate essay"),
  // so the drafter knows which part of which document it is reading.
  const section = row?.data?.dissected ? clean(row.data.section) : '';
  const parts = [scope, section && section !== scope ? section : ''].filter(Boolean);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

/**
 * How a knowledge item that came from the applicant's Q&A answers reads in a
 * prompt. An answer is reference material the applicant volunteered — Atlas may
 * use it wherever it strengthens the piece and omit it wherever it does not. An
 * answer the applicant marked "must include" is the one exception: that is an
 * instruction, and instructions are obeyed.
 */
function qaNote(row) {
  if (!row?.data?.from_qa) return '';
  return row.data.include
    ? ' [APPLICANT INSTRUCTION — the applicant directed Atlas to use this in the application; honour it wherever the prompt allows]'
    : ' [the applicant\'s own answer to a question — reference, never an obligation: use it where it strengthens this piece, leave it out where it does not]';
}

/**
 * How specific a saved item is to the job being asked.
 *
 * One portrait is shared by every school, so an item written for Stanford's
 * roommate question has to be fetched before the general ones, and an item for
 * a different school must never appear at all. Higher rank means it is shown
 * first and is the last thing dropped when the prompt budget is tight.
 */
function specificityRank(row, { universityId = '', essayId = '', shapeKeys = [] } = {}) {
  const essayTarget = String(row?.target_essay_id || '');
  const universityTarget = String(row?.target_university_id || '');
  const shapes = rowShapeKeys(row);
  if (essayId && essayTarget && essayTarget === String(essayId)) return 5;
  if (universityId && universityTarget && universityTarget === String(universityId)) return 4;
  // Filed under this KIND of essay (a roommate essay, a why-us) by a dissection,
  // for any school: the craft transfers, so it outranks the general items.
  if (shapes.length && shapeKeys.some((key) => shapes.includes(key))) return 3;
  // Bound to a platform or a task: relevant, but not to this particular school.
  if (String(row?.target_platform || '') || String(row?.target_task || '')) return 2;
  if (universityTarget || essayTarget) return 0;
  return 1;
}

/** The essay kinds a dissected row was filed under; [] for ordinary rows. */
function rowShapeKeys(row) {
  if (row.kind === 'brief' || row.kind === 'evidence') return [];
  const keys = row?.data?.shape_keys;
  return Array.isArray(keys) ? keys.map((key) => String(key)) : [];
}

/**
 * Whether a row filed under an essay kind belongs in this prompt.
 *
 * A row the dissection filed under "community" (a roommate essay) must not be
 * read while drafting a why-major essay even though both are general-scope
 * rows. Rows without shape keys are unaffected, and when the job is not an
 * essay at all (no essay, no shapes) shaped rows stay out unless they are
 * bound to this very school or essay.
 */
function shapeAllows(row, { shapeKeys = [], universityId = '', essayId = '' } = {}) {
  const shapes = rowShapeKeys(row);
  if (!shapes.length) return true;
  if (essayId && String(row?.target_essay_id || '') === String(essayId)) return true;
  if (universityId && String(row?.target_university_id || '') === String(universityId)) return true;
  // A job that is not writing one particular essay (the full application review,
  // an activity list) has no shape of its own to match. A section lifted out of
  // one material still belongs to that material's part, so it stays out; a craft
  // rule or a guidance item from the general build is the reader's whole-file
  // knowledge and is kept.
  if (!shapeKeys.length) return !row?.data?.dissected;
  return shapeKeys.some((key) => shapes.includes(key));
}

/**
 * How a saved item's own wording from the source reads in a prompt.
 *
 * The quotation is what turns a summary back into the applicant's voice: a
 * drafter can lift the phrase, and the applicant can see exactly what the item
 * was built on. It is clipped at a sentence boundary like everything else, and an
 * item with no evidence costs the prompt nothing.
 */
function evidenceNote(row) {
  const evidence = clean(row?.data?.evidence);
  if (!evidence) return '';
  return ` → in the applicant's own words: ${evidence.startsWith('“') || evidence.startsWith('"') ? evidence : `“${evidence}”`}`;
}

/**
 * The knowledge base as text for a prompt. Patterns are filtered to the
 * platform's region, plus General ones.
 *
 * Two rules the earlier version broke. Items are packed whole, in order of how
 * specifically they target this essay, and an item that does not fit is left out
 * and counted — it is never cut mid-sentence, because the drafter cannot use a
 * fact that stops at "someone who de" and the applicant cannot see that anything
 * is missing.
 */
export function applicantKnowledgeForPrompt(rows, {
  platform = '', universityId = '', essayId = '', essayIds = [], task = '',
  universities = [], essays = [], maxChars = 24000, essay = null,
} = {}) {
  // The kinds of essay being written, so sections a dissection filed under
  // "roommate essay" reach the roommate essay and nothing else.
  const current = essay || (essayId ? (essays || []).find((item) => String(item?.id) === String(essayId)) : null);
  const shapeKeys = current ? essayKindsFor(current) : task === 'activity' ? ['activities_list', 'activity'] : [];
  const scope = { universityId, essayId, shapeKeys };
  // The applicant's own life is one shared value, so an AI portrait or evidence
  // row belongs to every application — including a legacy row that an older
  // filing bound to the school named in its source text. A scope the applicant
  // set by hand on a manual row is an explicit choice and is never overridden.
  const sharedRows = (rows || []).map((row) => row.origin === 'ai' && ['brief', 'evidence'].includes(row.kind)
    ? { ...row, target_university_id: null, target_essay_id: null, target_platform: null, target_task: null } : row);
  const usable = filterByContextTarget(sharedRows, { universityId, essayId, essayIds, platform, task })
    .filter((r) => String(r.text || '').trim())
    .filter((row) => shapeAllows(row, scope))
    .map((row) => ({ row, rank: specificityRank(row, scope) }))
    // Most specific first; the database order breaks ties, so two runs match.
    .sort((a, b) => b.rank - a.rank);
  if (!usable.length) return '';
  const region = platform ? platformRegion(platform) : '';
  const pick = (...kinds) => usable.filter(({ row }) => kinds.includes(row.kind));
  const about = pick('brief');
  const points = pick('evidence');
  const patterns = usable.filter(({ row }) => row.kind === 'pattern'
    && (!region || row.platform === 'General' || row.platform === region));
  const guidance = pick('guidance');

  // The headings and the closing "did not fit" line are part of what this function
  // returns, so they are paid for out of `maxChars` too: a caller that asked for
  // 24,000 characters gets 24,000 characters of prompt, not 24,000 plus framing.
  const headingChars = 4 * 130;
  const noteReserve = maxChars > KNOWLEDGE_NOTE_CHARS * 3 ? KNOWLEDGE_NOTE_CHARS : 0;
  const limit = Math.max(0, maxChars - headingChars - noteReserve);
  // Share the budget across the four sections in the order a writer needs them:
  // who the applicant is, then what they have done, then craft, then rules.
  const share = (weight) => Math.max(0, Math.round(limit * weight));
  const groups = [
    {
      heading: 'ABOUT THE APPLICANT (AI-built and applicant-edited; consistent with the profile and materials):',
      items: about,
      budget: share(0.3),
      render: ({ row }) => `- [${ABOUT_CATEGORIES[row.category] || 'About'}]${targetLabel(row, { universities, essays })} ${row.text}${evidenceNote(row)}${qaNote(row)}`,
    },
    {
      heading: 'PERSONAL POINTS (facts the applicant can use. Use these, and never add experiences beyond them):',
      items: points,
      budget: share(0.34),
      render: ({ row }) => `- [${POINT_CATEGORIES[row.category] || 'Fact'}]${targetLabel(row, { universities, essays })} ${row.text}${evidenceNote(row)}${row.source_label ? ` (source: ${row.source_label})` : ''}${qaNote(row)}`,
    },
    {
      heading: 'SUCCESSFUL-APPLICATION PATTERNS (apply the technique to this applicant’s own life; never copy a sample’s life):',
      items: patterns,
      budget: share(0.18),
      render: ({ row }) => `- [${row.platform || 'General'} · ${PATTERN_CATEGORIES[row.category] || 'Judgement'}]${targetLabel(row, { universities, essays })} ${row.text}`,
    },
    {
      heading: 'TIPS AND APPLICATION GUIDANCE (rules and constraints, not facts about the applicant):',
      items: guidance,
      budget: share(0.18),
      render: ({ row }) => `- [${GUIDANCE_CATEGORIES[row.category] || 'Guidance'}]${targetLabel(row, { universities, essays })} ${row.text}`,
    },
  ];

  const lines = [];
  let omitted = 0;
  let used = groups.reduce((sum, group) => sum + (group.items.length ? group.heading.length + 2 : 0), 0);
  for (const group of groups) {
    if (!group.items.length) continue;
    const room = Math.max(0, limit - used);
    // Less than a sentence of room left: this section waits, and the closing
    // line says so. A half-line of context is worth nothing to the model.
    if (room < MIN_KNOWLEDGE_LINE_CHARS) { omitted += group.items.length; continue; }
    const budget = Math.min(group.budget, room);
    const rendered = group.items.map((item) => ({ item, text: group.render(item) }));
    const packed = packBlocks(rendered, budget, (block) => block.text.length + 1);
    // `packBlocks` always keeps its first block whole. When even that will not
    // fit what is left of the prompt, clip it at a sentence boundary: a section
    // the writer cannot skip is exactly the section that must not be allowed to
    // push the request over its size, and a complete sentence is what survives.
    const head = packed.kept[0];
    if (head && head.text.length > room) {
      packed.kept[0] = { ...head, text: clipToBoundary(head.text, room, { marker: null }) };
    }
    if (!packed.kept.length) { omitted += group.items.length; continue; }
    used += packed.kept.reduce((sum, block) => sum + block.text.length + 1, 0);
    omitted += packed.omitted.length;
    lines.push(group.heading);
    packed.kept.forEach((block) => lines.push(block.text));
    lines.push('');
  }
  const text = lines.join('\n').trim();
  if (!text) return '';
  if (omitted > 0) {
    return `${text}\n\n[${omitted} further knowledge item${omitted === 1 ? ' is' : 's are'} saved but did not fit this prompt; they are complete in the AI Knowledge Base page, and nothing above was shortened to make room.]`;
  }
  return text;
}

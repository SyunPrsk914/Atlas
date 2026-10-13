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

import { buildProfileContext } from './profileContext';
import {
  formatOwnMaterials, formatGuidanceMaterials, formatSampleMaterials, isGuidanceMaterial, isSampleMaterial, presentMaterial,
} from './materialRole';
import { sourceKey } from './materialDocument';
import { contextTargetLabel, filterByContextTarget } from './contextTargeting';
import { clipToBoundary, packBlocks } from './textClip';

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
        },
      },
    },
  },
};

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
        properties: { category: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
};

export function buildAboutAndPointsPrompt({ profileText, ownText, essayText, limits = null }) {
  const cap = limits || knowledgeLimitsFor({ materials: 1, essays: 1, profile: 1 });
  return `You are building a private, editable, evidence-grounded portrait of one college applicant. Essay drafting and holistic review will use it, so depth and accuracy matter more than flattering slogans.

WHAT "DEEP" MEANS HERE
A literal inventory ("did physics IA on aerodynamics; joined three clubs") is worthless to a drafter — it already has those words. The portrait has to say what the choices imply: why this question rather than another, what the applicant returns to, what they do when the plan fails, how they treat other people's time, what they notice. Read a document the way a literature teacher reads it: the selection, the ordering, the omissions, and the emotional distance are all information.

RULES FOR A NON-SHALLOW READ
- Use only what the profile and own material state or strongly support. Never invent an experience, number, relationship, result, diagnosis, or motive. When an interpretation is uncertain, label it as "suggests", "may indicate", or "the materials do not establish".
- Read across documents, not just within one paragraph. Look for repeated choices, what the applicant notices, what they spend time on, how they respond when a plan fails, the kinds of questions they ask, how they work with people, and the tension between what they say and what they do.
- ABOUT YOU is not a collection of one-line compliments. Each item is a dense, specific paragraph of 3-5 sentences (60-140 words): the interpretation first, then the evidence in the applicant's own terms, then why that pattern matters for an application. A one-line item is a failed item.
- Cover every category the sources can support — "personality" (how they come across), "actions" (what they repeatedly do), "mindset" (how they think, learn, handle uncertainty, and treat others), "goals" (what they are moving towards). Do not return one item for the whole set when ${cap.about.min}+ are supported: aim for at least ${Math.max(2, Math.ceil(cap.about.min / 4))} in each category the evidence reaches.
- PERSONAL POINTS are separate and concrete: achievements with numbers, roles, places, dates, outcomes, responsibilities, and values shown in actions. Each point is self-contained and specific: carry the names, numbers, dates, places, roles, and outcomes exactly as the source states them, so a drafter can use the point without ever seeing the source — a point that says only "worked on a project" is a failed point. Do not repeat an About item as a fact. Each point needs a source_label naming the material or profile section it came from. Aim for ${cap.points.min}+ points; every material listed below should contribute at least one, or you must say in a point that it holds nothing usable.
- Academic work and internal assessments are not college essays. Do not rate their prose or give sentence-level writing advice; use them to understand intellectual curiosity, method, standards, persistence, and the applicant's approach to evidence.
- A past essay can provide both concrete events and a voice pattern, but a claim in an AI draft is not confirmed unless the profile or own materials support it. Do not use sample essays, tips, guides, or college references as evidence about the applicant.
- Do not judge the applicant's chances and do not compare them with other people.
- Write in complete sentences and finish every one of them. Never stop mid-word, never write "someone who de", never leave a clause hanging: an item that is cut off is worse than no item, because the drafter will quote from it.
- Return at most ${cap.about.max} ABOUT YOU items and ${cap.points.max} personal points. Density means substance per item, not padding: two 120-word items beat eight one-liners.

STUDENT PROFILE (form data)
${profileText || '(no profile saved)'}

OWN MATERIALS (written or supplied by the applicant; each has its own analysis lens)
${ownText || '(none added)'}

ESSAY DRAFTS (may include AI-written drafts that the applicant edited. Use them only as corroborated evidence of voice or experience.)
${essayText || '(none)'}

Return JSON only: {"about": [{"category": "personality|actions|mindset|goals", "text": "3-5 dense sentences"}], "points": [{"category": "achievement|experience|value|fact", "text": "...", "source_label": "..."}]}`;
}

export function buildPatternsPrompt({ sampleText, limits = null }) {
  const cap = limits || knowledgeLimitsFor({ samples: 1 });
  return `You are studying successful college application essays that the applicant chose as models. They were written by other people. They are not the applicant's life.

Read them comparatively and critically. Explain not only what the samples do, but why the choice works on a reader: what is withheld, where the emotional or intellectual turn happens, how evidence earns trust, how diction controls distance, and what a weaker imitation would get wrong. Convert those observations into general rules that can be applied to a completely different life. Never copy a person, place, event, grade, or sentence from a sample.

Be critical of the samples too. A successful essay is not automatically a good one, and a rule like "successful essays open with a scene" is useless to a drafter. Say which move works for which reader, where the sample is weak or risky to imitate, and what a reader with 40 files in front of them would actually remember.

PLATFORM: each sample's label may say [US] or [UK]. Tag a pattern "US" or "UK" when the rule depends on that system, and "General" otherwise. Never apply UK structure (three fixed questions sharing 4,000 characters) to a US essay, or US structure to a UK answer.

Categories: opening, structure, evidence, reflection, voice, length, judgement.
Each pattern is one dense, usable rule of 2-4 sentences: the technique, the reason it works on a reader, and the failure mode it prevents. Aim for at least ${Math.max(1, cap.patterns.min)} patterns across every sample you were given, and at most ${cap.patterns.max}. A sample that produced no pattern should be named in one pattern about what it does badly.

SAMPLE ESSAYS (craft only)
${sampleText}

Return JSON only: {"patterns": [{"category": "...", "platform": "US|UK|General", "text": "a critical, reusable rule"}]}`;
}

export function buildGuidancePrompt({ guidanceText, limits = null }) {
  const cap = limits || knowledgeLimitsFor({ guidance: 1 });
  return `You are extracting a separate guidance layer from tips, writing guides, college requirements, and application reference documents. These sources are not the applicant's biography and their examples, statistics, and advice must never become facts about the applicant.

Read for the underlying decision rules: what the reader is looking for, what a writer should do or avoid, how to choose evidence, structural constraints, deadlines or requirements, and where common advice becomes misleading. Preserve useful nuance and conflicts between sources instead of flattening everything into slogans. Each item should state the rule, the source it came from in substance, and the practical implication for drafting or review — 2-4 sentences, complete and finished.

Write every rule so a drafter can obey it without reading the original document: "in a 50-word box, answer in the first sentence and spend the rest on one detail" is a rule; "be concise" is not. Where two sources disagree, record both and say which is more specific.

Categories: writing_principle, application_rule, requirement, warning, process.
Aim for at least ${Math.max(1, cap.guidance.min)} items and at most ${cap.guidance.max}. Keep source-specific constraints in the item rather than presenting them as universal, and note which essay type or platform each rule governs.

GUIDANCE AND REFERENCE SOURCES
${guidanceText || '(none)'}

Return JSON only: {"guidance": [{"category": "...", "text": "a precise rule with its implication"}]}`;
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
    points: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' }, source_label: { type: 'string' } } } },
    patterns: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, platform: { type: 'string' }, text: { type: 'string' } } } },
    guidance: { type: 'array', items: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' } } } },
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

export function normalizeAboutAndPoints(raw, limits = null) {
  return {
    about: cleanItems(raw?.about, ABOUT_CATEGORIES, 'personality', capOf(limits, 'about', KNOWLEDGE_BASE_LIMITS.about)),
    points: cleanItems(raw?.points, POINT_CATEGORIES, 'fact', capOf(limits, 'points', KNOWLEDGE_BASE_LIMITS.points), (item) => ({
      // A source label is a label, not an essay: keep it in full rather than
      // cutting it at an arbitrary character count.
      source_label: clean(item?.source_label) || 'Profile or materials',
    })),
  };
}

export function normalizePatterns(raw, limits = null) {
  return cleanItems(raw?.patterns, PATTERN_CATEGORIES, 'judgement', capOf(limits, 'patterns', KNOWLEDGE_BASE_LIMITS.patterns), (item) => {
    const platform = String(item?.platform || '').trim();
    const match = Object.keys(PATTERN_PLATFORMS).find((p) => p.toLowerCase() === platform.toLowerCase());
    return { platform: match || 'General' };
  });
}

export function normalizeGuidance(raw, limits = null) {
  return cleanItems(raw?.guidance, GUIDANCE_CATEGORIES, 'writing_principle', capOf(limits, 'guidance', KNOWLEDGE_BASE_LIMITS.guidance));
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
/** Database rows for a rebuild. Every AI row carries the fingerprint of the inputs it came from. */
export function knowledgeRowsFor({ about = [], points = [], patterns = [], guidance = [] }, { fingerprint, builtAt, model }) {
  const data = { fingerprint, built_at: builtAt, model: model || null };
  return [
    ...about.map((item, i) => ({
      kind: 'brief', category: item.category, text: item.text, origin: 'ai',
      source_label: 'Built from your profile and materials', source_id: '', platform: 'General',
      sort_order: i, data,
    })),
    ...points.map((item, i) => ({
      kind: 'evidence', category: item.category, text: item.text, origin: 'ai',
      source_label: item.source_label, source_id: '', platform: 'General',
      sort_order: i, data,
    })),
    ...patterns.map((item, i) => ({
      kind: 'pattern', category: item.category, text: item.text, origin: 'ai',
      source_label: 'From sample essays you chose', source_id: '', platform: item.platform || 'General',
      sort_order: i, data,
    })),
    ...guidance.map((item, i) => ({
      kind: 'guidance', category: item.category, text: item.text, origin: 'ai',
      source_label: 'From tips, guides, and application references', source_id: '', platform: 'General',
      sort_order: i, data,
    })),
  ];
}

/**
 * How current the AI items are: whether they were built, when, and whether the
 * profile, materials, or drafts have changed since.
 */
export function knowledgeStatus(rows, currentFingerprint) {
  const aiRows = (rows || []).filter((r) => r.origin === 'ai');
  const stamps = aiRows.map((row) => row.data).filter((data) => data?.fingerprint);
  const latestStamp = stamps.sort((a, b) => String(b.built_at || '').localeCompare(String(a.built_at || '')))[0] || null;
  return {
    built: aiRows.length > 0,
    builtAt: latestStamp?.built_at || null,
    stale: aiRows.length > 0 && stamps.some((data) => data.fingerprint !== currentFingerprint),
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

  const stale = existingRows.filter((row) => row.origin === 'ai' && replacing.has(row.kind));
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
function nearDuplicate(text, seenList) {
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

const wordSet = (text) => new Set(String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 4));

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
    return {
      category,
      text,
      source_label: String(item?.source_label ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      platform: String(item?.platform ?? '').replace(/\s+/g, ' ').trim(),
    };
  }).filter(Boolean).slice(0, limit);
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

  const result = outcome.result || {};
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
      fresh.push({
        kind,
        category: item.category,
        text: item.text,
        origin: 'ai',
        source_label: item.source_label || '',
        source_id: '',
        platform: item.platform || 'General',
        sort_order: countOf(kind) + fresh.filter((row) => row.kind === kind).length,
        data: { fingerprint: inputs.fingerprint, built_at: now(), model: model || null, appended: true },
      });
    }
  };
  add(result.about, 'brief', ABOUT_CATEGORIES, 'personality', 'about');
  add(
    (Array.isArray(result.points) ? result.points : []).map((item) => ({ ...item, source_label: clean(item?.source_label) || 'Profile or materials' })),
    'evidence', POINT_CATEGORIES, 'fact', 'points',
  );
  const patternItems = (Array.isArray(result.patterns) ? result.patterns : []).map((item) => {
    const match = Object.keys(PATTERN_PLATFORMS).find((p) => p.toLowerCase() === String(item?.platform || '').trim().toLowerCase());
    return { ...item, platform: match || 'General' };
  });
  add(patternItems, 'pattern', PATTERN_CATEGORIES, 'judgement', 'patterns');
  add(result.guidance, 'guidance', GUIDANCE_CATEGORIES, 'writing_principle', 'guidance');

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
  return label === 'All applications and tasks' ? '' : ` · ${label}`;
}

/**
 * How specific a saved item is to the job being asked.
 *
 * One portrait is shared by every school, so an item written for Stanford's
 * roommate question has to be fetched before the general ones, and an item for
 * a different school must never appear at all. Higher rank means it is shown
 * first and is the last thing dropped when the prompt budget is tight.
 */
function specificityRank(row, { universityId = '', essayId = '' } = {}) {
  const essayTarget = String(row?.target_essay_id || '');
  const universityTarget = String(row?.target_university_id || '');
  if (essayId && essayTarget && essayTarget === String(essayId)) return 4;
  if (universityId && universityTarget && universityTarget === String(universityId)) return 3;
  // Bound to a platform or a task: relevant, but not to this particular school.
  if (String(row?.target_platform || '') || String(row?.target_task || '')) return 2;
  if (universityTarget || essayTarget) return 0;
  return 1;
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
  universities = [], essays = [], maxChars = 24000,
} = {}) {
  const usable = filterByContextTarget(rows, { universityId, essayId, essayIds, platform, task })
    .filter((r) => String(r.text || '').trim())
    .map((row) => ({ row, rank: specificityRank(row, { universityId, essayId }) }))
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
      render: ({ row }) => `- [${ABOUT_CATEGORIES[row.category] || 'About'}]${targetLabel(row, { universities, essays })} ${row.text}`,
    },
    {
      heading: 'PERSONAL POINTS (facts the applicant can use. Use these, and never add experiences beyond them):',
      items: points,
      budget: share(0.34),
      render: ({ row }) => `- [${POINT_CATEGORIES[row.category] || 'Fact'}]${targetLabel(row, { universities, essays })} ${row.text}${row.source_label ? ` (source: ${row.source_label})` : ''}`,
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
    return `${text}\n\n[${omitted} further knowledge item${omitted === 1 ? '' : 's'} are saved but did not fit this prompt; they are complete in the AI Knowledge Base page, and nothing above was shortened to make room.]`;
  }
  return text;
}

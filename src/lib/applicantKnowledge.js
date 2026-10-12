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

const LIMITS = { about: 14, points: 35, patterns: 20, guidance: 25 };
const PROMPT_BUDGET = { profile: 10000, own: 30000, essays: 14000, samples: 14000, guidance: 14000 };

const clean = (value, max = Infinity) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Region a platform's samples belong to. */
export function platformRegion(platform) {
  return platform === 'ucas' ? 'UK' : 'US';
}

function clip(text, max) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n[… ${(value.length - max).toLocaleString()} more characters left out to fit the AI's context window.]`;
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
  const ownText = formatOwnMaterials(globalMaterials, { totalChars: PROMPT_BUDGET.own }).join('\n\n');
  const guidanceText = formatGuidanceMaterials(globalMaterials, { totalChars: PROMPT_BUDGET.guidance }).join('\n\n');
  const sampleText = formatSampleMaterials(globalMaterials, { totalChars: PROMPT_BUDGET.samples }).join('\n\n');
  const essayText = globalEssays
    .filter((essay) => String(essay.content || '').trim())
    .map((essay) => `--- Draft: ${essay.title || essay.university_name || 'Untitled'} (${essay.type || 'essay'}) ---\n${clip(essay.content, 3000)}`)
    .join('\n\n');
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
    ownText: clip(ownText, PROMPT_BUDGET.own),
    guidanceText: clip(guidanceText, PROMPT_BUDGET.guidance),
    essayText: clip(essayText, PROMPT_BUDGET.essays),
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

export function buildAboutAndPointsPrompt({ profileText, ownText, essayText }) {
  return `You are building a private, editable, evidence-grounded portrait of one college applicant. Essay drafting and holistic review will use it, so depth and accuracy matter more than flattering slogans.

RULES FOR A NON-SHALLOW READ
- Use only what the profile and own material state or strongly support. Never invent an experience, number, relationship, result, diagnosis, or motive. When an interpretation is uncertain, label it as "suggests", "may indicate", or "the materials do not establish".
- Read across documents, not just within one paragraph. Look for repeated choices, what the applicant notices, what they spend time on, how they respond when a plan fails, the kinds of questions they ask, how they work with people, and the tension between what they say and what they do.
- ABOUT YOU is not a collection of one-line compliments. Each item should be a dense, specific paragraph of 2–4 sentences: interpretation first, then the evidence and why that pattern matters. Categories: "personality" (how they come across), "actions" (what they repeatedly do), "mindset" (how they think, learn, handle uncertainty, and treat others), "goals" (what they are moving towards).
- PERSONAL POINTS are separate and concrete: achievements with numbers, roles, places, dates, outcomes, responsibilities, and values shown in actions. Do not repeat an About item as a fact. Each point needs a source_label naming the material or profile section it came from.
- Academic work and internal assessments are not college essays. Do not rate their prose or give sentence-level writing advice; use them to understand intellectual curiosity, method, standards, persistence, and the applicant's approach to evidence.
- A past essay can provide both concrete events and a voice pattern, but a claim in an AI draft is not confirmed unless the profile or own materials support it. Do not use sample essays, tips, guides, or college references as evidence about the applicant.
- Do not judge the applicant's chances and do not compare them with other people.
- Return at most ${LIMITS.about} ABOUT YOU items and ${LIMITS.points} personal points. Prefer fewer well-supported, dense items to padded generalities.

STUDENT PROFILE (form data)
${profileText || '(no profile saved)'}

OWN MATERIALS (written or supplied by the applicant; each has its own analysis lens)
${ownText || '(none added)'}

ESSAY DRAFTS (may include AI-written drafts that the applicant edited. Use them only as corroborated evidence of voice or experience.)
${essayText || '(none)'}

Return JSON only: {"about": [{"category": "personality|actions|mindset|goals", "text": "2–4 dense sentences"}], "points": [{"category": "achievement|experience|value|fact", "text": "...", "source_label": "..."}]}`;
}

export function buildPatternsPrompt({ sampleText }) {
  return `You are studying successful college application essays that the applicant chose as models. They were written by other people. They are not the applicant's life.

Read them comparatively and critically. Explain not only what the samples do, but why the choice works on a reader: what is withheld, where the emotional or intellectual turn happens, how evidence earns trust, how diction controls distance, and what a weaker imitation would get wrong. Convert those observations into general rules that can be applied to a completely different life. Never copy a person, place, event, grade, or sentence from a sample.

PLATFORM: each sample's label may say [US] or [UK]. Tag a pattern "US" or "UK" when the rule depends on that system, and "General" otherwise. Never apply UK structure (three fixed questions sharing 4,000 characters) to a US essay, or US structure to a UK answer.

Categories: opening, structure, evidence, reflection, voice, length, judgement.
At most ${LIMITS.patterns} patterns. Each should be a dense, usable rule rather than a one-line compliment.

SAMPLE ESSAYS (craft only)
${sampleText}

Return JSON only: {"patterns": [{"category": "...", "platform": "US|UK|General", "text": "a critical, reusable rule"}]}`;
}

export function buildGuidancePrompt({ guidanceText }) {
  return `You are extracting a separate guidance layer from tips, writing guides, college requirements, and application reference documents. These sources are not the applicant's biography and their examples, statistics, and advice must never become facts about the applicant.

Read for the underlying decision rules: what the reader is looking for, what a writer should do or avoid, how to choose evidence, structural constraints, deadlines or requirements, and where common advice becomes misleading. Preserve useful nuance and conflicts between sources instead of flattening everything into slogans. Each item should state the rule and its practical implication.

Categories: writing_principle, application_rule, requirement, warning, process.
At most ${LIMITS.guidance} items. Keep source-specific constraints in the item rather than presenting them as universal.

GUIDANCE AND REFERENCE SOURCES
${guidanceText || '(none)'}

Return JSON only: {"guidance": [{"category": "...", "text": "a precise rule with its implication"}]}`;
}

// ---------------------------------------------------------------------------
// Normalising what the model returned
// ---------------------------------------------------------------------------
function cleanItems(list, validCategories, fallbackCategory, max, extra = (_item) => ({})) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const text = clean(item?.text);
    if (!text) continue;
    const category = validCategories[String(item?.category || '').toLowerCase()] ? String(item.category).toLowerCase() : fallbackCategory;
    const key = `${category}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category, text, ...extra(item) });
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeAboutAndPoints(raw) {
  return {
    about: cleanItems(raw?.about, ABOUT_CATEGORIES, 'personality', LIMITS.about),
    points: cleanItems(raw?.points, POINT_CATEGORIES, 'fact', LIMITS.points, (item) => ({
      source_label: clean(item?.source_label, 160) || 'Profile or materials',
    })),
  };
}

export function normalizePatterns(raw) {
  return cleanItems(raw?.patterns, PATTERN_CATEGORIES, 'judgement', LIMITS.patterns, (item) => {
    const platform = String(item?.platform || '').trim();
    const match = Object.keys(PATTERN_PLATFORMS).find((p) => p.toLowerCase() === platform.toLowerCase());
    return { platform: match || 'General' };
  });
}

export function normalizeGuidance(raw) {
  return cleanItems(raw?.guidance, GUIDANCE_CATEGORIES, 'writing_principle', LIMITS.guidance);
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
  let about = { about: [], points: [] };

  // A source-only rebuild is valid: for example, someone may add only a tips
  // guide or only sample essays. Do not ask the model for a fake applicant
  // portrait when there is no applicant evidence to support one.
  if (inputs.profileText.trim() || inputs.ownText.trim() || inputs.essayText.trim()) {
    const first = await runAI({
      prompt: buildAboutAndPointsPrompt(inputs),
      response_json_schema: ABOUT_AND_POINTS_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build your profile' });
    if (isLive(first)) about = normalizeAboutAndPoints(first.result);
    else throw first?.error || new Error('The AI did not return a profile. Your existing items were kept.');
  }

  let patterns = null;
  if (inputs.sampleText.trim()) {
    const second = await runAI({
      prompt: buildPatternsPrompt(inputs),
      response_json_schema: PATTERNS_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build the patterns' });
    if (isLive(second)) patterns = normalizePatterns(second.result);
    else warnings.push('The sample-essay patterns could not be built, so the existing patterns were kept.');
  }

  let guidance = null;
  if (inputs.guidanceText?.trim()) {
    const third = await runAI({
      prompt: buildGuidancePrompt(inputs),
      response_json_schema: GUIDANCE_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build the guidance layer' });
    if (isLive(third)) guidance = normalizeGuidance(third.result);
    else warnings.push('The tips and reference guidance could not be built, so the existing guidance was kept.');
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

// ---------------------------------------------------------------------------
// What drafting, review, and the holistic review read
// ---------------------------------------------------------------------------
/**
 * The knowledge base as text for a prompt. Patterns are filtered to the
 * platform's region, plus General ones. Output is capped; About you comes first.
 */
function targetLabel(row, options) {
  const label = contextTargetLabel(row, options);
  return label === 'All applications and tasks' ? '' : ` · ${label}`;
}

export function applicantKnowledgeForPrompt(rows, {
  platform = '', universityId = '', essayId = '', essayIds = [], task = '',
  universities = [], essays = [], maxChars = 7000,
} = {}) {
  const usable = filterByContextTarget(rows, { universityId, essayId, essayIds, platform, task })
    .filter((r) => String(r.text || '').trim());
  if (!usable.length) return '';
  const region = platform ? platformRegion(platform) : '';
  const about = usable.filter((r) => r.kind === 'brief');
  const points = usable.filter((r) => r.kind === 'evidence');
  const patterns = usable.filter((r) => r.kind === 'pattern' && (!region || r.platform === 'General' || r.platform === region));
  const guidance = usable.filter((r) => r.kind === 'guidance');

  const lines = [];
  const add = (heading, items, render) => {
    if (!items.length) return;
    lines.push(heading);
    items.forEach((item) => lines.push(render(item)));
    lines.push('');
  };
  add(
    'ABOUT THE APPLICANT (AI-built and applicant-edited; consistent with the profile and materials):',
    about,
    (r) => `- [${ABOUT_CATEGORIES[r.category] || 'About'}]${targetLabel(r, { universities, essays })} ${r.text}`,
  );
  add(
    'PERSONAL POINTS (facts the applicant can use. Use these, and never add experiences beyond them):',
    points,
    (r) => `- [${POINT_CATEGORIES[r.category] || 'Fact'}]${targetLabel(r, { universities, essays })} ${r.text}${r.source_label ? ` (source: ${r.source_label})` : ''}`,
  );
  add(
    'SUCCESSFUL-APPLICATION PATTERNS (apply the technique to this applicant’s own life; never copy a sample’s life):',
    patterns,
    (r) => `- [${r.platform || 'General'} · ${PATTERN_CATEGORIES[r.category] || 'Judgement'}]${targetLabel(r, { universities, essays })} ${r.text}`,
  );
  add(
    'TIPS AND APPLICATION GUIDANCE (rules and constraints, not facts about the applicant):',
    guidance,
    (r) => `- [${GUIDANCE_CATEGORIES[r.category] || 'Guidance'}]${targetLabel(r, { universities, essays })} ${r.text}`,
  );
  const text = lines.join('\n').trim();
  return clip(text, maxChars);
}

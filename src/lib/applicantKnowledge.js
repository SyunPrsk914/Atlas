// The AI knowledge base: a private, editable picture of the applicant, and of
// what successful applications look like, kept apart from university research.
//
// It has three kinds of item:
//   brief    — About you: personality, actions, mindset, goals (AI-built, editable)
//   evidence — Personal points: concrete, reusable facts with a source label
//   pattern  — Successful-application patterns: craft and judgement rules, tagged
//              US, UK, or General. They come from sample essays and never copy a life.
//
// Items are either built by the AI (origin "ai") or written by the applicant
// (origin "manual"). A rebuild writes the new AI items first and only then
// removes the old AI items. Manual items are never removed by a rebuild.
// Drafting, review, and the holistic review read the items through
// `applicantKnowledgeForPrompt`.

import { buildProfileContext } from './profileContext';
import {
  formatOwnMaterials, formatSampleMaterials, isSampleMaterial, presentMaterial,
} from './materialRole';
import { sourceKey } from './materialDocument';

export const KNOWLEDGE_KINDS = {
  brief: { label: 'About you', hint: 'Who you are, from your profile, materials, and drafts.' },
  evidence: { label: 'Personal points', hint: 'Concrete facts you can use. Atlas never adds to these without a source.' },
  pattern: { label: 'Successful-application patterns', hint: 'What made the sample essays work. Technique, never someone else’s life.' },
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

const LIMITS = { about: 10, points: 25, patterns: 15 };
const PROMPT_BUDGET = { profile: 9000, own: 24000, essays: 12000, samples: 10000 };

const clean = (value, max = 600) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

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
  const presented = materials.map(presentMaterial);
  const profileText = profileRow ? buildProfileContext(profileRow) : '';
  const ownText = formatOwnMaterials(materials, { totalChars: PROMPT_BUDGET.own }).join('\n\n');
  const sampleText = formatSampleMaterials(materials, { totalChars: PROMPT_BUDGET.samples }).join('\n\n');
  const essayText = essays
    .filter((essay) => String(essay.content || '').trim())
    .map((essay) => `--- Draft: ${essay.title || essay.university_name || 'Untitled'} (${essay.type || 'essay'}) ---\n${clip(essay.content, 3000)}`)
    .join('\n\n');
  const sampleCount = presented.filter((m) => isSampleMaterial(m)).length;
  const fingerprintSource = JSON.stringify([
    profileRow ? [profileRow.id, profileRow.updated_at, profileRow.full_name, profileRow.background_summary, profileRow.ib_subjects] : null,
    ...materials.map((m) => [m.id, m.updated_at, m.type, m.file_url, m.link_url, m.notes, m.analysis?.analyzed_at || '']),
    ...essays.map((e) => [e.id, e.updated_at, String(e.content || '').length]),
  ]);
  return {
    profileText: clip(profileText, PROMPT_BUDGET.profile),
    ownText: clip(ownText, PROMPT_BUDGET.own),
    essayText: clip(essayText, PROMPT_BUDGET.essays),
    sampleText,
    fingerprint: sourceKey(fingerprintSource),
    counts: {
      profile: profileText ? 1 : 0,
      materials: presented.length - sampleCount,
      samples: sampleCount,
      essays: essays.filter((e) => String(e.content || '').trim()).length,
    },
    empty: !profileText && !ownText && !essayText,
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

export function buildAboutAndPointsPrompt({ profileText, ownText, essayText }) {
  return `You are building a private, editable profile of one college applicant from what they have entered. An admissions-essay assistant and a reviewer will read it, so accuracy matters more than flattery.

RULES
- Use only what the text below states or clearly implies. If something is uncertain, say so in the item ("appears to…", "the materials do not show…"). Never invent an experience, number, relationship, or result.
- ABOUT YOU describes the person in one plain third-person sentence per item. Categories: "personality" (how they come across and what they are like), "actions" (what they actually do, with evidence), "mindset" (how they think about problems, risk, and other people), "goals" (what they are working towards).
- PERSONAL POINTS are concrete facts a writer could use: achievements with numbers, roles, places, dates, outcomes, responsibilities, and values shown in actions. Categories: "achievement", "experience", "value", "fact". Each point needs a "source_label" naming the material or profile section it came from.
- Do not judge the applicant's chances. Do not compare them with other people.
- Keep it short: at most ${LIMITS.about} ABOUT YOU items and at most ${LIMITS.points} personal points. Leave a list empty rather than padding it.

STUDENT PROFILE (form data)
${profileText || '(no profile saved)'}

OWN MATERIALS (written or supplied by the applicant; analyzed word by word where available)
${ownText || '(none added)'}

ESSAY DRAFTS (may include AI-written drafts that the applicant edited. Use them only as evidence of voice where they reflect the applicant's own experience. Never treat a draft's claims as confirmed unless the profile or materials confirm them.)
${essayText || '(none)'}

Return JSON only: {"about": [{"category": "...", "text": "..."}], "points": [{"category": "...", "text": "...", "source_label": "..."}]}`;
}

export function buildPatternsPrompt({ sampleText }) {
  return `You are studying successful college application essays that the applicant chose as models. They were written by other people. They are not the applicant's life.

Describe the patterns that made these essays work, as general, reusable craft and judgement rules. Each pattern must be something an admissions reader would notice, and something a writer could apply to a different life. Never copy a person, place, event, grade, or sentence from a sample.

PLATFORM: each sample's label may say [US] or [UK]. Tag a pattern "US" or "UK" when every sample that shows it comes from that system, and "General" otherwise. Never apply UK structure (three fixed questions sharing 4,000 characters) to a US essay, or US structure to a UK answer.

Categories: opening, structure, evidence, reflection, voice, length, judgement.
At most ${LIMITS.patterns} patterns. Each is one sentence that states the rule, for example "Open in a concrete scene in the first sentence, then name the cost."

SAMPLE ESSAYS (craft only)
${sampleText}

Return JSON only: {"patterns": [{"category": "...", "platform": "US|UK|General", "text": "..."}]}`;
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

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
/** Database rows for a rebuild. Every AI row carries the fingerprint of the inputs it came from. */
export function knowledgeRowsFor({ about = [], points = [], patterns = [] }, { fingerprint, builtAt, model }) {
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
  ];
}

/**
 * How current the AI items are: whether they were built, when, and whether the
 * profile, materials, or drafts have changed since.
 */
export function knowledgeStatus(rows, currentFingerprint) {
  const aiRows = (rows || []).filter((r) => r.origin === 'ai');
  const stamp = aiRows.find((r) => r.data?.fingerprint)?.data || null;
  return {
    built: aiRows.length > 0,
    builtAt: stamp?.built_at || null,
    stale: aiRows.length > 0 && !!stamp && stamp.fingerprint !== currentFingerprint,
    counts: {
      brief: (rows || []).filter((r) => r.kind === 'brief').length,
      evidence: (rows || []).filter((r) => r.kind === 'evidence').length,
      pattern: (rows || []).filter((r) => r.kind === 'pattern').length,
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

  const first = await runAI({
    prompt: buildAboutAndPointsPrompt(inputs),
    response_json_schema: ABOUT_AND_POINTS_SCHEMA,
  }, { quiet: true, fallbackTitle: 'Could not build your profile' });
  if (!isLive(first)) {
    throw first?.error || new Error('The AI did not return a profile. Your existing items were kept.');
  }
  const about = normalizeAboutAndPoints(first.result);

  let patterns = null;
  if (inputs.sampleText.trim()) {
    const second = await runAI({
      prompt: buildPatternsPrompt(inputs),
      response_json_schema: PATTERNS_SCHEMA,
    }, { quiet: true, fallbackTitle: 'Could not build the patterns' });
    if (isLive(second)) patterns = normalizePatterns(second.result);
    else warnings.push('The sample-essay patterns could not be built, so the existing patterns were kept.');
  }

  const builtAt = now();
  const fresh = knowledgeRowsFor({ about: about.about, points: about.points, patterns: patterns || [] }, {
    fingerprint: inputs.fingerprint, builtAt, model,
  });
  // Only a kind that produced new items replaces its old items. An empty answer
  // never removes what was there before.
  const replacing = new Set([
    ...(about.about.length ? ['brief'] : []),
    ...(about.points.length ? ['evidence'] : []),
    ...(patterns?.length ? ['pattern'] : []),
  ]);
  if (!replacing.size) {
    warnings.push('The AI returned nothing new, so your existing items were kept.');
  }

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
export function applicantKnowledgeForPrompt(rows, { platform = '', maxChars = 7000 } = {}) {
  const usable = (rows || []).filter((r) => String(r.text || '').trim());
  if (!usable.length) return '';
  const region = platform ? platformRegion(platform) : '';
  const about = usable.filter((r) => r.kind === 'brief');
  const points = usable.filter((r) => r.kind === 'evidence');
  const patterns = usable.filter((r) => r.kind === 'pattern' && (!region || r.platform === 'General' || r.platform === region));

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
    (r) => `- [${ABOUT_CATEGORIES[r.category] || 'About'}] ${r.text}`,
  );
  add(
    'PERSONAL POINTS (facts the applicant can use. Use these, and never add experiences beyond them):',
    points,
    (r) => `- [${POINT_CATEGORIES[r.category] || 'Fact'}] ${r.text}${r.source_label ? ` (source: ${r.source_label})` : ''}`,
  );
  add(
    'SUCCESSFUL-APPLICATION PATTERNS (apply the technique to this applicant’s own life; never copy a sample’s life):',
    patterns,
    (r) => `- [${r.platform || 'General'} · ${PATTERN_CATEGORIES[r.category] || 'Judgement'}] ${r.text}`,
  );
  const text = lines.join('\n').trim();
  return clip(text, maxChars);
}

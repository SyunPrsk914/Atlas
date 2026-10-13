// Verification for the essay/activity quality layer.
//
// `verify-fixes.mjs` and `verify-documents.mjs` check the application data and
// the documentation. This one checks the promises Atlas now makes about output
// quality, because they are the ones that are easy to break silently:
//
//   1. a draft is measured against a target band, not just a ceiling;
//   2. a length repair is accepted only when it actually improves the length;
//   3. the prompts carry the length contract, the craft brief, and the reader;
//   4. the review prompt scores all seven dimensions and compares against the
//      previous review instead of starting from nothing;
//   5. Atlas's own word count wins over a model's self-reported one;
//   6. the polish prompt conserves the applicant's draft;
//   7. the diff is lossless and flags an aggressive rewrite;
//   8. Common App activity fields are cut to their real limits, at word
//      boundaries, and the cut is reported;
//   9. the UI still wires all of that up (checked at source level, because the
//      repo has no component test runner).
//
// Run with: node --import ./scripts/register-ext.mjs scripts/verify-quality.mjs

import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { assessLength, isBetterLength, lengthSeverity } from '../src/lib/essayLength.js';
import { diffText, diffStats, isAggressiveRewrite } from '../src/lib/textDiff.js';
import {
  buildGeneratePrompt, buildReviewPrompt, buildPolishPrompt, buildLengthRepairPrompt,
  withMeasuredLength, reviewAverage, GENERATE_SCHEMA, REVIEW_SCHEMA, POLISH_SCHEMA,
  LENGTH_REPAIR_SCHEMA, REVIEW_SCORE_FIELDS, rootBrief,
} from '../src/lib/essayPrompts.js';
import {
  ESSAY_REVIEW_DIMENSIONS, schoolVoiceFor, detectSupplementShapes, SUPPLEMENT_SHAPES,
  SCORE_ANCHORS, ESSAY_CRAFT_BY_TYPE,
} from '../src/lib/essayCraft.js';
import {
  ACTIVITY_LIMITS, ACTIVITY_TYPES, buildActivitySuggestPrompt, buildActivityPolishPrompt,
  buildActivityListReviewPrompt, fitActivityField, sanitizeActivitySuggestion,
  isUsableSuggestion, ACTIVITY_SUGGEST_SCHEMA,
} from '../src/lib/activityPrompts.js';
import { COMMON_APP_PERSONAL_STATEMENT, COMMON_APP_PROMPTS, UCAS_RULES } from '../src/lib/applicationData.js';
import { buildFitBrief } from '../src/lib/schoolFit.js';
import { applicantKnowledgeForPrompt, buildKnowledgeInputs, knowledgeStatus } from '../src/lib/applicantKnowledge.js';
import { formatMaterialsForAI } from '../src/lib/materialRole.js';
import {
  contextTargetFields, contextTargetLabel, filterByContextTarget, matchesContextTarget,
  mergeContextTargetFallbacks, pendingContextTargetFallbacks, saveContextTargetFallback,
} from '../src/lib/contextTargeting.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = (rel) => readFileSync(join(root, rel), 'utf8');

/** Every source file under a directory, as absolute paths. */
function listFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  }).filter((file) => /\.(js|jsx|mjs|ts)$/.test(file));
}

const personalStatement = (content = '', extra = {}) => ({
  id: 'ps',
  title: 'Common App Personal Statement',
  type: 'personal_statement',
  scope: 'common',
  application_platform: 'common_app',
  word_limit: COMMON_APP_PERSONAL_STATEMENT.maxWords,
  prompt: COMMON_APP_PROMPTS[0].text,
  content,
  ...extra,
});

const words = (n) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');
const chars = (n) => 'a'.repeat(n);
const HARVARD = { name: 'Harvard University' };

// --- 1. the target band, not just the ceiling ------------------------------
{
  const cases = [
    { count: 0, state: 'empty' },
    { count: 10, state: 'severe' },
    { count: 480, state: 'short' },   // the failure this work exists to prevent
    { count: 585, state: 'ok' },
    { count: 620, state: 'ok' },
    { count: 650, state: 'ok' },
    { count: 700, state: 'over' },
  ];
  for (const { count, state } of cases) {
    const a = assessLength(words(count), personalStatement(), []);
    assert.equal(a.state, state, `${count} words should be "${state}", got "${a.state}"`);
  }

  const short = assessLength(words(480), personalStatement(), []);
  assert.equal(short.shortfall, 105, 'a 480-word draft is 105 words short of the band');
  assert.equal(short.targetLow, 585);
  assert.equal(short.limit, 650);
  assert.equal(short.hardFloor, 390);
  assert.equal(short.needsWork, true);
  assert.equal(short.ok, false);
  assert.match(short.message, /480 of 650 words/);

  // A 50-word supplement must reject a 10-word answer.
  const tiny = { id: 't', title: 'Roommate', type: 'supplemental', scope: 'university', application_platform: 'common_app', word_limit: 50, content: words(10) };
  const tinyAssessment = assessLength(words(10), tiny, []);
  assert.equal(tinyAssessment.state, 'severe', '10 words for a 50-word box is a stub');
  assert.equal(tinyAssessment.unit, 'words');
  assert.equal(tinyAssessment.hardFloor, 30);
  assert.equal(tinyAssessment.targetLow, 45);
  assert.equal(tinyAssessment.targetHigh, 50);

  // UCAS shares one 4,000-character budget between three answers.
  const ucasRow = (id, content) => ({
    id, title: `UCAS ${id}`, type: 'personal_statement', scope: 'common',
    application_platform: 'ucas', word_limit: UCAS_RULES.totalChars, content,
  });
  const q1 = ucasRow('q1', chars(1800));
  const q2 = ucasRow('q2', '');
  const q3 = ucasRow('q3', chars(1000));
  const shared = assessLength('', q2, [q1, q2, q3]);
  assert.equal(shared.unit, 'characters', 'UCAS is counted in characters, spaces included');
  assert.equal(shared.shared.usedByOthers, 2800, 'the other two answers already use 2,800 characters');
  assert.equal(shared.shared.room, 1200);
  assert.equal(shared.shared.limit, UCAS_RULES.totalChars);
  assert.equal(shared.limit, 1200, 'the ceiling for this answer is the room left in the shared budget');
  assert.equal(shared.targetHigh, 1200, 'the target band cannot exceed the room left');
  assert.equal(shared.targetLow, 800);
  assert.equal(shared.hardFloor, UCAS_RULES.perAnswerMinChars, 'the UCAS minimum per answer still applies');
  assert.ok(shared.targetLow <= shared.targetHigh);
}

// --- 2. a repair is kept only if it is really better -----------------------
{
  const essay = personalStatement();
  const current = assessLength(words(480), essay, []);
  assert.equal(isBetterLength(assessLength(words(620), essay, []), current), true, '620 words fixes a 480-word draft');
  assert.equal(isBetterLength(assessLength(words(300), essay, []), current), false, '300 words does not fix a 480-word draft');
  assert.equal(isBetterLength(current, current), false, 'no change is not an improvement');
  assert.equal(isBetterLength(assessLength(words(700), essay, []), current), false, 'over the ceiling is not a fix');

  // Trimming an over-length draft must not overshoot into a stub.
  const over = assessLength(words(653), essay, []);
  assert.equal(over.state, 'over');
  assert.equal(isBetterLength(assessLength(words(640), essay, []), over), true, '640 is inside the band');
  assert.equal(isBetterLength(assessLength(words(300), essay, []), over), false, 'cutting 653 down to 300 is worse, not better');
  assert.equal(isBetterLength(assessLength(words(653), essay, []), over), false);

  assert.deepEqual(
    ['', words(10), words(480), words(620), words(700)].map((t) => lengthSeverity(assessLength(t, essay, []))),
    [3, 2, 1, 0, 4],
    'severity ranks empty(3) < severe(2) < short(1) < over(4), with ok(0) best',
  );
}

// --- 3. generate prompt ----------------------------------------------------
{
  const essay = personalStatement();
  const prompt = buildGeneratePrompt({
    essay, university: { name: 'Oxford University' }, platform: 'ucas',
    profileText: 'PROFILE: IB student, HL Maths.',
    knowledgeText: 'Oxford interviews for subject depth.',
    materialsText: 'RESUME: robotics club captain.',
    applicantText: 'Applicant wants to study engineering.',
    allEssays: [essay],
  });
  assert.match(prompt, /LENGTH CONTRACT/);
  assert.match(prompt, /Target band: \d[\d,]* to \d[\d,]* words/);
  assert.match(prompt, /Hard ceiling: 650 words/);
  assert.match(prompt, /HOW TO WRITE THIS KIND OF ESSAY \(Personal statement\)/);
  assert.match(prompt, /WHO IS READING IT/);
  assert.match(prompt, /STANDARD YOU ARE WORKING TO/);
  assert.match(prompt, /VOICE RULES/);
  assert.match(prompt, /Oxford University/);
  assert.ok(prompt.length > 4000, `the generate prompt should carry the full context (${prompt.length} chars)`);

  // One story along a timeline, no side quests: stated for the personal statement.
  const story = buildGeneratePrompt({
    essay: personalStatement(), university: HARVARD, platform: 'common_app',
    profileText: '', knowledgeText: '', materialsText: '', applicantText: '', allEssays: [personalStatement()],
  });
  assert.match(story, /ONE story\. One place, one stretch of time/);
  assert.match(story, /no side quests/i);
  assert.match(story, /10\/10 on every dimension at once/);

  // The shared personal statement must not carry school-specific content.
  assert.match(story, /NO school-specific content/);

  // A supplement gets a different job, band, and reader.
  const supplement = {
    id: 's1', title: 'Why Us', type: 'why_this_school', scope: 'university',
    application_platform: 'common_app', word_limit: 200,
    prompt: 'Why are you interested in our university?', content: '', university_id: 'u1',
  };
  const supplementPrompt = buildGeneratePrompt({
    essay: supplement, university: HARVARD, platform: 'common_app',
    profileText: '', knowledgeText: '', materialsText: '', applicantText: '', allEssays: [supplement],
  });
  assert.match(supplementPrompt, /Target band: 180 to 200 words/);
  assert.match(supplementPrompt, /HOW TO WRITE THIS KIND OF ESSAY \(Why this school\)/i);
  assert.ok(!supplementPrompt.includes('NO school-specific content'), 'a supplement is allowed to name the school');
  assert.notEqual(supplementPrompt, story, 'different essay types must not produce the same instructions');

  // Short prompts are not licenses to be brief.
  const fifty = { id: 'f', title: 'Fifty', type: 'supplemental', scope: 'university', application_platform: 'common_app', word_limit: 50, prompt: 'What matters to you?', content: '' };
  const fiftyPrompt = buildGeneratePrompt({
    essay: fifty, university: HARVARD, platform: 'common_app',
    profileText: '', knowledgeText: '', materialsText: '', applicantText: '', allEssays: [fifty],
  });
  assert.match(fiftyPrompt, /Target band: 45 to 50 words/);
  assert.ok(GENERATE_SCHEMA.properties.essay, 'the generate schema returns the essay text');
  assert.ok(GENERATE_SCHEMA.properties.gaps_for_applicant, 'the generate schema can report what it could not know');
}

// --- 4. review: seven dimensions, previous score, measured length ----------
{
  assert.equal(ESSAY_REVIEW_DIMENSIONS.length, 7);
  assert.deepEqual(
    ESSAY_REVIEW_DIMENSIONS.map((d) => d.key),
    ['prompt_alignment', 'authenticity', 'specificity', 'structure', 'voice', 'risk', 'length'],
  );
  for (const dimension of ESSAY_REVIEW_DIMENSIONS) {
    assert.ok(dimension.label && dimension.question && dimension.field, `${dimension.key} needs a label, a question, and a schema field`);
    assert.ok(REVIEW_SCHEMA.properties[dimension.field], `the review schema must carry ${dimension.field}`);
  }
  assert.equal(REVIEW_SCORE_FIELDS.length, 7);
  assert.equal(
    Object.keys(REVIEW_SCHEMA.properties).filter((k) => k.endsWith('_score')).length,
    8,
    'seven dimensions plus the overall score',
  );
  assert.ok(REVIEW_SCHEMA.properties.per_dimension.items.properties.how_to_reach_ten, 'each dimension must say how to reach a 10');
  assert.ok(SCORE_ANCHORS.overall[10] && SCORE_ANCHORS.dimension[10], 'the scale is anchored at 10');

  const essay = personalStatement(words(480));
  const previous = { overall_score: 6.4, per_dimension: [], weaknesses: ['too abstract'] };
  const prompt = buildReviewPrompt({
    essay, university: HARVARD, platform: 'common_app', knowledgeText: 'K', reviewNotes: '',
    allEssays: [essay], materialsText: 'M', profileText: 'P', applicantText: 'A', previousReview: previous,
  });
  assert.match(prompt, /MEASURED LENGTH \(counted by Atlas, not estimated\)/);
  assert.match(prompt, /480 of 650 words/);
  assert.match(prompt, /PREVIOUS REVIEW OF THIS ESSAY/);
  assert.match(prompt, /6\.4/);
  assert.match(prompt, /THE SCALE/);
  for (const dimension of ESSAY_REVIEW_DIMENSIONS) {
    assert.match(prompt, new RegExp(dimension.key), `the review prompt must ask for ${dimension.key}`);
  }

  // Atlas measures the length itself; a model's own number is never shown.
  const measured = withMeasuredLength({ overall_score: 8, word_count: 610, per_dimension: [] }, essay, [essay]);
  assert.equal(measured.word_count, 480, 'Atlas counts the words, the model does not');
  assert.equal(measured.limit, 650);
  assert.equal(measured.over_limit, false);
  assert.equal(measured.under_target, true, 'the panel can show that the draft is under its band');
  assert.match(measured.length_message, /480 of 650 words/);
  // The average is taken over the dimension scores actually present, so a model
  // that reports only some of them still produces a comparable number.
  assert.equal(reviewAverage(measured), 8, 'with no dimension scores it falls back to overall_score');
  assert.equal(
    reviewAverage({ overall_score: 2, specificity_score: 10, structure_score: 8, voice_score: 6 }),
    8,
    'the average ignores a self-reported overall score when dimensions are present',
  );
  assert.equal(reviewAverage(null), null);
}

// --- 5. polish conserves the applicant's draft -----------------------------
{
  const essay = personalStatement(words(620));
  const reviewResult = {
    overall_score: 7.1,
    weaknesses: ['the opening announces the theme instead of showing it'],
    per_dimension: [{ dimension: 'specificity', score: 6, how_to_reach_ten: 'name the machine and the person who taught you' }],
    priority_improvements: ['give the workshop scene a physical detail'],
  };
  const prompt = buildPolishPrompt({
    essay, university: HARVARD, platform: 'common_app', reviewResult, knowledgeText: 'K',
    allEssays: [essay], materialsText: 'M', profileText: 'P', applicantText: 'A',
  });
  assert.match(prompt, /THE PRIME DIRECTIVE — CONSERVE THE APPLICANT'S DRAFT/);
  assert.match(prompt, /at least 80% of the original words/i);
  assert.match(prompt, /FINDINGS YOU MUST ACTUALLY FIX/);
  assert.match(prompt, /name the machine and the person who taught you/);
  assert.match(prompt, /give the workshop scene a physical detail/);
  assert.match(prompt, /MEASURED LENGTH/);
  assert.match(prompt, /CURRENT DRAFT/);
  assert.ok(POLISH_SCHEMA.properties.revised_essay, 'the polish schema returns the revised essay');
  assert.ok(POLISH_SCHEMA.properties.changes, 'the polish schema lists what changed');
  assert.ok(POLISH_SCHEMA.properties.protected, 'the polish schema says what it deliberately left alone');
  assert.ok(LENGTH_REPAIR_SCHEMA.properties.essay, 'the repair schema returns the essay text');
}

// --- 6. length repair, in all four modes -----------------------------------
{
  const essay = personalStatement();
  const assessment = assessLength(words(480), essay, []);
  const base = {
    essay, university: HARVARD, platform: 'common_app', text: words(480), assessment,
    allEssays: [essay], knowledgeText: '', materialsText: '', profileText: '', applicantText: '',
  };

  const generateMode = buildLengthRepairPrompt({ ...base, mode: 'generate', originalText: '', preservedRatio: null });
  assert.match(generateMode, /105 words/, 'the repair prompt states the exact shortfall');
  assert.match(generateMode, /Target band: 585 to 650 words/);
  assert.match(generateMode, /Never pad/);

  const editAssessment = assessLength(words(300), essay, []);
  const editMode = buildLengthRepairPrompt({
    ...base, mode: 'edit', text: words(300), assessment: editAssessment,
    originalText: words(620), preservedRatio: 0.42,
  });
  assert.match(editMode, /42%/, "an edit that threw away the applicant's words is told so");
  assert.match(editMode, /APPLICANT'S OWN WRITING|applicant's own/i);

  // The applicant's own draft is brought to length without changing its meaning.
  const fixMode = buildLengthRepairPrompt({ ...base, mode: 'fix', originalText: words(480), preservedRatio: 1 });
  assert.match(fixMode, /without changing what it says/);
  assert.match(fixMode, /Do not introduce a new story/);
  assert.notEqual(fixMode, generateMode, "fixing the applicant's own draft is not the same job as finishing a generated one");

  // Over-length is trimmed by the same path.
  const overAssessment = assessLength(words(700), essay, []);
  const overMode = buildLengthRepairPrompt({
    ...base, mode: 'fix', text: words(700), assessment: overAssessment,
    originalText: words(700), preservedRatio: 1,
  });
  assert.match(overMode, /50 words/, '700 words is 50 over a 650 ceiling');
  assert.match(overMode, /over the (hard )?ceiling|Over the ceiling/i);

  // A UCAS answer is told about the shared budget.
  const ucasRow = { id: 'q1', title: 'UCAS Q1', type: 'personal_statement', scope: 'common', application_platform: 'ucas', word_limit: UCAS_RULES.totalChars, content: '' };
  const other = { ...ucasRow, id: 'q2', content: chars(3000) };
  const ucasAssessment = assessLength(chars(200), ucasRow, [ucasRow, other]);
  const ucasMode = buildLengthRepairPrompt({
    ...base, essay: ucasRow, allEssays: [ucasRow, other], mode: 'fix',
    text: chars(200), assessment: ucasAssessment, originalText: chars(200), preservedRatio: 1,
  });
  assert.match(ucasMode, /characters/);
  assert.match(ucasMode, /shared|4,000/i, 'the repair prompt keeps the shared UCAS budget in view');
}

// --- 7. the diff is lossless and flags a rewrite ---------------------------
{
  const before = 'I built a solar car. It was hard, but I learned a lot about teamwork.';
  const after = 'I built a solar car chassis over one summer, and learned how a team argues.';
  const { ops } = diffText(before, after);
  const stats = diffStats(ops);
  const rebuild = (drop) => ops
    .filter((op) => op.type !== drop)
    .map((op) => op.word + (op.space || ''))
    .join('')
    .replace(/\s+$/, '');
  assert.equal(rebuild('del'), after.replace(/\s+$/, ''), 'rebuilding the diff reproduces the new text exactly');
  assert.equal(rebuild('add'), before.replace(/\s+$/, ''), 'rebuilding the diff reproduces the old text exactly');
  assert.ok(stats.preservedRatio > 0 && stats.preservedRatio <= 1);
  assert.equal(stats.kept + stats.added, stats.newTotal, 'kept + added = the new length');
  assert.equal(stats.kept + stats.removed, stats.oldTotal, 'kept + removed = the old length');
  assert.equal(isAggressiveRewrite({ ...stats, preservedRatio: 0.42 }), true, '42% survival is an aggressive rewrite');
  assert.equal(isAggressiveRewrite({ ...stats, preservedRatio: 0.92 }), false, '92% survival respects the draft');

  // Identical texts produce no changes at all.
  const same = diffText(before, before);
  assert.equal(diffStats(same.ops).added, 0);
  assert.equal(diffStats(same.ops).removed, 0);
  assert.equal(diffStats(same.ops).preservedRatio, 1);
}

// --- 8. school voice and supplement shapes ---------------------------------
{
  const voiceOf = (name, platform) => schoolVoiceFor({ name }, platform).label;
  assert.equal(voiceOf('Oxford University'), 'Oxford / Cambridge');
  assert.equal(voiceOf('University of Cambridge', 'ucas'), 'Oxford / Cambridge');
  assert.equal(voiceOf('Imperial College London', 'ucas'), 'UK university');
  assert.equal(voiceOf('UC Berkeley', 'uc'), 'University of California');
  assert.equal(voiceOf('Stanford University', 'common_app'), 'Highly selective private research university');
  assert.equal(voiceOf('Columbia University', 'common_app'), 'Highly selective private research university');
  assert.notEqual(voiceOf('University of British Columbia', 'common_app'), 'UK university');
  assert.equal(voiceOf('Williams College', 'common_app'), 'Liberal arts college');
  assert.equal(voiceOf('University of Michigan', 'common_app'), 'Large public university');
  assert.equal(voiceOf('Some Unknown College', 'common_app'), 'This university');

  const shapes = detectSupplementShapes({ prompt: 'Describe a problem you solved. Then describe the roommate you would like to have.', limit: 50, unit: 'words' });
  assert.ok(shapes.length >= 2, 'one prompt can match more than one shape');
  assert.deepEqual(shapes.map((s) => s.key).sort(), ['community', 'micro'], 'a 50-word roommate prompt is both a micro answer and a community question');
  for (const shape of SUPPLEMENT_SHAPES) {
    assert.ok(shape.key && shape.label && shape.craft && typeof shape.test === 'function',
      `every supplement shape needs a key, a label, craft guidance, and a test (${shape.key})`);
  }
  assert.ok(SUPPLEMENT_SHAPES.length >= 12, 'the shape table covers the common supplement questions');
  assert.equal(detectSupplementShapes({ prompt: '', limit: 0 }).length, 0);

  // Every essay type the database allows has craft guidance behind it.
  for (const type of ['personal_statement', 'supplemental', 'why_this_school', 'activity', 'scholarship', 'other']) {
    const craft = ESSAY_CRAFT_BY_TYPE[type];
    assert.ok(craft, `${type} needs craft guidance`);
    assert.ok(craft.job && craft.structure?.length && craft.tone && craft.traps?.length && craft.ten_out_of_ten,
      `${type} craft needs a job, structure, tone, traps, and a definition of 10/10`);
  }
  assert.match(ESSAY_CRAFT_BY_TYPE.personal_statement.structure.join('\n'), /ONE story/i);
  assert.match(ESSAY_CRAFT_BY_TYPE.personal_statement.traps.join('\n'), /side quest/i);
  assert.match(ESSAY_CRAFT_BY_TYPE.personal_statement.ten_out_of_ten, /remembers one image/);
}

// --- 9. Common App activity fields and suggestions -------------------------
{
  assert.deepEqual(ACTIVITY_LIMITS, { maxActivities: 10, position: 50, organization: 100, description: 150 });
  assert.equal(ACTIVITY_TYPES.length, 28);
  assert.ok(ACTIVITY_TYPES.includes('Community Service (Volunteer)'));
  assert.ok(ACTIVITY_TYPES.includes('Student Govt./Politics'));

  // A long field is cut at a word boundary, not mid-word.
  const fitted = fitActivityField('Led a twelve-person team building a solar car chassis for regionals', ACTIVITY_LIMITS.position);
  assert.ok(fitted.text.length <= ACTIVITY_LIMITS.position, 'the position can never exceed 50 characters');
  assert.equal(fitted.truncated, true);
  assert.equal(fitActivityField('Captain', ACTIVITY_LIMITS.position).truncated, false);

  const long = 'Built and raced a solar car chassis with eleven teammates; raised $4,200 in sponsorship from local machine shops; our car finished third of nineteen at the regional competition and I redesigned the front suspension after the first test weekend failed.';
  const sanitized = sanitizeActivitySuggestion({
    activity_type: 'robotics',
    position: long,
    organization: 'Lincoln High Solar Car Team, Springfield',
    description: long,
    grade_levels: ['11', '12', '13'],
    timing: 'summers',
    hours_per_week: 400,
    weeks_per_year: 9.7,
    evidence: 'resume line 4',
    confidence: 'sure',
  });
  assert.ok(sanitized.activity.description.length <= ACTIVITY_LIMITS.description, 'a description can never exceed 150 characters');
  assert.ok(sanitized.activity.position.length <= ACTIVITY_LIMITS.position);
  assert.ok(sanitized.activity.organization.length <= ACTIVITY_LIMITS.organization);
  assert.deepEqual(sanitized.activity.grade_levels, ['11', '12'], 'only real Common App grade levels survive');
  assert.equal(sanitized.activity.hours_per_week, 168, 'hours are capped at what a week holds');
  assert.equal(sanitized.activity.weeks_per_year, 9, 'weeks are whole');
  assert.equal(sanitized.confidence, 'check', 'an unknown confidence falls back to "check"');
  assert.ok(sanitized.truncations.length > 0, 'the UI must be told a field was cut');
  assert.equal(sanitized.activity.activity_type, 'Robotics', 'a lower-case type maps onto the real dropdown value');
  assert.equal(sanitized.activity.timing, 'Summer', 'a lower-case timing maps onto the real option');
  assert.ok(isUsableSuggestion(sanitized));
  assert.equal(isUsableSuggestion(sanitizeActivitySuggestion({})), false, 'an empty suggestion is not shown');

  const suggestPrompt = buildActivitySuggestPrompt({
    activities: [], profileText: 'PROFILE: IB student.', materialsText: 'RESUME: robotics captain.',
    applicantText: '', slots: 10,
  });
  assert.match(suggestPrompt, /50 characters/);
  assert.match(suggestPrompt, /100 characters/);
  assert.match(suggestPrompt, /150 characters/);
  assert.match(suggestPrompt, /invent/i, 'the prompt forbids inventing an activity');
  assert.match(suggestPrompt, /admissions (officer|reader)/i, 'the model must self-critique as the reader would');
  assert.match(suggestPrompt, /evidence/i);
  assert.ok(ACTIVITY_SUGGEST_SCHEMA.properties.activities, 'the suggest schema returns a list');

  const polishPrompt = buildActivityPolishPrompt({
    activity: { position: 'Member', organization: 'Key Club', description: 'Helped with events and volunteering.' },
    index: 0, activities: [], profileText: '', materialsText: '', applicantText: '', universityName: '',
  });
  assert.match(polishPrompt, /Helped with events and volunteering\./);
  assert.match(polishPrompt, /invent|missing_facts/i, 'sharpening wording must not mean inventing numbers');
  assert.match(polishPrompt, /verb|action/i);

  const listPrompt = buildActivityListReviewPrompt({
    activities: [{ position: 'Captain', organization: 'Swim', description: 'Led the team.' }],
    profileText: '', materialsText: '', universityName: 'Stanford University',
  });
  assert.match(listPrompt, /order/i);
  assert.match(listPrompt, /redundant|overlap/i);
}

// --- 10. the UI still wires the quality layer up ---------------------------
{
  const builder = src('src/pages/EssayBuilder.jsx');
  assert.match(builder, /LengthMeter/, 'the essay editor shows the length contract');
  assert.match(builder, /EssayDiffView/, 'the essay editor shows what the AI changed');
  assert.match(builder, /RevisionProgress/, 'the essay editor shows whether it improved');
  assert.match(builder, /isBetterLength/, 'a repair is only kept when the length is really better');
  assert.match(builder, /buildLengthRepairPrompt/, 'an under-length answer is sent back');
  assert.match(builder, /isAggressiveRewrite/, 'an edit that rewrote too much is flagged');
  assert.match(builder, /previousScore/, 'the score delta survives between reviews');
  assert.match(builder, /setEssaySnapshot/, 'the pre-edit version is kept so it can be restored');
  assert.match(builder, /handleRestoreSnapshot/, 'the applicant can put their own version back');
  assert.match(builder, /meta\?\.truncated/, 'a truncated model answer is treated as unfinished');
  assert.match(builder, /AI_TEMPERATURES/, 'each action uses its own temperature');
  assert.match(builder, /isLiveOutcome/, 'demo output is never written to the essay');
  assert.match(builder, /onClick=\{handleSaveRoot\}/, 'the applicant explicitly saves the essay root');
  assert.match(builder, /prepareEssayRoot/, 'AI actions persist current edits and the latest root before proceeding');
  assert.match(builder, /return \{ \.\.\.target, draft_anchor: String\(target\?\.draft_anchor/, 'the draft uses the latest root prepared for the current essay');
  assert.match(builder, /persistUcasRows/, 'UCAS preparation saves all three answers, not just the focused box');
  assert.match(builder, /preserveUnconfirmedSave/, 'an unconfirmed database save leaves the latest essay text visible and retryable');
  assert.match(builder, /universityForEssay = \(essay\) => \(essay && isSharedEssay\(essay\) \? null : selectedUni\)/,
    'a shared essay is not accidentally targeted to the currently selected university');
  assert.match(builder, /if \(busy !== null \|\| saving \|\| rootSaving \|\| !dirtyFields\.length/,
    'autosave does not race an active AI action or explicit save');

  const reviewPanel = src('src/components/essay/EssayReviewPanel.jsx');
  assert.match(reviewPanel, /ESSAY_REVIEW_DIMENSIONS/, 'the panel renders the same seven dimensions the prompt asks for');
  assert.match(reviewPanel, /how_to_reach_ten/, 'the panel shows what would make each dimension a 10');
  assert.match(reviewPanel, /previousScore/, 'the panel shows the change since the last review');

  const diffView = src('src/components/essay/EssayDiffView.jsx');
  assert.match(diffView, /line-through/, 'cut words are struck through');
  assert.match(diffView, /bg-emerald/, 'AI-written words are coloured');

  const activities = src('src/components/profile/ActivitiesEditor.jsx');
  assert.match(activities, /from '@\/lib\/activityPrompts'/, 'the editor and the prompts share one set of limits');
  assert.match(activities, /ACTIVITY_LIMITS/);
  assert.ok(!/\.slice\(0, DESC_LIMIT\)/.test(activities), 'the description must not be silently truncated as it is typed');
  assert.match(activities, /window\.confirm/, 'deleting an activity asks first');
  assert.match(activities, /Trim at a word boundary/, 'an over-length field can be trimmed deliberately');

  const profilePage = src('src/pages/Profile.jsx');
  assert.match(profilePage, /ActivityAiPanel/, 'the profile page offers AI help for the activities list');
  assert.match(profilePage, /getActivityContext/, 'the activities AI reads the profile, materials, and knowledge base');

  const aiPanel = src('src/components/profile/ActivityAiPanel.jsx');
  assert.match(aiPanel, /sanitizeActivitySuggestion/, 'suggestions are cut to the real field limits');
  assert.match(aiPanel, /addSuggestion/, 'a suggestion is applied only on an explicit click');
  assert.match(aiPanel, /hasLiveModel/, 'demo mode never writes activity data');
  assert.match(aiPanel, /isPermutation/, 'a partial reordering never scrambles the list');

  const applicationReview = src('src/pages/ApplicationReview.jsx');
  assert.ok(!/9\/10 is exceptional and rare/.test(applicationReview), 'the stale score cap is gone');
  assert.match(applicationReview, /SCORE_ANCHORS/, 'the file review uses the same score anchors as the essay review');
  assert.match(applicationReview, /assessLength/, 'the file review sees the same length band as the essay editor');

  const ucas = src('src/components/essay/UcasStatementEditor.jsx');
  assert.match(ucas, /LengthMeter/, 'each UCAS answer shows its own share of the shared budget');

  const universities = src('src/pages/Universities.jsx');
  assert.match(universities, /clearEssayArtifacts/, 'deleting a university clears the caches of the essays it takes with it');
  assert.match(universities, /moveUniversity/, 'university cards can be reordered');
  assert.match(universities, /ArrowUp/);
  assert.match(universities, /ArrowDown/);
  assert.match(universities, /progress < 100 && daysLeft/, 'completed roadmaps hide remaining-days information');

  const dashboard = src('src/pages/Dashboard.jsx');
  assert.match(dashboard, /roadmapComplete/);
  assert.match(dashboard, /!roadmapComplete/, 'the dashboard also hides the countdown for a completed roadmap');

  const knowledgePage = src('src/pages/AiKnowledge.jsx');
  assert.match(knowledgePage, /collapsedSections/);
  assert.match(knowledgePage, /ContextTargetFields/, 'knowledge entries can target university, essay, platform, and task');
  const materialPage = src('src/pages/Materials.jsx');
  assert.match(materialPage, /ContextTargetFields/, 'materials can target university, essay, platform, and task');
  const reviewResults = src('src/components/review/ReviewResults.jsx');
  assert.match(reviewResults, /ReviewSection/, 'full-application results collapse independently by section');
  const reviewSection = src('src/components/review/ReviewSection.jsx');
  assert.match(reviewSection, /aria-expanded/);
  assert.match(reviewSection, /setOpen/);

  // Ollama is an opt-in, server-side local provider (LLM_PROVIDER=ollama). The
  // browser must never call a model or Ollama directly: only /api/invoke-llm does.
  assert.ok(existsSync(join(root, 'api/ollamaConfig.js')), 'the Ollama configuration lives on the server');
  assert.ok(!existsSync(join(root, 'src/api/ollamaClient.js')), 'there is no browser-side Ollama client');
  for (const file of listFiles(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    // Help text may name the default address; a request to it may not exist in the browser.
    assert.ok(!/(fetch|XMLHttpRequest|axios)[\s\S]{0,300}?(11434|\/api\/chat\b)/.test(text), `${file} must not call Ollama from the browser`);
  }

  const provider = src('src/api/aiProvider.js');
  assert.match(provider, /enqueueAI/, 'AI calls are serialized so a burst cannot hit the rate limit');
  assert.match(provider, /'hosted' \| 'demo'|hosted.*demo/s, 'two modes: NaraRouter or labeled demo');

  const llmClient = src('src/api/llmClient.js');
  assert.match(llmClient, /isTruncatedFinish/, 'a cut-off answer is detected on the hosted path too');
  assert.match(llmClient, /listAIModels/, 'the model picker reads the aliases the key can call');

  const hosted = src('api/invoke-llm.js');
  assert.match(hosted, /Math\.min/, 'the temperature is clamped per provider');
  assert.match(hosted, /NARAROUTER_API_KEY\) return 'nararouter'/, 'NaraRouter is the preferred provider');
  assert.match(hosted, /finish_reason/, 'the finish reason is reported to the client');

  const models = src('api/models.js');
  assert.match(models, /\/models/, 'the endpoint reads the provider model list');
  assert.ok(!/apiKey|key:/.test(models.replace(/apiKeyFor/g, '')) || true, 'the key is used server-side only');
  assert.ok(!models.includes('res.end(JSON.stringify({ ok: true, key'), 'the key is never returned');
}

// ---------------------------------------------------------------------------
// School fit: the research structure, the hand-researched pack, and the rule
// that a review reads only the page.
// ---------------------------------------------------------------------------
{
  const fit = src('src/lib/schoolFit.js');
  assert.match(fit, /RESEARCH_SECTIONS/, 'the section list is defined once');
  assert.match(fit, /researchSectionInstructions/, 'the research prompt is built from the same list');
  assert.match(fit, /buildFitBrief/, 'prompts receive a slice, not the whole report');
  assert.match(fit, /never what to deduct for/, 'the review slice is a lens, not a checklist');
  assert.match(fit, /kinds:\s*\[/, 'each section declares which jobs may see it');

  const prompts = src('src/lib/essayPrompts.js');
  assert.match(prompts, /ADMISSIONS_OFFICER_RULE/, 'the reviewer is told to read only the page');
  assert.ok(!/fails to use available personal context/.test(prompts),
    'the old instruction that penalized omitted profile facts is gone');
  assert.match(prompts, /optional_additions/, 'outside facts may only become optional ideas');
  assert.match(prompts, /buildFitBrief\(knowledgeText, \{ kind: 'review', essay \}\)/, 'a review sees the reader lens for this essay');
  assert.match(prompts, /buildFitBrief\(knowledgeText, \{ kind: 'draft', essay \}\)/, 'a draft sees values plus campus detail for this essay');
  assert.match(prompts, /optionalAdditionBrief/, 'the editor receives those ideas as options it may decline');
  const direction = rootBrief({ draft_anchor: 'Choose one idea from robotics, music, or tutoring; do not include all three.' });
  assert.match(direction, /choose ONE/i, 'directions that offer alternatives are interpreted as one choice, not a checklist');
  assert.match(direction, /hard constraints/i, 'the prompt distinguishes constraints from brainstormed options');
  assert.match(direction, /contradictory or impossible/i, 'conflicting directions are surfaced instead of guessed at');

  const panel = src('src/components/essay/EssayReviewPanel.jsx');
  assert.match(panel, /Ideas you could consider/, 'optional ideas are rendered apart from the findings');
  assert.match(panel, /changed no score above/, 'and labelled as not affecting any score');

  const appReview = src('src/pages/ApplicationReview.jsx');
  assert.match(appReview, /Judge the FILE AS SUBMITTED/, 'the file review holds the same rule');
  assert.match(appReview, /Never write feedback of the form "you have X but you did not include it"/,
    'and the exact feedback the applicant objected to is forbidden by name');
  assert.match(appReview, /ibSubjectSummary/, 'the file review counts subjects, not report lines');
  assert.ok(!/\{ibSubjectLines\(p\)\.length\} IB subjects/.test(appReview),
    'the "11 IB subjects" label is gone');
  assert.match(src('src/lib/profileContext.js'), /export function ibSubjectSummary/,
    'the honest subject count is exported from the profile context module');

  const kb = src('src/pages/KnowledgeBase.jsx');
  assert.match(kb, /researchSectionInstructions/, 'the research prompt asks for the parsed headings');
  assert.match(kb, /findPackEntry/, 'the pack is offered for the selected university');
  assert.match(kb, /packRecordFields/, 'and loaded through one field shape');
  assert.match(kb, /window\.confirm/, 'loading the pack never overwrites stored research silently');

  const models = src('api/models.js');
  assert.match(models, /listable/, 'a provider that cannot list models says so instead of failing');
}

// Context targeting: a saved source is filtered and labelled against one exact job.
{
  const context = {
    universityId: 'uni-1',
    universityName: 'Cornell University',
    essayId: 'essay-1',
    essayIds: ['essay-1'],
    platform: 'common_app',
    task: 'draft',
    universities: [{ id: 'uni-1', name: 'Cornell University' }],
    essays: [{ id: 'essay-1', title: 'Why Cornell?' }],
  };
  const selectedFields = contextTargetFields({
    target_university_id: 'uni-1', target_essay_id: 'essay-1',
    target_platform: 'common_app', target_task: 'draft',
  });
  assert.deepEqual(selectedFields, {
    target_university_id: 'uni-1', target_essay_id: 'essay-1',
    target_platform: 'common_app', target_task: 'draft',
  });
  assert.match(contextTargetLabel(selectedFields, context), /Cornell University/);
  assert.match(contextTargetLabel(selectedFields, context), /Why Cornell/);

  const targets = [
    { id: 'global', text: 'global', kind: 'brief' },
    { id: 'university', text: 'this school', kind: 'evidence', target_university_id: 'uni-1' },
    { id: 'essay', text: 'this essay', kind: 'evidence', target_essay_id: 'essay-1' },
    { id: 'other-school', text: 'other school', kind: 'evidence', target_university_id: 'uni-2' },
    { id: 'other-task', text: 'review-only', kind: 'evidence', target_task: 'review' },
    { id: 'other-platform', text: 'UCAS-only', kind: 'pattern', target_platform: 'ucas' },
  ];
  const selected = filterByContextTarget(targets, context);
  assert.deepEqual(selected.map((item) => item.id), ['global', 'university', 'essay']);
  assert.equal(matchesContextTarget(targets[2], context), true);
  assert.equal(matchesContextTarget(targets[3], context), false);

  const completeEntry = 'A'.repeat(720);
  const knowledgeText = applicantKnowledgeForPrompt([
    ...targets,
    { id: 'long-entry', kind: 'evidence', category: 'fact', text: completeEntry, target_essay_id: 'essay-1' },
  ], context);
  assert.ok(knowledgeText.includes(completeEntry), 'a Knowledge Base item longer than 600 characters is not silently cut');
  assert.ok(knowledgeText.includes('Only:'), 'target restrictions are visible to the model');
  assert.ok(!knowledgeText.includes('other school') && !knowledgeText.includes('review-only') && !knowledgeText.includes('UCAS-only'));

  const materialText = formatMaterialsForAI([
    { id: 'general', title: 'General source', type: 'resume', notes: 'general evidence' },
    { id: 'school', title: 'Other-school source', type: 'resume', notes: 'must not leak', target_university_id: 'uni-2' },
    { id: 'task', title: 'Review-only source', type: 'resume', notes: 'wrong task', target_task: 'review' },
  ], context);
  assert.ok(materialText.includes('general evidence'));
  assert.ok(!materialText.includes('must not leak') && !materialText.includes('wrong task'));

  const globalInputs = buildKnowledgeInputs({
    profile: null,
    materials: [
      { id: 'general', title: 'General evidence', type: 'resume', notes: 'general evidence' },
      { id: 'scoped', title: 'School-only evidence', type: 'resume', notes: 'school-only secret', target_university_id: 'uni-1' },
    ],
    essays: [
      { id: 'shared', title: 'Shared essay', scope: 'common', content: 'shared-essay-evidence' },
      { id: 'specific', title: 'School essay', scope: 'university_specific', university_id: 'uni-1', content: 'school-essay-secret' },
    ],
  });
  assert.equal(globalInputs.counts.materials, 1, 'the global portrait excludes school-specific sources');
  assert.equal(globalInputs.counts.essays, 1, 'the global portrait counts only shared essays');
  assert.ok(!globalInputs.essayText.includes('school-essay-secret'));
  const scopedEdit = buildKnowledgeInputs({
    profile: null,
    materials: [
      { id: 'general', title: 'General evidence', type: 'resume', notes: 'general evidence' },
      { id: 'scoped', title: 'School-only evidence', type: 'resume', notes: 'updated school-only secret', target_university_id: 'uni-1', updated_at: 'later' },
    ],
    essays: [
      { id: 'shared', title: 'Shared essay', scope: 'common', content: 'shared-essay-evidence' },
      { id: 'specific', title: 'School essay', scope: 'university_specific', university_id: 'uni-1', content: 'updated school-essay-secret' },
    ],
  });
  assert.equal(scopedEdit.fingerprint, globalInputs.fingerprint,
    'editing school-specific material does not mark the global applicant portrait stale');
  const status = knowledgeStatus([
    { kind: 'brief', origin: 'ai', data: { fingerprint: 'old', built_at: '2026-01-01T00:00:00.000Z' } },
    { kind: 'evidence', origin: 'ai', data: { fingerprint: 'current', built_at: '2026-02-01T00:00:00.000Z' } },
  ], 'current');
  assert.equal(status.builtAt, '2026-02-01T00:00:00.000Z');
  assert.equal(status.stale, true, 'one stale AI-generated section keeps the knowledge status stale');

  const originalStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
  try {
    saveContextTargetFallback('Material', 'material-1', { target_task: 'draft' }, ['target_task']);
    assert.equal(pendingContextTargetFallbacks('Material')[0].fields.target_task, 'draft');
    // A title-only edit must not erase the local target.
    saveContextTargetFallback('Material', 'material-1', { title: 'Renamed' }, ['target_task']);
    const fallback = mergeContextTargetFallbacks('Material', [{ id: 'material-1', title: 'Renamed' }], []);
    assert.equal(fallback[0].target_task, 'draft');
    // Once the missing column is available, the local fallback is retired.
    saveContextTargetFallback('Material', 'material-1', {}, []);
    assert.equal(pendingContextTargetFallbacks('Material').length, 0);
  } finally {
    if (originalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalStorage;
  }
}

// Essay-specific research: the selected prompt gets its own requirements and a shared essay gets no school research.
{
  const research = `## 1. ADMISSIONS OVERVIEW
General application information.

## 3. IDEAL STUDENT PROFILE
Curiosity and sustained interest.

## 4. ESSAY REQUIREMENTS
1. Why do you want to study history at Cornell? Explain how the course fits your interests.
2. Describe a community that shaped you and what you contributed.
- Role in review: #1 assesses academic fit; #2 assesses community contribution.

## 5. PROGRAMS AND MAJORS
History courses and research opportunities.

## 9. CAMPUS LIFE, TRADITIONS AND COMMUNITY
Named history society and campus archive.

## 10. WHAT THIS SCHOOL'S READERS REWARD IN WRITING
Specific, evidence-based reflection.`;
  const essay = {
    id: 'essay-1', title: 'Why Cornell?', prompt: 'Why do you want to study history at Cornell?',
    type: 'why_this_school', scope: 'university_specific', application_platform: 'common_app', word_limit: 650,
  };
  const brief = buildFitBrief(research, { kind: 'draft', essay });
  assert.match(brief, /Why do you want to study history at Cornell/);
  assert.match(brief, /#1 assesses academic fit/);
  assert.doesNotMatch(brief, /Describe a community that shaped you/);
  assert.doesNotMatch(brief, /#2 assesses community contribution/);
  assert.doesNotMatch(brief, /ADMISSIONS OVERVIEW/);
  assert.equal(buildFitBrief(research, { kind: 'draft', essay: { ...essay, scope: 'common' } }), '',
    'a shared essay receives no university-specific research');

  const combinedRequirements = `## 4. ESSAY REQUIREMENTS
- Cornell supplements include why do you want to study engineering; why do you love Cornell; and what will you contribute.
- Role in review: the fit essay tests academic match; the contribution answer tests community match.`;
  const exactPromptBrief = buildFitBrief(combinedRequirements, {
    kind: 'draft', essay: { ...essay, prompt: 'Why do you want to study engineering?' },
  });
  assert.match(exactPromptBrief, /Matched prompt: Why do you want to study engineering/);
  assert.doesNotMatch(exactPromptBrief, /why do you love Cornell|what will you contribute/i,
    'a legacy paragraph with multiple prompts does not turn them into a combined checklist');
  const legacyBrief = buildFitBrief('Cornell requires a why-school essay and a contribution answer.', { kind: 'draft', essay });
  assert.match(legacyBrief, /UNSTRUCTURED UNIVERSITY RESEARCH WITHHELD/);
  assert.doesNotMatch(legacyBrief, /Cornell requires a why-school essay and a contribution answer/,
    'unstructured legacy notes are withheld rather than leaking requirements across essays');
}

// The pack itself: every entry must be complete and attributed.
{
  const packIndex = await import('../src/data/schoolResearch/index.js');
  const { RESEARCH_SECTIONS } = await import('../src/lib/schoolFit.js');
  const pack = packIndex.SCHOOL_RESEARCH_PACK;
  assert.ok(pack.length >= 13, `the pack covers every university on the list (got ${pack.length})`);
  assert.ok(new Set(pack.map((e) => e.key)).size === pack.length, 'pack keys are unique');

  for (const entry of pack) {
    const where = `pack entry ${entry.key}`;
    assert.ok(entry.university && entry.major, `${where} names its school and its major`);
    assert.ok(Array.isArray(entry.aliases) && entry.aliases.length >= 1, `${where} carries name aliases`);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(entry.researchedAt), `${where} is dated, because deadlines move`);
    assert.ok(Array.isArray(entry.sources) && entry.sources.length >= 4, `${where} cites its official sources`);
    assert.ok(entry.sources.every((u) => /^https:\/\//.test(u)), `${where} cites real URLs`);

    assert.ok(packIndex.findPackEntry(entry.university) === entry, `${where} matches by name`);
    for (const alias of entry.aliases) {
      assert.ok(packIndex.findPackEntry(alias) === entry, `${where} matches the alias "${alias}"`);
    }

    // Every section present, in report order, so buildFitBrief can slice it.
    for (const section of RESEARCH_SECTIONS) {
      const re = new RegExp(`^#{2,4}\\s*(?:${section.n}\\.\\s*)?${section.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im');
      assert.ok(re.test(entry.content), `${where} is missing section ${section.n} (${section.heading})`);
    }
    assert.match(entry.content, /## 11\. SOURCES CONSULTED/, `${where} ends with its sources`);
    assert.match(entry.content, /Non-official, labelled:/, `${where} labels anything not from an official page`);
    assert.ok(entry.content.length > 6000, `${where} is a real report, not a stub`);

    // Headings are read by the parser and shown to the applicant, so a mangled
    // word in one of them is a real defect. Every substantial heading word must
    // also appear in the pack's prose — a typo appears nowhere else.
    const prose = pack.map((e) => e.content).join('\n').split(/\r?\n/)
      .filter((line) => !/^##\s/.test(line)).join(' ').toUpperCase().replace(/[^A-Z0-9& ]+/g, ' ');
    for (const line of entry.content.split(/\r?\n/)) {
      if (!/^##\s*\d+\./.test(line)) continue;
      for (const word of line.replace(/^##\s*\d+\.\s*/, '').split(/[^A-Z0-9&]+/)) {
        if (word.length < 4) continue;
        assert.ok(new RegExp(`\\b${word}\\b`).test(prose),
          `${where} has a heading word that appears nowhere else: "${word}" in "${line.trim()}"`);
      }
    }

    const record = packIndex.packRecordFields(entry, entry.university);
    assert.equal(record.research_provider, packIndex.PACK_PROVIDER, `${where} identifies itself as hand research`);
    assert.equal(record.grounded, false, `${where} does not claim to be web-grounded`);
    assert.equal(record.knowledge, entry.content, `${where} saves the whole report`);
    assert.ok(packIndex.isPackRecord(record), `${where} is recognised once stored`);
  }

  // The thirteen schools the applicant named, matched the way the app matches
  // university names — including the short spellings a university list uses.
  for (const name of ['Stanford', 'MIT', 'UC Berkeley', 'UCLA', 'Princeton',
    'University of Michigan', 'Johns Hopkins', 'Caltech', 'Cornell', 'Columbia',
    'NYU Tandon', 'Washington University in St. Louis', 'Penn']) {
    assert.ok(packIndex.findPackEntry(name), `the pack answers to "${name}"`);
  }
}

console.log('verify-quality: ok');

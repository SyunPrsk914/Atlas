// Checks for the background-work layer and the applicant's control surfaces
// added with it: the task ledger that outlives a page, the essay edit
// instructions and the check that they were carried out, the activity
// keywords / ratings / ordering, drag-and-drop reordering, and the
// knowledge-base maintenance rules (item-by-item refresh, material sections
// that survive a rebuild, the person-first filter).
//
// Behavioural where a helper exists; textual where the rule lives in a page
// (a page is not importable here, so the check reads its source).
//
// Run with: node --import ./scripts/register-ext.mjs scripts/verify-background.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  startBackgroundTask, subscribeBackgroundTasks, listTasks, taskForEssay, findRunningTask, isKnowledgeBusy,
  describeStage, _resetBackgroundTasks,
} from '../src/lib/backgroundTasks.js';
import { moveItem } from '../src/hooks/use-drag-reorder.js';
import {
  buildActivityPolishPrompt, buildActivitySuggestPrompt, buildActivityListReviewPrompt,
  ACTIVITY_LIST_SCHEMA, ACTIVITY_RATING_RUBRIC, activityKeywordsBrief, sanitizeActivitySuggestion,
} from '../src/lib/activityPrompts.js';
import { formatActivities } from '../src/lib/profileContext.js';
import {
  splitEditInstructions, editInstructionsBrief, buildPolishPrompt, buildGeneratePrompt, POLISH_SCHEMA,
} from '../src/lib/essayPrompts.js';
import { classifyInstruction, checkInstructionsFollowed, instructionsBrief } from '../src/lib/essayEditCheck.js';
import {
  looksLikeMechanicsDump, looksLikeFactDump, knowledgeStatus, rebuildApplicantKnowledge, refreshApplicantKnowledge,
  materialsNeedingDissection, staleDissectionRows, buildRefreshPrompt, PERSON_FOCUS_RULES, dissectMaterialKnowledge,
} from '../src/lib/applicantKnowledge.js';

let passed = 0;

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`\n✗ ${name}\n  ${error.message}`);
    process.exitCode = 1;
  }
}

const src = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------
await check('a background task is listed while it runs and settles with its result', async () => {
  _resetBackgroundTasks();
  const seen = [];
  const stop = subscribeBackgroundTasks((task) => seen.push(`${task.state}:${task.stage}`));
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { id, promise } = startBackgroundTask({
    kind: 'essay', label: 'Writing a draft', scope: { essayId: 'e1' }, stage: 'generate',
    run: async ({ setStage }) => { await gate; setStage('review'); return { score: 7 }; },
  });
  assert.ok(id);
  assert.equal(listTasks({ running: true }).length, 1, 'the task is listed while running');
  assert.equal(taskForEssay('e1')?.id, id, 'the essay it locks can be looked up');
  assert.equal(taskForEssay('e2'), null, 'other essays are not locked');
  assert.ok(findRunningTask((task) => task.kind === 'essay'));
  assert.equal(isKnowledgeBusy(), false);
  release();
  const result = await promise;
  assert.deepEqual(result, { score: 7 });
  await tick();
  assert.equal(taskForEssay('e1'), null, 'a settled task locks nothing');
  assert.ok(seen.includes('running:generate') && seen.includes('running:review') && seen.includes('done:review'), seen.join(','));
  stop();
  _resetBackgroundTasks();
});

await check('a failing task is recorded as failed and never surfaces as an unhandled rejection', async () => {
  _resetBackgroundTasks();
  const { promise } = startBackgroundTask({ kind: 'knowledge', label: 'Refresh', stage: 'refresh', run: async () => { throw new Error('model down'); } });
  assert.equal(isKnowledgeBusy(), true, 'a knowledge task counts as knowledge work');
  await assert.rejects(promise, /model down/);
  await tick();
  const [task] = listTasks();
  assert.equal(task.state, 'failed');
  assert.equal(task.error.message, 'model down');
  assert.equal(isKnowledgeBusy(), false);
  _resetBackgroundTasks();
});

await check('every stage the app uses has human wording', () => {
  for (const stage of ['generate', 'review', 'polish', 'rebuild', 'refresh', 'dissect', 'extend', 'application', 'suggest', 'activity_polish']) {
    assert.notEqual(describeStage(stage), describeStage('nonsense'), `${stage} falls back to the generic label`);
  }
});

await check('the pages run their AI work through the ledger instead of page state', () => {
  const essay = src('src/pages/EssayBuilder.jsx');
  assert.match(essay, /startBackgroundTask|runEssayTask/, 'essay jobs are not background tasks');
  assert.match(essay, /taskForEssay/, 'the builder does not lock only the essay being worked on');
  assert.match(essay, /edit_instructions/, 'there is no edit-instructions field');
  assert.match(essay, /checkInstructionsFollowed/, 'edits are not checked against the instructions');
  assert.match(essay, /getAutoRestoreWorseEdit|autoRestoreWorse/, 'a worse edit is not restored automatically');
  assert.match(src('src/pages/ApplicationReview.jsx'), /startBackgroundTask/, 'the full review still blocks its page');
  assert.match(src('src/components/profile/ActivityAiPanel.jsx'), /startBackgroundTask/, 'activity AI still blocks its page');
  assert.match(src('src/pages/AiKnowledge.jsx'), /startKnowledgeRefresh/, 'the knowledge page has no item-by-item refresh');
  assert.match(src('src/components/Layout.jsx'), /BackgroundTasksPill/, 'running work is not shown in the shell');
  assert.match(src('src/components/Layout.jsx'), /startKnowledgeAutoRefresh/, 'the automatic knowledge update is never started');
});

// ---------------------------------------------------------------------------
// Reordering
// ---------------------------------------------------------------------------
await check('moveItem moves one item to any slot and refuses impossible moves without losing an entry', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveItem(list, 0, 3), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveItem(list, 3, 0), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveItem(list, 1, 2), ['a', 'c', 'b', 'd']);
  assert.deepEqual(moveItem(list, 2, 2), list);
  assert.deepEqual(moveItem(list, 5, 0), list, 'an out-of-range source changes nothing');
  assert.deepEqual(moveItem(list, 0, -1), list, 'an out-of-range target changes nothing');
  assert.notEqual(moveItem(list, 0, 1), list, 'a new array is returned, never the input mutated');
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
});

await check('activities and university cards are draggable, with the arrows kept for keyboards', () => {
  const editor = src('src/components/profile/ActivitiesEditor.jsx');
  assert.match(editor, /useDragReorder/);
  assert.match(editor, /ArrowUp/);
  assert.match(editor, /ArrowDown/);
  assert.match(editor, /keywords/, 'there is no per-activity keywords field');
  const universities = src('src/pages/Universities.jsx');
  assert.match(universities, /useDragReorder/);
  assert.match(universities, /reorderUniversities\(/);
  assert.match(universities, /draggable=\{false\}/, 'the card link would start its own drag');
});

// ---------------------------------------------------------------------------
// Activities: keywords, ratings, order
// ---------------------------------------------------------------------------
const activity = { position: 'Captain', organization: 'Robotics club', description: 'Led the team.', keywords: 'grew from 6 to 22 members; regional final 2025; built the drivetrain' };

await check('the sharpen prompt builds on the applicant\'s keywords and still forbids invention', () => {
  const prompt = buildActivityPolishPrompt({ activity, index: 0, activities: [activity] });
  assert.match(prompt, /OWN KEYWORDS/);
  assert.match(prompt, /grew from 6 to 22 members/);
  assert.match(prompt, /invent/);
  assert.match(prompt, /missing_facts/);
  assert.match(prompt, /verb/);
  assert.equal(activityKeywordsBrief({ keywords: '   ' }), '', 'blank keywords add nothing');
  assert.ok(!buildActivityPolishPrompt({ activity: { position: 'x' } }).includes('OWN KEYWORDS'));
});

await check('the suggest prompt reads the applicant\'s hints first and demands evidence for every entry', () => {
  const prompt = buildActivitySuggestPrompt({ activities: [activity], hints: 'night shifts at the family bakery since grade 10' });
  assert.match(prompt, /KEYWORDS FOR WHAT IS MISSING/);
  assert.match(prompt, /night shifts at the family bakery/);
  assert.match(prompt, /applicant's notes: grew from 6 to 22 members/, 'existing entries carry their keywords');
  assert.match(prompt, /evidence/);
  assert.match(prompt, /NEVER invent/);
  assert.ok(!buildActivitySuggestPrompt({ activities: [] }).includes('KEYWORDS FOR WHAT IS MISSING'));
});

await check('the list review rates every entry, reads the order as submitted, and returns a list score', () => {
  const prompt = buildActivityListReviewPrompt({ activities: [activity, { position: 'Member', organization: 'Choir' }], applicantText: 'Someone who fixes what others abandon.' });
  assert.match(prompt, /RATING EACH ENTRY/);
  assert.ok(prompt.includes(ACTIVITY_RATING_RUBRIC));
  assert.match(prompt, /slot 1 is read first/i);
  assert.match(prompt, /ORDER, FIRST/);
  assert.match(prompt, /"ratings"/);
  assert.match(prompt, /"list_score"/);
  assert.match(prompt, /"ordering_rationale"/);
  assert.match(prompt, /WHAT ATLAS KNOWS ABOUT THIS APPLICANT/);
  assert.match(prompt, /Applicant's private notes/);
  assert.match(prompt, /redundant|overlap/i);
  assert.ok(ACTIVITY_LIST_SCHEMA.properties.ratings, 'the schema has no ratings');
  assert.ok(ACTIVITY_LIST_SCHEMA.properties.list_score);
  assert.ok(ACTIVITY_LIST_SCHEMA.properties.ordering_rationale);
});

await check('keywords never leave the applicant\'s side: not in a sanitized suggestion, but in the profile context', () => {
  const cleaned = sanitizeActivitySuggestion({ ...activity, description: 'Grew club from 6 to 22 members; built drivetrain; reached 2025 regional final' });
  assert.equal('keywords' in cleaned.activity, false, 'the model answer must not carry a keywords field into the form');
  const text = formatActivities([activity]);
  assert.match(text, /private notes[^\n]*grew from 6 to 22 members/, 'the knowledge base and essay writer never see the keywords');
  assert.ok(!formatActivities([{ position: 'x' }]).includes('private notes'));
});

// ---------------------------------------------------------------------------
// Essay edit instructions
// ---------------------------------------------------------------------------
const INSTRUCTIONS = `- Cut the sentence "my passion for science".
Keep "the smell of solder" exactly as it is.
2) Replace "very big" with "forty-metre"
Add a line about my grandmother in the last paragraph.`;

await check('edit instructions split into sentences without breaking a quoted phrase', () => {
  const items = splitEditInstructions(INSTRUCTIONS);
  assert.equal(items.length, 4, items.join(' | '));
  assert.equal(items[0], 'Cut the sentence "my passion for science".');
  assert.equal(items[2], 'Replace "very big" with "forty-metre"');
  assert.deepEqual(splitEditInstructions('  \n\n'), []);
  assert.deepEqual(splitEditInstructions('Keep "Dr. Ito" in.'), ['Keep "Dr. Ito" in.'], 'an abbreviation inside quotes is not a sentence break');
});

await check('each instruction is classified by what it asks for', () => {
  assert.equal(classifyInstruction('Cut the sentence "my passion for science".').kind, 'remove');
  assert.equal(classifyInstruction('Keep "the smell of solder" exactly as it is.').kind, 'keep');
  assert.equal(classifyInstruction('Replace "very big" with "forty-metre"').kind, 'replace');
  assert.equal(classifyInstruction('Add a line about my grandmother in the last paragraph.').kind, 'other');
  assert.equal(classifyInstruction('Add "Obaachan" to the last paragraph.').kind, 'add');
});

await check('the instructions are binding in the prompt, ranked under the root and above the review', () => {
  const brief = editInstructionsBrief(INSTRUCTIONS);
  assert.match(brief, /binding/);
  assert.match(brief, /\(1\) the required root above, \(2\) these instructions/);
  assert.match(brief, /instructions_not_followed/);
  assert.match(brief, /Do not "interpret" an instruction into something easier/);
  assert.equal(editInstructionsBrief(''), '');
  const essay = { title: 'Why us', content: 'My passion for science is very big. The smell of solder.', word_limit: 650, prompt: 'Why us?' };
  const polish = buildPolishPrompt({ essay, platform: 'common_app', reviewResult: { overall_score: 6, findings: [] }, knowledgeText: '', allEssays: [essay], editInstructions: INSTRUCTIONS });
  assert.match(polish, /APPLICANT'S EDIT INSTRUCTIONS/);
  assert.match(polish, /improvement_claim/, 'the editor is never asked to say how the edit is better');
  assert.ok(POLISH_SCHEMA.properties.instructions_followed && POLISH_SCHEMA.properties.instructions_not_followed && POLISH_SCHEMA.properties.improvement_claim);
  const followUp = buildPolishPrompt({ essay, platform: 'common_app', reviewResult: { overall_score: 6, findings: [] }, knowledgeText: '', allEssays: [essay], editInstructions: INSTRUCTIONS, focusInstructions: ['Cut the sentence "my passion for science".'] });
  assert.match(followUp, /Cut the sentence "my passion for science"/);
  assert.ok(followUp.length > 0 && followUp !== polish, 'a follow-up names the missed instructions');
  const generate = buildGeneratePrompt({ essay, platform: 'common_app', knowledgeText: '', allEssays: [essay], editInstructions: INSTRUCTIONS });
  assert.match(generate, /APPLICANT'S EDIT INSTRUCTIONS/, 'a first draft ignores the instructions');
});

await check('an instruction the editor skipped is caught from the text, not from its report', () => {
  const before = 'My passion for science is very big. The smell of solder stays with me.';
  const kept = 'The smell of solder stays with me. My robot was forty-metre long.';
  const result = checkInstructionsFollowed(splitEditInstructions(INSTRUCTIONS), before, kept, {
    instructions_followed: [{ instruction: 'Cut the sentence "my passion for science".', how: 'removed' }],
  });
  assert.equal(result.total, 4);
  const byText = Object.fromEntries(result.items.map((item) => [item.instruction, item.status]));
  assert.equal(byText['Cut the sentence "my passion for science".'], 'done');
  assert.equal(byText['Keep "the smell of solder" exactly as it is.'], 'done');
  assert.equal(byText['Replace "very big" with "forty-metre"'], 'done');
  assert.equal(byText['Add a line about my grandmother in the last paragraph.'], 'unverified', 'an unquoted instruction is reported, not asserted');
  assert.equal(result.missed, 0);

  const lazy = 'My passion for science is very big. The smell of solder stays with me.';
  const missed = checkInstructionsFollowed(splitEditInstructions(INSTRUCTIONS), before, lazy, {
    instructions_followed: [{ instruction: 'Cut the sentence "my passion for science".', how: 'done' }],
  });
  assert.ok(missed.missed >= 2, `the untouched draft must be caught: ${JSON.stringify(missed.items)}`);
  assert.match(missed.message, /not carried out/);
  assert.match(instructionsBrief(missed), /not carried out|missed|instruction/i);
  const empty = checkInstructionsFollowed([], before, kept, {});
  assert.equal(empty.hadNothing, true);
});

// ---------------------------------------------------------------------------
// Knowledge base: person first, refresh not rebuild, sections survive
// ---------------------------------------------------------------------------
await check('an assessment-mechanics item is flagged and a person-focused one is not', () => {
  assert.ok(looksLikeMechanicsDump('In the Physics IA, the applicant annotates Trial 21 as an outlier and recalculates the gradient.'));
  assert.ok(looksLikeMechanicsDump('Achieved 34/40 on the chemistry data table and plotted error bars.'));
  assert.ok(!looksLikeMechanicsDump('Someone who re-ran the experiment because a result that looked too good made them uneasy, and said so in the write-up.'));
  assert.ok(!looksLikeMechanicsDump('Values being useful over being noticed: took the unglamorous treasurer job and kept it for three years.'));
  assert.match(PERSON_FOCUS_RULES, /PERSON FIRST/);
  const refresh = buildRefreshPrompt({ inputs: { profileText: '', ownText: '', essayText: '', sampleText: '', guidanceText: '' }, numbered: '1. [brief/personality] [CHECK] Trial 21 outlier', manualText: '', limits: { about: { max: 1 }, points: { max: 1 }, patterns: { max: 1 }, guidance: { max: 1 } } });
  assert.match(refresh, /ITEM BY ITEM/);
  assert.match(refresh, /keep — /);
  assert.match(refresh, /revise — /);
  assert.match(refresh, /remove — /);
  assert.match(refresh, /Keep the whole base compact/);
});

const rowsWithSections = [
  { id: 'p1', kind: 'brief', category: 'personality', text: 'Old portrait item.', origin: 'ai', data: { fingerprint: 'old', built_at: '2026-01-01' } },
  { id: 's1', kind: 'guidance', category: 'requirement', text: 'Stanford wants the roommate essay to sound like a letter.', origin: 'ai', source_id: 'm1', data: { dissected: true, dissection_key: 'k1', section: 'Stanford — roommate', fingerprint: null } },
  { id: 'u1', kind: 'evidence', category: 'experience', text: 'Written by the applicant.', origin: 'manual', data: {} },
];

await check('a rebuild replaces the portrait but keeps filed sections and the applicant\'s own items', async () => {
  const deleted = [];
  const created = [];
  const outcome = await rebuildApplicantKnowledge({
    inputs: { empty: false, profileText: 'profile', ownText: '', essayText: '', sampleText: '', guidanceText: '', fingerprint: 'new', counts: { profile: 1 } },
    existingRows: rowsWithSections,
    runAI: async () => ({ result: { about: [{ category: 'personality', text: 'Someone who finishes what others abandon, because an unfinished thing bothers them more than a hard one.' }], points: [{ category: 'experience', text: 'Rebuilt the school garden pump over one winter; three beds back in use by spring.' }] } }),
    isLive: () => true,
    createRows: async (items) => { created.push(...items); return items; },
    deleteRow: async (id) => { deleted.push(id); },
  });
  assert.ok(created.length >= 1);
  assert.deepEqual(deleted, ['p1'], `only the old portrait item goes: ${deleted.join(',')}`);
  assert.equal(outcome.counts.brief, 1);
});

await check('knowledge status counts flagged portrait items only, and stale means any fingerprint differs', () => {
  const status = knowledgeStatus([
    ...rowsWithSections,
    { id: 'f1', kind: 'evidence', category: 'experience', text: 'Trial 21 is an outlier in the data table.', origin: 'ai', data: { fingerprint: 'new' } },
    { id: 'f2', kind: 'evidence', category: 'experience', text: 'Trial 3 outlier.', origin: 'ai', source_id: 'm1', data: { dissected: true, dissection_key: 'k1', fingerprint: null } },
  ], 'new');
  assert.equal(status.flagged, 1, 'a filed section follows its material, not the refresh');
  assert.equal(status.dissected, 2);
  assert.equal(status.stale, true);
  assert.equal(knowledgeStatus(rowsWithSections.filter((row) => row.id !== 'p1'), 'x').stale, false, 'sections alone never make the base stale');
});

await check('a refresh re-examines items one by one: revise and remove by number, never the applicant\'s own items', async () => {
  const updates = [];
  const deleted = [];
  const created = [];
  const rows = [
    { id: 'a', kind: 'brief', category: 'personality', text: 'In the Physics IA, annotates Trial 21 as an outlier.', origin: 'ai', data: { fingerprint: 'old' } },
    { id: 'b', kind: 'brief', category: 'mindset', text: 'Would rather be useful than noticed.', origin: 'ai', data: { fingerprint: 'old' } },
    { id: 'c', kind: 'evidence', category: 'experience', text: 'Duplicate of b.', origin: 'ai', data: { fingerprint: 'old' } },
    { id: 'm', kind: 'brief', category: 'personality', text: 'Manual item.', origin: 'manual', data: {} },
    ...rowsWithSections.filter((row) => row.id === 's1'),
  ];
  const outcome = await refreshApplicantKnowledge({
    inputs: { empty: false, profileText: 'profile', ownText: '', essayText: '', sampleText: '', guidanceText: '', fingerprint: 'new', counts: { profile: 1 } },
    existingRows: rows,
    runAI: async ({ prompt }) => {
      assert.ok(!prompt.includes('4. [brief/personality] Manual item'), 'manual items are never numbered for decisions');
      assert.ok(!/\d+\. \[guidance\/requirement\][^\n]*Stanford/.test(prompt), 'filed sections are not re-examined by the portrait refresh');
      return { result: { decisions: [
        { item: 1, action: 'revise', text: 'Someone who distrusts a result that looks too clean: re-ran the trial that broke the pattern instead of deleting it, because being right mattered more than a tidy graph.', reason: 'mechanics' },
        { item: 3, action: 'remove', reason: 'duplicate of 2' },
        { item: 4, action: 'remove', reason: 'out of range' },
      ], additions: {} } };
    },
    isLive: () => true,
    createRows: async (items) => { created.push(...items); return items; },
    updateRow: async (id, patch) => { updates.push([id, patch]); return { id, ...patch }; },
    deleteRow: async (id) => { deleted.push(id); },
  });
  assert.equal(outcome.counts.revised, 1);
  assert.equal(outcome.counts.removed, 1);
  assert.deepEqual(deleted, ['c']);
  assert.ok(updates.some(([id, patch]) => id === 'a' && /distrusts a result/.test(patch.text)), 'the flagged item was rewritten in place');
  assert.ok(updates.some(([id, patch]) => id === 'b' && patch.data?.fingerprint === 'new'), 'kept items are re-stamped so the base stops reading as stale');
  assert.ok(!updates.some(([id]) => id === 'm') && !deleted.includes('m'), 'the applicant\'s own item was untouched');
  assert.equal(created.length, 0);
});

await check('materials are filed once per version, and a deleted material\'s sections are found as orphans', () => {
  const material = { id: 'm1', title: 'Stanford application', type: 'reference', analysis_role: 'application_reference', content: 'x'.repeat(900), notes: '' };
  const key = (rows) => rows.find((row) => row.source_id === 'm1')?.data?.dissection_key;
  const pending = materialsNeedingDissection([material], []);
  assert.equal(pending.length, 1, 'a long, unfiled material needs dissection');
  const filed = [{ id: 's', origin: 'ai', kind: 'guidance', source_id: 'm1', data: { dissected: true, dissection_key: null } }];
  assert.equal(materialsNeedingDissection([material], filed).length, 1, 'a row with another key does not count as filed');
  const orphans = staleDissectionRows([], rowsWithSections);
  assert.deepEqual(orphans.map((row) => row.id), ['s1']);
  assert.equal(key(rowsWithSections), 'k1');
});

await check('the knowledge page edits in place and updates itself; nothing is rebuilt by default', () => {
  const page = src('src/pages/AiKnowledge.jsx');
  assert.match(page, /handleRefresh/);
  assert.match(page, /getKnowledgeAutoUpdate|setKnowledgeAutoUpdate/, 'automatic updates cannot be switched');
  assert.match(page, /runKnowledgeMaintenance/, 'there is no "Update now"');
  assert.match(page, /window\.confirm\(/, 'a rebuild can be started without a warning');
  assert.match(page, /looksLikeMechanicsDump/, 'mechanics items are not marked for the applicant');
  assert.match(page, /filedSections/, 'filed sections are not shown by material');
  assert.match(page, /ApplicantQuestionsPanel/, 'the Q&A panel is not mounted on the knowledge base page');
  assert.match(page, /looksLikeMechanicsDump\(item\.text, item\.kind\)/, 'the flag check ignores the kind, so fact lists slip through');
  assert.match(page, /c\.moved/, 'items the refresh re-files are not reported');
  const profile = src('src/pages/Profile.jsx');
  assert.match(profile, /HonorsAiPanel/, 'honors sharpening is not wired');
  assert.match(profile, /setHonorSharpenIndex\(index\)/, 'the honor rows cannot start a sharpen');
  const auto = src('src/lib/knowledgeAutoRefresh.js');
  assert.match(auto, /startKnowledgeRefresh/, 'the automatic pass must refresh, not rebuild, a built base');
  assert.match(auto, /needsPortrait \? |startKnowledgeRebuild\(\{ owner: 'auto' \}\)/, 'a first build is allowed only when nothing is built');
  assert.match(auto, /userWorkRunning/, 'the automatic pass would queue in front of the applicant\'s own work');
  assert.match(auto, /hasLiveModel/, 'demo output could be saved as knowledge');
  for (const file of ['src/pages/Profile.jsx', 'src/pages/Materials.jsx']) {
    assert.match(src(file), /scheduleKnowledgeAutoRefresh/, `${file} saves without telling the knowledge base`);
  }
});


// ---------------------------------------------------------------------------
// The fact list that pretends to be personality: flag it, and let Refresh
// re-file it instead of destroying it.
// ---------------------------------------------------------------------------
const FACT_LIST = "Achieved a specific impulse of 210 seconds using L-menthol as propellant in the microwave discharge plasma thruster built during the Kyushu University research placement, a quantitative result explicitly named in both the Common App essay context and the UCAS academic preparation draft.";

await check('a quantified achievement in ABOUT YOU is flagged; the same line in PERSONAL POINTS is not', () => {
  assert.ok(looksLikeFactDump(FACT_LIST), "the applicant's exact complaint — a fact list, not a personality");
  assert.ok(looksLikeMechanicsDump(FACT_LIST, 'brief'), 'the portrait panel does not mark it');
  assert.ok(!looksLikeMechanicsDump(FACT_LIST, 'evidence'), 'quantified facts are exactly what Personal points is for');
  assert.ok(!looksLikeMechanicsDump('He returned to the thruster because a number he had not measured himself felt like wearing someone else\'s coat; the 210 seconds were the first result that was his.', 'brief'), 'the rewrite is a portrait, not a fact list');
  assert.match(PERSON_FOCUS_RULES, /filing mistake/, 'the standard does not name the fact-list failure');
  assert.match(PERSON_FOCUS_RULES, /PERSONAL POINTS/, 'the standard does not say where the fact belongs');
});

await check('a refresh can move an item to the section it belongs in — without losing evidence', async () => {
  const rows = [
    { id: 'a', kind: 'brief', category: 'personality', text: 'Achieved 210 seconds of specific impulse on the bench thruster.', origin: 'ai', source_label: 'Built from your profile and materials', data: { fingerprint: 'old' } },
    { id: 'b', kind: 'brief', category: 'mindset', text: 'Someone who would rather be useful than noticed and keeps the treasurer job for three years.', origin: 'ai', data: { fingerprint: 'old' } },
    { id: 'c', kind: 'evidence', category: 'experience', text: 'Would rather be useful than noticed: stayed treasurer three years after the club folded.', origin: 'ai', data: { fingerprint: 'old' } },
  ];
  const created = [];
  const deleted = [];
  const updates = [];
  const outcome = await refreshApplicantKnowledge({
    inputs: { empty: false, profileText: 'profile', ownText: '', essayText: '', sampleText: '', guidanceText: '', fingerprint: 'new', counts: { profile: 1 } },
    existingRows: rows,
    runAI: async ({ prompt }) => {
      assert.match(prompt, /move — /, 'the refresh never offers to re-file an item');
      assert.match(prompt, /prefer moving to removing/, 'removal is not framed as the last resort behind moving');
      return { result: { decisions: [
        { item: 1, action: 'move', to: 'points', category: 'achievement', text: 'Achieved 210 seconds of specific impulse on the bench thruster (Kyushu University placement).', reason: 'a quantified result, not personality' },
        { item: 2, action: 'move', to: 'points', text: 'Someone who would rather be useful than noticed and keeps the treasurer job for three years.', reason: 'also fact-ish' },
      ], additions: {} } };
    },
    isLive: () => true,
    createRows: async (items) => { created.push(...items); return items; },
    updateRow: async (id, patch) => { updates.push([id, patch]); return { id, ...patch }; },
    deleteRow: async (id) => { deleted.push(id); },
  });
  assert.equal(created.length, 1, 'the destination row is written once');
  assert.equal(created[0].kind, 'evidence');
  assert.equal(created[0].category, 'achievement');
  assert.equal(created[0].data.moved_from, 'brief');
  assert.deepEqual(deleted, ['a'], 'the original goes only after its destination copy exists');
  assert.equal(outcome.counts.moved, 1);
  assert.ok(outcome.warnings.some((w) => /already covers it/.test(w)), 'a move into a section that already says it must be reported as skipped');
  assert.ok(!deleted.includes('b'), 'a skipped move keeps the original intact');
});

await check('a dissection never files the applicant\'s own story under one school, but does file that school\'s guide', async () => {
  const created = [];
  const material = { id: 'm1', title: 'My past essays', type: 'essay', content: 'x'.repeat(900), notes: '', analysis: null };
  const outcome = await dissectMaterialKnowledge({
    material,
    existingRows: [],
    universities: [{ id: 'stan', name: 'Stanford' }],
    essays: [],
    runAI: async ({ prompt }) => {
      assert.match(prompt, /NEVER name a school for the applicant's own story/);
      return { result: { sections: [
        { section: 'Personal statement on the thruster', school: 'Stanford', essay_kind: 'personal_statement', platform: '', audience: 'own', items: [
          { category: 'mindset', text: 'Syun keeps returning to machines he can measure: he rebuilt the chamber twice because the first answer felt borrowed.' },
        ] },
        { section: 'Stanford — the why-us essay', school: 'Stanford', essay_kind: 'why_us', platform: '', audience: 'guide', items: [
          { category: 'writing_principle', text: 'Name one lab, one professor, one reason — this school rewards specificity over admiration.' },
        ] },
      ] } };
    },
    isLive: () => true,
    createRows: async (items) => { created.push(...items); return items; },
    deleteRow: async () => {},
  });
  assert.equal(outcome.rows, 2);
  const own = created.find((row) => row.data.audience === 'own');
  const guide = created.find((row) => row.data.audience === 'guide');
  assert.ok(!own.target_university_id, 'the applicant\'s own life was bound to one university — it must belong to every application');
  assert.equal(guide.target_university_id, 'stan', 'a school\'s own guide keeps its school binding');
  assert.equal(own.kind, 'brief', 'a mindset item from an own section still lands in the portrait');
});

await check('unsaved profile edits are kept in this browser until they are saved', () => {
  const page = src('src/pages/Profile.jsx');
  assert.match(page, /profileDraft/);
  assert.match(page, /Restore my edits/);
  assert.match(page, /removeStored\(DRAFT_KEY\)/, 'a saved profile would keep offering an old draft');
});

console.log(`verify-background: ok (${passed} checks)`);
if (process.exitCode) process.exit(1);

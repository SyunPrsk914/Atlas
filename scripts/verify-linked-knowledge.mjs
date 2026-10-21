// Deep-linking checks: the knowledge base must know WHERE each item belongs, the
// editor must be held to the conservation contract it was given, and re-examining
// a material must queue instead of blocking.
//
// These are the behaviours the applicant asked for in place of new interface copy:
//   - an item is filed with the part of the material it came from, and a school or
//     a course named in passing never becomes the document's subject;
//   - two facts sitting next to each other never become a cause;
//   - a craft rule or a pattern is read only by the kind of writing it governs;
//   - an edit that replaces the draft instead of polishing it is sent back and then
//     refused, not measured and reported;
//   - an applicant instruction is never "declined" and left as an answer;
//   - a review never deducts for a line the applicant has since cut.
//
// Run: node --import ./scripts/register-ext.mjs scripts/verify-linked-knowledge.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (file) => readFileSync(join(root, file), 'utf8');

let passed = 0;
const checks = [];
const check = (name, fn) => checks.push([name, fn]);

const words = (n, offset = 0) => Array.from({ length: n }, (_, i) => `word${i + offset + 1}`).join(' ');

// ---------------------------------------------------------------------------
// 1. The dissection files an item with its own context, not with a mention
// ---------------------------------------------------------------------------
import {
  buildDissectionPrompt, dissectMaterialKnowledge, appliesToKeys, applicantKnowledgeForPrompt,
  normalizePatterns, normalizeGuidance, knowledgeRowsFor, ESSAY_KINDS,
} from '../src/lib/applicantKnowledge.js';

await check('the dissection is told what a document is about, and never to invent a link', () => {
  const prompt = buildDissectionPrompt({
    material: { id: 'm', title: 'My old essays', type: 'essay', notes: '', content: 'x'.repeat(900) },
    text: 'BODY',
    universities: [{ id: 'stan', name: 'Stanford' }],
    essays: [],
  });
  assert.match(prompt, /A title, one school name, and one passing mention are not subjects/);
  assert.match(prompt, /EARN EVERY LINK/);
  assert.match(prompt, /where the source keeps two facts apart, file them apart/);
  assert.match(prompt, /A section describes only its own part of the material/);
  assert.match(prompt, /"evidence" is what this item rests on/);
  assert.match(prompt, /still give the section its real name/);
  // The older guarantees are still in the same brief.
  assert.match(prompt, /NEVER name a school for the applicant's own story/);
  assert.match(prompt, /is platform- or kind-level, never school-level/);
});

await check('a personal insight keeps its section name and reaches every application', async () => {
  const created = [];
  const material = { id: 'm1', title: 'My past essays', type: 'essay', content: 'x'.repeat(900), notes: '', analysis: null };
  const outcome = await dissectMaterialKnowledge({
    material,
    existingRows: [],
    universities: [{ id: 'stan', name: 'Stanford' }],
    essays: [],
    runAI: async () => ({
      result: {
        sections: [
          {
            section: 'Personal statement on the thruster',
            school: 'Stanford',
            essay_kind: 'personal_statement',
            platform: '',
            audience: 'own',
            items: [{
              category: 'mindset',
              text: 'Syun returns to machines he can measure; he rebuilt the chamber twice because the first answer felt borrowed.',
              evidence: 'I rebuilt the chamber twice. The first number was somebody else’s.',
            }],
          },
          {
            section: 'Stanford — the why-us essay',
            school: 'Stanford',
            essay_kind: 'why_us',
            platform: '',
            audience: 'guide',
            items: [{ category: 'writing_principle', text: 'Name one lab, one professor, one reason.', evidence: 'Admissions can tell a copied list from a visit.' }],
          },
        ],
      },
    }),
    isLive: () => true,
    createRows: async (items) => { created.push(...items); return items; },
    deleteRow: async () => {},
  });
  assert.equal(outcome.rows, 2);
  const own = created.find((row) => row.data.audience === 'own');
  const guide = created.find((row) => row.data.audience === 'guide');
  // Person-first: shared across every application…
  assert.ok(!own.target_university_id && !own.target_platform && !own.target_essay_id, 'the applicant’s life was bound to one school again');
  assert.equal(own.data.shared, true);
  // …but the context survives: the section it was read out of is on the row.
  assert.equal(own.data.section, 'Personal statement on the thruster');
  assert.match(own.source_label, /Personal statement on the thruster/);
  assert.equal(own.kind, 'brief', 'a mindset item from an own section still lands in the portrait');
  assert.match(own.data.evidence, /rebuilt the chamber twice/, 'the source’s own words were dropped');
  assert.equal(guide.target_university_id, 'stan', 'a school’s own guide keeps its school binding');
  assert.deepEqual(guide.data.shape_keys, ['why_us']);
});

// ---------------------------------------------------------------------------
// 2. Craft knowledge is scoped to the kind of writing it governs
// ---------------------------------------------------------------------------
await check('applies_to is kept to the kinds Atlas knows', () => {
  assert.deepEqual(appliesToKeys(['any']), []);
  assert.deepEqual(appliesToKeys(['why_us', 'why_us', 'nonsense', 'Personal Statement']), ['why_us', 'personal_statement']);
  assert.deepEqual(appliesToKeys('community'), ['community']);
  assert.deepEqual(appliesToKeys(null), []);
  assert.ok(appliesToKeys(ESSAY_KINDS).length <= 6, 'a declared scope must stay small enough to be true');
});

await check('a personal-statement rule never reaches a why-us draft', () => {
  const rows = [
    {
      id: 'p1', kind: 'pattern', category: 'opening', origin: 'ai', platform: 'General', text: `Open inside a moment. ${words(20)}`,
      data: { shape_keys: ['personal_statement'] },
    },
    {
      id: 'p2', kind: 'pattern', category: 'judgement', origin: 'ai', platform: 'General', text: `Never claim a lesson the scene has not shown. ${words(20)}`,
      data: {},
    },
  ];
  const whyUs = { id: 'e2', type: 'why_this_school', title: 'Why Stanford', prompt: 'Why are you interested in Stanford University?', word_limit: 150 };
  const ps = { id: 'e1', type: 'personal_statement', title: 'Personal statement', prompt: 'Some have a background…', word_limit: 650 };
  const forWhyUs = applicantKnowledgeForPrompt(rows, { essay: whyUs, essayId: 'e2', essays: [whyUs, ps] });
  const forPs = applicantKnowledgeForPrompt(rows, { essay: ps, essayId: 'e1', essays: [whyUs, ps] });
  assert.ok(!forWhyUs.includes('Open inside a moment'), 'a personal-statement structure rule leaked into a why-us prompt');
  assert.ok(forWhyUs.includes('Never claim a lesson'), 'a universal rule was wrongly withheld');
  assert.ok(forPs.includes('Open inside a moment'), 'the rule its own source wrote it for was withheld');
  // The full application review has no single shape: general craft stays in, and a
  // row lifted out of one material's one section still does not.
  const forReview = applicantKnowledgeForPrompt(rows, { task: 'application' });
  assert.ok(forReview.includes('Open inside a moment'), 'the whole-file review lost its general craft knowledge');
  const dissected = [{ ...rows[0], data: { ...rows[0].data, dissected: true } }];
  assert.ok(!applicantKnowledgeForPrompt(dissected, { task: 'application' }).includes('Open inside a moment'));
});

await check('the rebuild carries the scope and the evidence into the rows', () => {
  const patterns = normalizePatterns({ patterns: [{ category: 'structure', platform: 'US', text: `One story beats a montage. ${words(20)}`, applies_to: ['personal_statement'] }] });
  const guidance = normalizeGuidance({ guidance: [{ category: 'requirement', text: 'UCAS shares 4,000 characters across three answers.', applies_to: ['other'] }] });
  const rows = knowledgeRowsFor({ patterns, guidance }, { fingerprint: 'f', builtAt: 'now', model: 'm' });
  assert.deepEqual(rows.find((row) => row.kind === 'pattern').data.shape_keys, ['personal_statement']);
  assert.deepEqual(rows.find((row) => row.kind === 'guidance').data.shape_keys, ['other']);
  const unscoped = knowledgeRowsFor({ patterns: normalizePatterns({ patterns: [{ category: 'voice', text: `Plain words beat Latinity. ${words(20)}` }] }) }, { fingerprint: 'f', builtAt: 'now' });
  assert.equal(unscoped[0].data.shape_keys, undefined, 'an undeclared scope must not be invented');
});

// ---------------------------------------------------------------------------
// 3. The review: this prompt's shape, and no memory of an earlier draft
// ---------------------------------------------------------------------------
import {
  buildReviewPrompt, buildPolishPrompt, buildGeneratePrompt, siblingEssaysBrief,
  AI_TEMPERATURES, DEEP_THINKING_PROTOCOL,
} from '../src/lib/essayPrompts.js';
import { PRESERVATION_FLOOR } from '../src/lib/textDiff.js';

const essayRow = (over = {}) => ({
  id: 'e1', title: 'Roommate essay', type: 'supplemental', prompt: '', word_limit: 40, content: 'I keep the door propped and the kettle on.',
  university_name: 'Stanford', ...over,
});

await check('a micro question is not scored for lacking a story arc', () => {
  const micro = buildReviewPrompt({
    essay: essayRow({ prompt: 'What would your roommate like to know about you? (max 40 words)', word_limit: 40, content: 'The kettle is always on. Cold nights, warm answers.' }),
    university: { name: 'Stanford' }, platform: 'common_app', knowledgeText: '', allEssays: [],
  });
  assert.match(micro, /Do not require a story arc here/);
  assert.match(micro, /never against a personal statement/i);
  const narrative = buildReviewPrompt({
    essay: essayRow({ type: 'personal_statement', title: 'Personal statement', prompt: 'Background or belief', word_limit: 650, content: `One winter I kept showing up. ${words(300)}` }),
    university: { name: 'Stanford' }, platform: 'common_app', knowledgeText: '', allEssays: [],
  });
  assert.match(narrative, /no coherent through-line/);
  assert.ok(!narrative.includes('Do not require a story arc here'), 'a personal statement lost the arc test');
  // A challenge essay IS a narrative question, so the arc still applies to it.
  const challenge = buildReviewPrompt({
    essay: essayRow({ title: 'Challenge', prompt: 'Describe a challenge you have faced.', word_limit: 250 }),
    platform: 'common_app', knowledgeText: '', allEssays: [],
  });
  assert.match(challenge, /no coherent through-line/);
});

await check('a re-review never charges the applicant for a deletion', () => {
  const prompt = buildReviewPrompt({
    essay: essayRow({ content: 'The kettle is always on.' }),
    platform: 'common_app', knowledgeText: '', allEssays: [],
    previousReview: { overall_score: 7, structure_score: 6, weaknesses: ['“In conclusion” opens the last line'], priority_improvements: [] },
    reviewNotes: 'old notes',
  });
  assert.match(prompt, /There is no earlier draft in the file/);
  assert.match(prompt, /counts as FIXED/);
  assert.match(prompt, /never write a weakness that only makes sense next to a version the admissions reader will never see/);
});

await check('a causal claim the text does not earn is a risk finding', () => {
  const prompt = buildReviewPrompt({ essay: essayRow(), platform: 'common_app', knowledgeText: '', allEssays: [] });
  assert.match(prompt, /Judge a causal claim the text itself does not earn/);
});

// ---------------------------------------------------------------------------
// 4. Drafting and editing: the deep pass, the links, and the contract
// ---------------------------------------------------------------------------
await check('the deep-thinking pass reads the shape of this essay, not a borrowed one', () => {
  assert.match(DEEP_THINKING_PROTOCOL, /READ THE JOB, NOT THE HABIT/);
  assert.match(DEEP_THINKING_PROTOCOL, /is NOT the shape of a 40-word box/);
  assert.match(DEEP_THINKING_PROTOCOL, /THINK IN LINKS, NOT IN LISTS/);
  assert.match(DEEP_THINKING_PROTOCOL, /never declined/);
  const generate = buildGeneratePrompt({
    essay: essayRow(), university: { name: 'Stanford' }, platform: 'common_app',
    profileText: 'P', knowledgeText: '', materialsText: 'M', allEssays: [],
  });
  assert.match(generate, /LINKS MUST BE TRUE/);
  assert.match(generate, /ONE DOCUMENT, ONE SUBJECT/);
  assert.match(generate, /DEEP THINKING/);
  // The temperature is a decision, not a leftover: a review measures, an edit conserves.
  assert.ok(AI_TEMPERATURES.review < AI_TEMPERATURES.polish && AI_TEMPERATURES.polish < AI_TEMPERATURES.generate);
});

await check('an essay is written against the rest of the file, not alone', () => {
  const ps = { id: 'ps', type: 'personal_statement', title: 'Personal statement', prompt: 'Background or belief', word_limit: 650, content: `One winter I kept showing up to the lab and rewired the rig twice. ${words(120)}` };
  const box = { id: 'e2', type: 'supplemental', title: 'Roommate', prompt: 'What would your roommate like to know about you? (max 40 words)', word_limit: 40, content: 'The kettle is on.' };
  const brief = siblingEssaysBrief(box, [ps, box]);
  assert.match(brief, /THE REST OF THIS APPLICATION/);
  assert.match(brief, /One story belongs to one essay/);
  assert.match(brief, /begins: One winter I kept showing up/, 'the sibling essay was not actually shown');
  // A clipped quotation is allowed; a half a sentence with no marker is not.
  assert.match(brief, /…\n/);
  assert.equal(siblingEssaysBrief(box, [box]), '', 'an only child must not be told about its siblings');
  const generate = buildGeneratePrompt({ essay: box, university: { name: 'Stanford' }, platform: 'common_app', profileText: 'P', knowledgeText: '', materialsText: '', allEssays: [ps, box] });
  assert.match(generate, /THE REST OF THIS APPLICATION/);
  const polish = buildPolishPrompt({ essay: box, platform: 'common_app', knowledgeText: '', allEssays: [ps, box] });
  assert.match(polish, /never reuse a phrase, an image, or a closing line/i);
  // The reader rule still holds: another page's existence may never cost this one a point.
  const review = buildReviewPrompt({ essay: box, platform: 'common_app', knowledgeText: '', allEssays: [ps, box] });
  assert.ok(!/THE REST OF THIS APPLICATION/.test(review), 'the review was told to compare essays, which it may not score');
});

await check('the contract in the prompt is the number Atlas measures', () => {
  const prompt = buildPolishPrompt({ essay: essayRow(), platform: 'common_app', knowledgeText: '', allEssays: [] });
  assert.match(prompt, new RegExp(`${Math.round(PRESERVATION_FLOOR * 100)}% of the applicant's own words survive`));
  assert.match(prompt, /Never delete anything the applicant did not ask you to delete/);
  assert.match(prompt, /Every change must name what it fixes/);
  const withRedo = buildPolishPrompt({ essay: essayRow(), platform: 'common_app', knowledgeText: '', allEssays: [], redoNote: 'it replaced 71% of your wording' });
  assert.match(withRedo, /ATLAS REJECTED YOUR LAST ANSWER/);
  assert.match(withRedo, /it replaced 71% of your wording/);
});

await check('an edit instruction cannot be declined and left as an answer', () => {
  const prompt = buildPolishPrompt({
    essay: { ...essayRow(), edit_instructions: 'Be more natural.\nKeep the last line.' },
    editInstructions: 'Be more natural.\nKeep the last line.',
    platform: 'common_app', knowledgeText: '', allEssays: [],
  });
  assert.match(prompt, /There is no third reason to leave an instruction undone/);
  assert.match(prompt, /Declining is not an option available to you/);
  assert.match(prompt, /A style instruction can always be done/);
});

// ---------------------------------------------------------------------------
// 5. The edit is judged, sent back, and only then kept or refused
// ---------------------------------------------------------------------------
import {
  checkInstructionsFollowed, editWorthiness, keepRevisedDraft, chooseEditAnswer, instructionsBrief,
} from '../src/lib/essayEditCheck.js';
import { splitEditInstructions } from '../src/lib/essayPrompts.js';
import { requestsBroadRewrite } from '../src/lib/essayRoot.js';
import { diffText, diffStats, isAggressiveRewrite, isDraftReplaced } from '../src/lib/textDiff.js';

await check('the rewrite threshold and the stated contract are the same number', () => {
  const kept = diffStats(diffText(`The kettle is on. ${words(60)}`, `The kettle is on. ${words(60)} And it boils.`).ops);
  assert.equal(isAggressiveRewrite({ ...kept, preservedRatio: 0.9 }), false);
  assert.equal(isAggressiveRewrite({ ...kept, preservedRatio: 0.72 }), true, '72% survival is below the 80% contract and must be flagged');
  assert.equal(isDraftReplaced({ ...kept, preservedRatio: 0.72 }), false);
  assert.equal(isDraftReplaced({ ...kept, preservedRatio: 0.4 }), true);
});

await check('a broad change is only excused when the applicant asked for it', () => {
  assert.equal(requestsBroadRewrite('Rewrite the whole thing from scratch.'), true);
  assert.equal(requestsBroadRewrite('Cut the second paragraph and be natural.'), false);
  assert.equal(requestsBroadRewrite(''), false);
  const before = `The kettle is on, and the door is propped. ${words(80)}`;
  const after = `I leave the door open and boil water twice a night. ${words(80, 900)}`;
  const stats = diffStats(diffText(before, after).ops);
  assert.ok(stats.preservedRatio < PRESERVATION_FLOOR, 'the fixture must actually be a rewrite');
  const worth = editWorthiness({ stats, essay: { draft_anchor: 'Be natural', edit_instructions: '' } });
  assert.equal(worth.conservationMet, false);
  assert.equal(worth.needsConservationRedo, true);
  assert.equal(worth.verdict, 'redo');
  const asked = editWorthiness({ stats, essay: { draft_anchor: '', edit_instructions: 'Rewrite it as a different essay.' } });
  assert.equal(asked.conservationMet, true, 'an asked-for rewrite must not be blocked');
  assert.equal(asked.verdict, 'apply');
});

await check('a declined instruction counts as undone, not as an answer', () => {
  const before = `I built the rig in March. ${words(40)}`;
  const after = `I built the rig in March, with two hands and one bad plan. ${words(40)}`;
  const list = splitEditInstructions('Add "and no one helped me".\nBe natural.');
  const checked = checkInstructionsFollowed(list, before, after, {
    instructions_followed: [],
    instructions_not_followed: [{ instruction: 'Add "and no one helped me"', why: 'That fact is not in the draft.' }],
  });
  assert.equal(checked.declined, 1);
  assert.equal(checked.unmet, 1, 'a refusal must count as an instruction not carried out');
  assert.match(instructionsBrief(checked), /did not carry out/);
  const worth = editWorthiness({
    stats: diffStats(diffText(before, after).ops),
    essay: {}, editInstructions: 'Add "and no one helped me".', instructionCheck: checked,
  });
  assert.equal(worth.instructionsMet, false);
  assert.equal(worth.verdict, 'redo', 'Atlas sends the refusal back rather than reporting it');
});

await check('the send-back picks the better answer and refuses a bad one', () => {
  const statsKept = { preservedRatio: 0.9 };
  const statsLost = { preservedRatio: 0.4 };
  const ok = { worth: { conservationMet: true, instructionsMet: true, findingsMet: true, claimsImprovement: true }, stats: statsKept };
  const bad = { worth: { conservationMet: false, instructionsMet: false, findingsMet: false, claimsImprovement: false }, stats: statsLost };
  assert.equal(chooseEditAnswer(bad, ok), 'second');
  assert.equal(chooseEditAnswer(ok, bad), 'first');
  assert.equal(chooseEditAnswer(bad, null), 'discard', 'an over-written draft is not applied because nothing else was available');
  assert.equal(chooseEditAnswer(bad, bad), 'discard');
  // Equal on every rule: the one that destroyed fewer of the applicant's words wins.
  const soft = { worth: { conservationMet: true, instructionsMet: true, findingsMet: true }, stats: { preservedRatio: 0.95 } };
  const harder = { worth: { ...soft.worth }, stats: { preservedRatio: 0.85 } };
  assert.equal(chooseEditAnswer(soft, harder), 'first');
});

await check('an edit is kept only when it earned it', () => {
  const met = { conservationMet: true, instructionsMet: true, findingsMet: true, claimsImprovement: true };
  assert.equal(keepRevisedDraft({ beforeScore: 7, afterScore: 8, worth: met }).keep, true);
  assert.equal(keepRevisedDraft({ beforeScore: 8, afterScore: 7, worth: met }).keep, false, 'a lower score is never an improvement');
  assert.equal(keepRevisedDraft({ beforeScore: 8, afterScore: 8, worth: met }).keep, true, 'a closed loop with a flat score is honest');
  const open = { conservationMet: true, instructionsMet: false, findingsMet: false, claimsImprovement: false };
  const flat = keepRevisedDraft({ beforeScore: 8, afterScore: 8, worth: open });
  assert.equal(flat.keep, false, 'nothing gained and nothing fixed must not be kept');
  assert.match(flat.reason, /still open/);
  const overwritten = { conservationMet: false, instructionsMet: true, findingsMet: true, claimsImprovement: true };
  assert.equal(keepRevisedDraft({ beforeScore: 8, afterScore: 8, worth: overwritten }).keep, false);
  // Without a re-score there is nothing to judge, so an edit is never thrown away.
  assert.equal(keepRevisedDraft({ beforeScore: 8, afterScore: 8, worth: open, measured: false }).keep, true);
});

// ---------------------------------------------------------------------------
// 6. Re-examining sections: a queue, like the materials analysis
// ---------------------------------------------------------------------------
import { createDissectionQueue, describeSectionQueueStatus } from '../src/lib/dissectionQueue.js';

await check('queued materials run one at a time, in the order they were asked for', async () => {
  const order = [];
  const releases = [];
  const events = [];
  const queue = createDissectionQueue({
    run: (job) => {
      order.push(job.id);
      return new Promise((resolve, reject) => releases.push({ id: job.id, resolve, reject }));
    },
    notify: (event) => events.push(event.type),
  });
  queue.subscribe(() => undefined);
  queue.enqueue({ id: 'a', title: 'A' });
  queue.enqueue({ id: 'b', title: 'B' });
  queue.enqueue({ id: 'c', title: 'C' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ['a'], 'only one job may run at a time');
  assert.equal(queue.state().waiting.length, 2);
  assert.deepEqual(queue.state().waiting.map((job) => job.id), ['b', 'c']);
  assert.equal(describeSectionQueueStatus(queue.statusFor('b')), 'Queued — it runs when the current job finishes.');
  // Asking twice for the same material merges into the one already waiting.
  queue.enqueue({ id: 'c', title: 'C' });
  assert.equal(queue.state().waiting.length, 2, 'a repeated request must not double the work');
  // A failure on one does not stop the rest.
  releases[0].reject(new Error('the model did not answer'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(order, ['a', 'b'], 'the queue has to keep going after a failure');
  assert.equal(queue.statusFor('a').state, 'failed');
  assert.match(queue.statusFor('a').message, /the model did not answer/);
  // Cancelling a waiting job is allowed; cancelling a running one is not.
  assert.equal(queue.cancel('c'), true);
  assert.equal(queue.cancel('b'), false);
  assert.equal(queue.state().waiting.length, 0);
  releases[1].resolve({ done: [{ rows: 3 }] });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.statusFor('b').state, 'done');
  assert.deepEqual(queue.statusFor('b').result, { done: [{ rows: 3 }] });
  assert.ok(queue.state().current === null);
  assert.ok(events.includes('running') && events.includes('done') && events.includes('failed'));
});

await check('asking again while a material runs re-reads it afterwards', async () => {
  const seen = [];
  const releases = [];
  const queue = createDissectionQueue({
    run: (job) => { seen.push(job.id); return new Promise((resolve) => releases.push(resolve)); },
  });
  assert.equal(queue.enqueue({ id: 'x' }), 'queued');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(queue.enqueue({ id: 'x' }), 'running-later');
  releases[0]();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, ['x', 'x'], 'a source changed mid-flight is re-read, not left stale');
});

await check('the page queues instead of refusing, and the lock is still respected', () => {
  const service = src('src/lib/knowledgeService.js');
  assert.match(service, /export function queueSectionReExamination/);
  assert.match(service, /await waitUntilIdle\(\(task\) => task\.kind === 'knowledge'\)/);
  assert.match(service, /knowledge_busy/, 'a knowledge job started while this one waited must not be lost');
  const queue = src('src/lib/dissectionQueue.js');
  assert.ok(!/base44|fetch\(/.test(queue), 'the queue is a pure module and must stay testable');
  const page = src('src/pages/AiKnowledge.jsx');
  assert.match(page, /queueSectionReExamination/, 'the button does not queue');
  assert.match(page, /subscribeSectionQueue/);
  assert.match(page, /cancelSectionReExamination/);
  assert.match(page, /clearSectionReExaminationQueue/);
  assert.match(page, /Re-examine all/, 'a whole shelf still has to be clicked one at a time');
  const tasks = src('src/lib/backgroundTasks.js');
  assert.match(tasks, /export async function waitUntilIdle/);
  assert.match(tasks, /settlements\.set\(id, promise\.then\(\(\) => undefined, \(\) => undefined\)\)/);
});

await check('an edit is judged before the applicant ever reads it', () => {
  const builder = src('src/pages/EssayBuilder.jsx');
  assert.match(builder, /editWorthiness\(/, 'an edit is never judged');
  assert.match(builder, /chooseEditAnswer\(/, 'a rejected edit is never sent back');
  assert.match(builder, /keepRevisedDraft\(/, 'an edit that gained nothing is kept anyway');
  assert.match(builder, /worth: chosen\.worth/, 'the re-score is not judged against what the edit did');
  assert.match(builder, /The edit was not applied/, 'an over-written draft is applied and apologised for');
  assert.match(builder, /attemptEdit/, 'the retry is measured differently from the first answer');
  assert.match(src('src/components/essay/EssayDiffView.jsx'), /notApplied/, 'the comparison does not say the edit was refused');
});

await check('the documentation tells the next change what these rules are for', () => {
  const agents = src('AGENTS.md');
  assert.match(agents, /dissectionQueue\.js/, 'AGENTS.md does not point at the section queue');
  assert.match(agents, /PRESERVATION_FLOOR/, 'AGENTS.md does not name the conservation contract');
  assert.match(agents, /Edit worthiness|editWorthiness/, 'AGENTS.md does not say an edit is judged before it is shown');
  const readme = src('README.md');
  assert.match(readme, /Re-examining a material queues, it does not block/, 'the README does not describe the re-examination queue');
  assert.match(readme, /less than 80% of your own words is a rewrite/, 'the README still calls an over-written edit a warning');
  assert.match(readme, /Two facts next to each other are never a cause/, 'the README does not record the no-invented-links rule');
  assert.match(readme, /written against the \*\*rest of the file\*\*/, 'the README does not record the cross-essay rule');
  assert.match(agents, /siblingEssaysBrief/, 'AGENTS.md does not say why the review never sees the sibling list');
});

for (const [name, fn] of checks) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error && error.message ? error.message : error);
    process.exitCode = 1;
  }
}
console.log(`verify-linked-knowledge: ${process.exitCode ? 'FAILED' : `ok (${passed} checks)`}`);

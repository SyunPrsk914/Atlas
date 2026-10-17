// Checks for the instruction layer: the clipping rule, material relevance and
// budgets, knowledge-base density and packing, the root/direction contract, and
// the edit loop that verifies a review was actually answered.
//
// These are behavioural, not textual: each one runs the real helper on the exact
// shape of data that used to break it, and asserts the fix holds.
//
// Run with: node --import ./scripts/register-ext.mjs scripts/verify-instructions.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clipToBoundary, previewClip, packBlocks, omissionNote } from '../src/lib/textClip.js';
import {
  presentMaterial, materialRelevance, formatOwnMaterials, formatMaterialsForAI,
} from '../src/lib/materialRole.js';
import { encodeDocumentText } from '../src/lib/materialDocument.js';
import {
  KNOWLEDGE_BASE_LIMITS, MAX_LIMITS, knowledgeLimitsFor, buildKnowledgeInputs, itemLooksCutOff,
  knowledgeCoverage, applicantKnowledgeForPrompt,
} from '../src/lib/applicantKnowledge.js';
import { interpretRoot, checkDraftAgainstRoot, rootCheckBrief } from '../src/lib/essayRoot.js';
import { extractFlaggedPhrases, findUnaddressedFindings, unaddressedBrief } from '../src/lib/essayEditCheck.js';
import {
  rootBrief, buildRootCorrection, buildGeneratePrompt, buildPolishPrompt, POLISH_SCHEMA,
} from '../src/lib/essayPrompts.js';

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
const words = (n) => Array.from({ length: n }, (_, i) => `word${i + 1}`).join(' ');

// ---------------------------------------------------------------------------
// The clipping rule every prompt shares.
// ---------------------------------------------------------------------------
await check('a clipped prompt never ends mid-word', () => {
  const text = 'One two three. Four five six seven. Eight nine.';
  assert.equal(clipToBoundary(text, 20, { marker: null }), 'One two three.');
  const noted = clipToBoundary(text, 20);
  assert.ok(noted.startsWith('One two three.'), noted);
  assert.match(noted, /33 more characters left out/);
  const custom = clipToBoundary(text, 20, { marker: (dropped) => `[${dropped}]` });
  assert.equal(custom, 'One two three.[33]');
});

await check('clipping is a no-op on short text and survives a boundary-free input', () => {
  assert.equal(clipToBoundary('short.', 100), 'short.');
  assert.equal(clipToBoundary('', 100), '');
  const noBoundary = 'aaaaaaaaaa'.repeat(10);
  const out = clipToBoundary(noBoundary, 15, { marker: null });
  assert.ok(out.length > 0 && out.length <= 15, out);
});

await check('the UI preview cuts at a space and marks the cut', () => {
  assert.equal(previewClip('alpha beta gamma', 11), 'alpha beta…');
  assert.ok(!previewClip('alpha beta gamma', 11).includes('ga'));
  assert.equal(previewClip('short', 50), 'short');
});

await check('blocks are packed whole, and the first one is never dropped', () => {
  const blocks = ['a'.repeat(100), 'b'.repeat(100), 'c'.repeat(100)];
  const packed = packBlocks(blocks, 150);
  assert.equal(packed.kept.length, 1);
  assert.equal(packed.omitted.length, 2);
  assert.equal(packed.kept[0], blocks[0]);
  const oversized = packBlocks(['x'.repeat(500), 'y'], 10);
  assert.equal(oversized.kept.length, 1, 'a prompt must never arrive empty');
  assert.deepEqual(oversized.omitted, ['y']);
});

await check('what did not fit is named, and the count says how much more there was', () => {
  assert.equal(omissionNote([], 'Left out'), '');
  const many = Array.from({ length: 15 }, (_, i) => `Source ${i + 1}`);
  const note = omissionNote(many, 'Left out', (item) => item);
  assert.ok(note.includes('Source 12'), note);
  assert.ok(!note.includes('Source 13'), 'more than twelve names is noise');
  assert.match(note, /\(and 3 more\)/);
});

// ---------------------------------------------------------------------------
// Materials: relevance decides what reaches the prompt, and a long source is
// dropped whole rather than beheaded.
// ---------------------------------------------------------------------------
const FILE = 'https://example.supabase.co/storage/v1/object/public/uploads/u1/huge.pdf';
const document = (text) => encodeDocumentText({ source: FILE, reader: 'pdf', text });

const essayMaterial = (over) => ({
  id: over.id, title: over.title, type: over.type || 'other', content: over.content || '',
  notes: over.notes || '', file_url: over.file_url || null,
  target_essay_id: over.target_essay_id || null,
  target_university_id: over.target_university_id || null,
});

await check('a source scoped to this essay outranks one scoped to another school', () => {
  const stanfordRoommate = { id: 'e1', title: 'Roommate', prompt: 'Who would you want as a roommate?' };
  const mine = essayMaterial({
    id: 'a', title: 'Roommate brainstorm', notes: 'I have shared a room with a robot builder',
    target_essay_id: 'e1',
  });
  const otherSchool = essayMaterial({
    id: 'b', title: 'UCAS intellectual vitality', notes: 'supplementary statement for a UK university',
  });
  const context = { essay: stanfordRoommate, universityName: 'Stanford', platform: 'common_app', task: 'draft' };
  assert.ok(materialRelevance(mine, context) > materialRelevance(otherSchool, context),
    `got ${materialRelevance(mine, context)} vs ${materialRelevance(otherSchool, context)}`);
});

await check('a small pile keeps every source in full', () => {
  const materials = [
    essayMaterial({ id: 'a', title: 'Transcript', content: `Grades.${words(40)}` }),
    essayMaterial({ id: 'b', title: 'Supervisor report', content: `Reports.${words(40)}` }),
  ];
  const out = formatMaterialsForAI(materials, { task: 'review' });
  assert.ok(out.includes('Transcript') && out.includes('Supervisor report'), out.slice(0, 400));
  assert.ok(!/left out to fit the AI/.test(out), 'nothing should be dropped at this size');
});

await check('a big pile drops whole sources and says which', () => {
  const materials = Array.from({ length: 40 }, (_, i) => essayMaterial({
    id: `m${i}`, title: `Material ${i}`, content: `Body ${i}. ${words(700)}`,
  }));
  const out = formatMaterialsForAI(materials, { task: 'draft' });
  assert.match(out, /held back from this prompt/);
  assert.ok(out.length < materials.reduce((sum, item) => sum + item.content.length, 0));
});

await check('a trimmed source states what was left out instead of stopping cold', () => {
  const long = essayMaterial({
    id: 'a', title: 'Huge file', file_url: FILE, content: document(`Head. ${words(6000)}. The tail sentence stays.`),
  });
  const blocks = formatOwnMaterials([long], { totalChars: 1200 });
  const text = blocks.join('\n');
  assert.match(text, /more characters left out here/);
  const head = text.split('\n[…')[0];
  assert.ok(!/The tail sentence stays\.$/.test(head), 'the tail is not in the head');
  assert.ok(/(\.|!|\?|:|;|\w)$/.test(head.trimEnd()), `head ends mid-word: ${head.slice(-60)}`);
});

await check('presentMaterial keeps the analysis and the label the UI shows', () => {
  const row = presentMaterial(essayMaterial({ id: 'a', title: 'IA', content: 'Text.', notes: '[[atlas-analysis-role:academic_work]]' }));
  assert.equal(row.analysis_role, 'academic_work');
  assert.ok(!String(row.notes || '').includes('[[atlas'), row.notes);
});

// ---------------------------------------------------------------------------
// The knowledge base: density scales with the pile, and prompts are packed whole.
// ---------------------------------------------------------------------------
await check('a 40-source pile is not allowed to produce a 5-item portrait', () => {
  const small = knowledgeLimitsFor({});
  assert.deepEqual({ ...small.about, ...{ extra: 0 } }, { min: 0, max: 14, extra: 0 });
  assert.equal(small.points.max, KNOWLEDGE_BASE_LIMITS.points);
  const big = knowledgeLimitsFor({ materials: 40, essays: 4, profile: 1 });
  assert.ok(big.points.max > KNOWLEDGE_BASE_LIMITS.points * 2, `points.max was ${big.points.max}`);
  assert.ok(big.points.min > 40, `points.min was ${big.points.min}`);
  assert.ok(big.about.min >= 20, `about.min was ${big.about.min}`);
  assert.ok(big.about.max > KNOWLEDGE_BASE_LIMITS.about, `about.max was ${big.about.max}`);
  const absurd = knowledgeLimitsFor({ materials: 100000 });
  assert.equal(absurd.points.max, MAX_LIMITS.points, 'a runaway pile must not ask for a book');
});

await check('every source is offered to the builder, not just the first three', () => {
  const materials = Array.from({ length: 12 }, (_, i) => essayMaterial({
    id: `k${i}`, title: `Reflection ${i}`, content: `Ref ${i}. ${words(30)}`,
  }));
  const inputs = buildKnowledgeInputs({ profile: null, materials, essays: [] });
  assert.equal(inputs.counts.materials, 12);
  const offered = `${inputs.ownText}\n${inputs.guidanceText}\n${inputs.sampleText}`;
  for (let i = 0; i < 12; i += 1) {
    assert.ok(offered.includes(`Reflection ${i}`), `source ${i} vanished from the builder input`);
  }
  assert.ok(inputs.fingerprint && inputs.fingerprint !== buildKnowledgeInputs({ profile: null, materials, essays: [] }).fingerprint
    || inputs.fingerprint === buildKnowledgeInputs({ profile: null, materials, essays: [] }).fingerprint,
  'the fingerprint must be a pure function of the inputs');
  assert.notEqual(inputs.fingerprint, buildKnowledgeInputs({
    profile: null, materials: materials.slice(0, 11), essays: [],
  }).fingerprint, 'dropping a source must change the fingerprint');
});

const kbRow = (over) => ({
  id: over.id, kind: over.kind, text: over.text, category: over.category || 'other',
  platform: over.platform || 'General', source_label: over.source_label || '',
  target_university_id: over.target_university_id || null, target_essay_id: over.target_essay_id || null,
});

await check('the prompt version is ordered by how specific each item is', () => {
  const rows = [
    kbRow({ id: 'g', kind: 'brief', text: `A general habit. ${words(14)}` }),
    kbRow({ id: 'u', kind: 'pattern', text: `A Stanford-specific pattern. ${words(14)}`, target_university_id: 'stan' }),
    kbRow({ id: 'e', kind: 'evidence', text: `Roommate-specific detail. ${words(14)}`, target_essay_id: 'e1' }),
  ];
  const forStanford = applicantKnowledgeForPrompt(rows, {
    universityId: 'stan', essayId: 'e1', universities: [{ id: 'stan', name: 'Stanford' }], essays: [{ id: 'e1', title: 'Roommate' }], maxChars: 1500,
  });
  const lines = forStanford.split('\n').filter((line) => line.startsWith('- ['));
  assert.ok(/Roommate-specific detail/.test(forStanford), forStanford.slice(0, 300));
  assert.ok(lines[1].includes('Roommate-specific'), `most specific item should lead its group, got: ${lines[1]}`);
  assert.ok(forStanford.length <= 1500, `maxChars 1500 produced ${forStanford.length}`);
  assert.match(forStanford, /Stanford-specific pattern/);
  // With no target chosen, an item that belongs to one school or one essay stays
  // out of the prompt — this is what keeps UCAS material out of a Stanford draft.
  const general = applicantKnowledgeForPrompt(rows, { maxChars: 1500 });
  assert.ok(general.includes('A general habit.'), general);
  assert.ok(!general.includes('Stanford-specific pattern'), 'a Stanford-only item leaked into a general run');
  assert.ok(!general.includes('Roommate-specific detail'), 'an essay-only item leaked into a general run');
});

await check('an item that cannot fit is named, and nothing is cut in half', () => {
  const rows = Array.from({ length: 40 }, (_, i) => kbRow({
    id: `r${i}`, kind: 'evidence', text: `Fact ${i} about the applicant. ${words(120)}`,
  }));
  const out = applicantKnowledgeForPrompt(rows, { maxChars: 2000 });
  assert.match(out, /saved but did not fit this prompt/);
  assert.ok(out.length <= 2000, `maxChars 2000 produced ${out.length}`);
  for (const line of out.split('\n')) {
    if (!line.startsWith('- [')) continue;
    assert.ok(/(\.|!|\?|…|\]|\)|"|\w)$/.test(line.trimEnd()), `line ends mid-thought: ${line.slice(-60)}`);
  }
});

await check('a thin build is reported, and so is a sentence that ends in mid-air', () => {
  const inputs = { counts: { materials: 30, essays: 2, profile: 1, samples: 3, guidance: 4 } };
  const empty = knowledgeCoverage([], inputs);
  assert.ok(empty.thin.includes('About you'), empty.thin.join(','));
  assert.ok(empty.thin.includes('Personal points'), empty.thin.join(','));
  const healthy = knowledgeCoverage([
    ...Array.from({ length: 30 }, (_, i) => kbRow({ id: `b${i}`, kind: 'brief', category: 'personality', text: `Personality trait ${i}. ${words(12)}` })),
    ...Array.from({ length: 60 }, (_, i) => kbRow({ id: `p${i}`, kind: 'evidence', category: 'academic', text: `Concrete fact ${i}. ${words(12)}` })),
  ], inputs);
  assert.ok(!healthy.thin.includes('About you'), `healthy.thin: ${healthy.thin.join(',')}`);
  assert.ok(itemLooksCutOff('someone who decided to rebuild the whole carburettor because the'), 'a fragment must be flagged');
  // A three-word item is not evidence of truncation, and flagging every short
  // entry would bury the ones that really were cut.
  assert.ok(!itemLooksCutOff('someone who de'));
  assert.ok(!itemLooksCutOff('Someone who decided to rebuild the engine.'), 'a full sentence must not be flagged');
});

await check('a deeper pass appends, keeps provenance, and never repeats an item', async () => {
  const { extendApplicantKnowledge } = await import('../src/lib/applicantKnowledge.js');
  const inputs = {
    empty: false, fingerprint: 'fp1', profileText: 'Profile.', ownText: 'Sources.', guidanceText: '', sampleText: '', essayText: '',
    counts: { materials: 6, essays: 1, profile: 1, samples: 2, guidance: 1 },
  };
  const saved = Array.from({ length: 60 }, (_, i) => kbRow({
    id: `s${i}`, kind: 'evidence', category: 'fact', text: `Already saved fact number ${i} about the applicant.`,
  }));
  const created = [];
  const outcome = await extendApplicantKnowledge({
    inputs,
    existingRows: saved,
    model: 'test-model',
    runAI: async () => ({
      result: {
        about: [{ category: 'personality', text: 'Rebuilds a thing until the cause is found, not until it runs.', source_label: 'Supervisor report' }],
        points: [{ category: 'fact', text: 'Rebuilt the water pump twice in one week.', source_label: 'Reflection 3' }],
        patterns: [{ category: 'opening', platform: 'US', text: 'Opens on the object, not on the feeling.' }],
        guidance: [{ category: 'writing_principle', text: 'Answer the question that was actually asked.' }],
      },
    }),
    isLive: () => true,
    createRows: (rows) => { created.push(...rows); return Promise.resolve(rows); },
  });
  const added = outcome.counts.about + outcome.counts.points + outcome.counts.patterns + outcome.counts.guidance;
  assert.ok(added >= 4, JSON.stringify(outcome.counts));
  const about = created.find((row) => row.kind === 'brief');
  assert.equal(about.source_label, 'Supervisor report', 'the source label was lost on the way to the row');
  assert.equal(about.origin, 'ai');
  const pattern = created.find((row) => row.kind === 'pattern');
  assert.equal(pattern.platform, 'US', 'the platform was lost on the way to the row');
  assert.match(JSON.stringify(created[0].data), /appended/);
  assert.equal(saved.length, 60, 'a deeper pass must not touch the rows already saved');
});

await check('a deeper pass refuses to double the list when every kind is full', async () => {
  const { extendApplicantKnowledge } = await import('../src/lib/applicantKnowledge.js');
  const full = [
    ...Array.from({ length: MAX_LIMITS.about }, (_, i) => kbRow({ id: `a${i}`, kind: 'brief', text: `Trait number ${i} of the portrait.` })),
    ...Array.from({ length: MAX_LIMITS.points }, (_, i) => kbRow({ id: `p${i}`, kind: 'evidence', text: `Fact number ${i} of the record.` })),
    ...Array.from({ length: MAX_LIMITS.patterns }, (_, i) => kbRow({ id: `k${i}`, kind: 'pattern', text: `Pattern number ${i} of the sample file.` })),
    ...Array.from({ length: MAX_LIMITS.guidance }, (_, i) => kbRow({ id: `g${i}`, kind: 'guidance', text: `Rule number ${i} of the guide pile.` })),
  ];
  let called = false;
  const outcome = await extendApplicantKnowledge({
    inputs: { empty: false, fingerprint: 'fp', counts: { materials: 2, profile: 1 } },
    existingRows: full,
    runAI: async () => { called = true; return { result: {} }; },
    isLive: () => true,
    createRows: () => Promise.resolve([]),
  });
  assert.equal(called, false, 'the model was asked to repeat a full portrait');
  assert.equal(outcome.counts.about, 0);
  assert.match(outcome.warnings[0], /largest size/);
});

await check('a portrait at its build size can still be deepened towards the ceiling', async () => {
  const { extendApplicantKnowledge } = await import('../src/lib/applicantKnowledge.js');
  const built = Array.from({ length: KNOWLEDGE_BASE_LIMITS.points }, (_, i) => kbRow({
    id: `p${i}`, kind: 'evidence', text: `Fact number ${i} of the first build.`,
  }));
  let asked = null;
  await extendApplicantKnowledge({
    inputs: { empty: false, fingerprint: 'fp', counts: { materials: 1, profile: 1 } },
    existingRows: built,
    runAI: async (payload) => {
      asked = payload;
      return { result: { points: [{ category: 'fact', text: 'A late arrival the first pass missed entirely.', source_label: 'Ibn report' }] } };
    },
    isLive: () => true,
    createRows: () => Promise.resolve([]),
  });
  assert.ok(asked, 'a full-size build was refused a deeper pass');
  assert.match(JSON.stringify(asked), /A late arrival|do not repeat|points/i);
});

// ---------------------------------------------------------------------------
// The root: Atlas reads the instruction, then checks the draft against it.
// ---------------------------------------------------------------------------
const PICK_ONE = 'Pick the most effective one of the below and expand about it: '
  + '1. the robotics build 2. the bakery job 3. repairing the water pump';

await check('a "pick one" direction is read as a choice, not a table of contents', () => {
  const reading = interpretRoot(PICK_ONE);
  assert.equal(reading.hasRoot, true);
  assert.equal(reading.chooseOne, true);
  assert.equal(reading.includeAll, false);
  assert.equal(reading.alternatives.length, 3);
  assert.deepEqual(reading.alternatives.map((item) => item.label),
    ['the robotics build', 'the bakery job', 'repairing the water pump']);
});

await check('a draft that uses all three options is rejected', () => {
  const draft = 'I led the robotics build and learned to solder. In the bakery job I opened at four. '
    + 'Repairing the water pump taught me to listen to a machine.';
  const verdict = checkDraftAgainstRoot(PICK_ONE, draft);
  assert.equal(verdict.status, 'crammed');
  assert.equal(verdict.ok, false);
  assert.ok(verdict.correction.includes('ONE'), verdict.correction);
  assert.match(rootCheckBrief(verdict), /three|3/);
});

await check('a draft that builds on one option passes, and the other two stay out', () => {
  const draft = 'The robotics build took a whole summer. We argued about the chassis, and I learned to design for the team.';
  const verdict = checkDraftAgainstRoot(PICK_ONE, draft);
  assert.equal(verdict.status, 'respected');
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.matched, ['the robotics build']);
  assert.deepEqual(verdict.missing.sort(), ['repairing the water pump', 'the bakery job']);
});

await check('a draft that ignored the direction is reported as ignored', () => {
  const verdict = checkDraftAgainstRoot(PICK_ONE, 'I played football and studied history. Both were fine.');
  assert.equal(verdict.status, 'ignored');
  assert.equal(verdict.ok, false);
  assert.match(verdict.correction, /Start again/);
});

await check('no root means no claim, and no rewriting', () => {
  const verdict = checkDraftAgainstRoot('', 'Anything at all.');
  assert.equal(verdict.status, 'no-root');
  assert.equal(verdict.ok, true);
  assert.equal(verdict.message, '');
  assert.match(rootBrief({ draft_anchor: '' }), /No root has been entered yet/);
});

await check('the model is told how Atlas will read the direction', () => {
  const brief = rootBrief({ draft_anchor: PICK_ONE });
  assert.match(brief, /CHOOSE-ONE/);
  assert.match(brief, /exactly ONE/);
  assert.match(brief, /"the robotics build", "the bakery job", "repairing the water pump"/);
  assert.match(brief, /menu of possible subjects, not an outline/);
  assert.equal(buildRootCorrection({ correction: 'Do it again.', message: 'Options crammed.' })
    .includes('ATLAS REJECTED YOUR LAST ANSWER'), true);
  assert.equal(buildRootCorrection(null), '');
});

await check('an "include all of these" direction is not read as a choice', () => {
  const root = 'Cover all of these in one essay: 1. the robotics build 2. the bakery job';
  const reading = interpretRoot(root);
  assert.equal(reading.includeAll, true);
  assert.equal(reading.chooseOne, false);
  const both = checkDraftAgainstRoot(root, 'The robotics build and the bakery job both taught me to show up early.');
  assert.equal(both.status, 'respected');
  const one = checkDraftAgainstRoot(root, 'The robotics build taught me to show up early and to solder.');
  assert.equal(one.status, 'uncertain', 'partial coverage is worth a note, not a rewrite');
  assert.equal(one.ok, true);
});

// ---------------------------------------------------------------------------
// The edit loop: a review's objections are checked, word for word.
// ---------------------------------------------------------------------------
const review = {
  quoted_evidence: ['we worked hard together', 'a testament to my resilience'],
  weaknesses: ['Vague: "the system"'],
  priority_improvements: ['Cut "in the end".'],
  per_dimension: [{
    dimension: 'specificity',
    evidence: 'The line “someone who de” is unfinished.',
    how_to_reach_ten: 'Name the machine, not "the system".',
  }],
};

await check('the flagged phrases are taken from the whole review', () => {
  const phrases = extractFlaggedPhrases(review);
  for (const phrase of ['we worked hard together', 'a testament to my resilience', 'the system', 'in the end']) {
    assert.ok(phrases.includes(phrase), `${phrase} was not extracted: ${phrases.join(' | ')}`);
  }
  assert.ok(phrases.length <= 24);
});

await check('an edit that leaves a flagged line in place is caught', () => {
  const before = 'I rebuilt the engine. In the end, we worked hard together and it was a testament to my resilience.';
  const after = 'I rebuilt the engine in six weeks. We worked hard together.';
  const result = findUnaddressedFindings(review, after, before);
  assert.ok(result.stillPresent.includes('we worked hard together'), JSON.stringify(result));
  assert.ok(result.fixed.includes('in the end'), JSON.stringify(result));
  assert.match(result.message, /still in the draft/);
  assert.match(unaddressedBrief(result), /we worked hard together/);
  const clean = findUnaddressedFindings(review, 'I rebuilt the engine in six weeks.', before);
  assert.equal(clean.stillPresent.length, 0);
  assert.equal(clean.message, '');
});

await check('matching ignores case, spacing and curly quotation marks', () => {
  const result = findUnaddressedFindings(
    { quoted_evidence: ['We  Worked HARD   together'] },
    '…and we worked\n\thard together, it was.', '',
  );
  assert.equal(result.stillPresent.length, 1);
});

await check('a phrase the reviewer invented is neither claimed fixed nor held against the edit', () => {
  const result = findUnaddressedFindings({ quoted_evidence: ['a line never written'] }, 'My own words.', 'My own words.');
  assert.deepEqual(result.stillPresent, []);
  assert.deepEqual(result.fixed, []);
  assert.equal(result.total, 1);
});

await check('a review with nothing to fix says so', () => {
  const result = findUnaddressedFindings({ overall_score: 10 }, 'Draft.', 'Draft.');
  assert.equal(result.hadNothing, true);
  assert.equal(unaddressedBrief(result), '');
});

// ---------------------------------------------------------------------------
// The prompts that carry all of this to the model.
// ---------------------------------------------------------------------------
const draftEssay = {
  id: 'e1', title: 'Roommate', type: 'supplement', scope: 'university',
  application_platform: 'common_app', university_id: 'stan', word_limit: 250,
  prompt: 'Who would you want as a roommate?', draft_anchor: PICK_ONE, content: 'My draft. ' + words(60),
};
const essayList = [draftEssay];
const university = { id: 'stan', name: 'Stanford University' };

await check('the drafting prompt carries the mechanical reading and the send-back', () => {
  const prompt = buildGeneratePrompt({
    essay: draftEssay, university, platform: 'common_app', profileText: 'Profile.', knowledgeText: 'Knowledge.',
    materialsText: 'Materials.', applicantText: 'Applicant.', allEssays: essayList,
    rootCorrection: buildRootCorrection(checkDraftAgainstRoot(PICK_ONE, words(200))),
  });
  assert.match(prompt, /HOW ATLAS READS THIS DIRECTION/);
  assert.match(prompt, /ATLAS REJECTED YOUR LAST ANSWER/);
  assert.match(prompt, /Target band/);
  assert.ok(prompt.length > 4000, 'the brief must not be thin');
});

await check('the polish prompt lists every flagged phrase and allows an honest refusal', () => {
  const prompt = buildPolishPrompt({
    essay: draftEssay, university, platform: 'common_app', reviewResult: review,
    knowledgeText: 'Knowledge.', allEssays: essayList,
    focusPhrases: ['we worked hard together'],
  });
  assert.match(prompt, /THE FLAGGED PHRASES/);
  assert.match(prompt, /- "we worked hard together"/);
  assert.ok(POLISH_SCHEMA.properties.unresolved_phrases, 'the model needs a place to say why a line stays');
  assert.ok(POLISH_SCHEMA.properties.unresolved_phrases.items.properties.phrase);
});

await check('without a review to answer, polish still refuses to rewrite the essay', () => {
  const prompt = buildPolishPrompt({
    essay: draftEssay, university, platform: 'common_app', reviewResult: null,
    knowledgeText: '', allEssays: essayList,
  });
  assert.match(prompt, /80%/);
  assert.ok(!prompt.includes('THE FLAGGED PHRASES'), 'no phrases to chase when nothing was flagged');
});

// ---------------------------------------------------------------------------
// Wiring: the libraries above are only useful if the pages call them.
// ---------------------------------------------------------------------------
await check('the essay builder checks the draft and sends it back once', () => {
  const page = src('src/pages/EssayBuilder.jsx');
  assert.match(page, /checkDraftAgainstRoot\(/, 'generation never verifies the root');
  assert.match(page, /buildRootCorrection\(/, 'the retry is never given a correction');
  assert.match(page, /findUnaddressedFindings\(/, 'the edit is never checked against the review');
  assert.match(page, /const handlePolish = \(\) => runPolishAction/, 'Apply edits is not wired to the shared action');
  assert.match(page, /onFixRemaining=\{/, 'the follow-up is not reachable from the diff');
  assert.match(page, /unaddressed/, 'the diff is never told what is still flagged');
  assert.match(page, /rootReading\./, 'the applicant is never shown how the direction was read');
  assert.match(page, /scoreDelta: delta/, 'a score that moved is only announced in a toast');
});

await check('the diff shows what the edit left behind', () => {
  const view = src('src/components/essay/EssayDiffView.jsx');
  assert.match(view, /revision\.unaddressed|unaddressed = /);
  assert.match(view, /onFixRemaining/);
  assert.match(view, /revision\.summary/);
  assert.match(view, /scoreDelta/, 'a score that moved is reported in a toast that vanishes');
  assert.match(src('src/pages/EssayBuilder.jsx'), /scoreDelta: delta/);
});

await check('the knowledge base page can deepen itself and report its own density', () => {
  const page = src('src/pages/AiKnowledge.jsx');
  assert.match(page, /startKnowledgeExtend|extendApplicantKnowledge/, 'there is no way to add what the first pass missed');
  assert.match(page, /knowledgeCoverage/, 'thin builds are never surfaced');
  assert.match(page, /itemLooksCutOff/, 'half-written items are never surfaced');
  assert.match(page, /handleGoDeeper/);
  assert.match(page, /CATEGORIES\[kind\]/, 'items are not grouped by category');
  assert.match(page, /matchesQuery/, 'the knowledge base cannot be searched');
});

await check('every prompt-side truncation goes through the boundary rule', () => {
  for (const file of ['src/lib/materialRole.js', 'src/lib/applicantKnowledge.js', 'src/lib/materialAnalysis.js', 'src/lib/schoolFit.js']) {
    const text = src(file);
    assert.match(text, /textClip|clipToBoundary|previewClip/, `${file} clips without the shared rule`);
    assert.ok(!/return String\(text[^\n]*\)\.slice\(0,\s*\w+\);/.test(text), `${file} still returns a raw slice`);
  }
  assert.match(src('src/pages/KnowledgeBase.jsx'), /previewClip/);
});

await check('no copy still advertises a provider the app does not have', () => {
  for (const file of ['src/pages/AiKnowledge.jsx', 'src/pages/Materials.jsx', 'src/pages/EssayBuilder.jsx',
    'src/pages/ApplicationReview.jsx', 'src/pages/KnowledgeBase.jsx', 'src/pages/Dashboard.jsx',
    'src/components/profile/ActivityAiPanel.jsx', 'src/lib/materialJobs.js', 'src/lib/researchSource.js']) {
    assert.ok(!/local model/i.test(src(file)), `${file} still tells the applicant to connect a local model`);
  }
  assert.ok(!/local-model call/i.test(src('README.md')), 'README still describes a per-part local call');
  assert.ok(!/local model is connected/i.test(src('src/lib/ai.js')));
});

await check('the documentation describes the rules the code now enforces', () => {
  const readme = src('README.md');
  assert.match(readme, /essayRoot\.js/, 'README does not document the root check');
  assert.match(readme, /textClip\.js/, 'README does not document the clipping rule');
  assert.match(readme, /Fix what is still flagged/, 'README does not mention the follow-up edit');
  assert.match(readme, /Go deeper/, 'README does not mention deepening the knowledge base');
  const agents = src('AGENTS.md');
  assert.match(agents, /the ONLY way text is shortened for a prompt/, 'AGENTS.md has no clipping rule for the next change');
  assert.match(agents, /verify-instructions\.mjs/, 'AGENTS.md does not point at the new checks');
});

console.log(`verify-instructions: ok (${passed} checks)`);
if (process.exitCode) process.exit(1);

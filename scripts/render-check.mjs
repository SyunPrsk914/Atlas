// Renders every essay/activity quality component in Node and fails if any of
// them throws.
//
// Lint and `vite build` prove the code parses and every import resolves. They
// do not prove that a component survives being given the props the pages
// actually pass it — a `revision.protectedItems.slice()` on an object that has
// no `protectedItems` parses, builds, and then crashes the Essay Builder the
// first time an edit is applied. This script builds the fixtures below with Vite's
// own SSR pipeline (no extra dependencies, no network) and renders them.
//
// Run with: npm run verify:render

import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const workDir = join(root, '.render-check');
const fixtures = join(workDir, 'fixtures.jsx');

// A browser shim, injected ahead of the bundle: `sonner` reads `window` at
// import time, and the demo backend reads `localStorage`.
const shim = join(workDir, 'shim.js');

rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

writeFileSync(shim, `
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.top = globalThis;
const noop = () => {};
globalThis.document = {
  createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop, remove: noop }),
  createTextNode: () => ({}),
  head: { appendChild: noop },
  body: { appendChild: noop },
  documentElement: { style: {}, classList: { add: noop, remove: noop } },
  addEventListener: noop,
  removeEventListener: noop,
  querySelector: () => null,
};
try {
  if (!globalThis.navigator) throw new Error('missing');
} catch {
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
}
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.matchMedia = () => ({ matches: false, media: '', addListener: noop, removeListener: noop, addEventListener: noop, removeEventListener: noop });
`);

writeFileSync(fixtures, `import './shim.js';
import { renderToStaticMarkup } from 'react-dom/server';
import LengthMeter from '@/components/essay/LengthMeter';
import EssayDiffView from '@/components/essay/EssayDiffView';
import RevisionProgress from '@/components/essay/RevisionProgress';
import EssayReviewPanel from '@/components/essay/EssayReviewPanel';
import UcasStatementEditor from '@/components/essay/UcasStatementEditor';
import ActivitiesEditor from '@/components/profile/ActivitiesEditor';
import ActivityAiPanel from '@/components/profile/ActivityAiPanel';
import HonorsEditor from '@/components/profile/HonorsEditor';
import HonorsAiPanel from '@/components/profile/HonorsAiPanel';
import ApplicantQuestionsPanel from '@/components/ApplicantQuestionsPanel';
import AiStatusPill from '@/components/AiStatusPill';
import BackgroundTasksPill from '@/components/BackgroundTasksPill';
import AiSetupDialog, { OllamaReasoning } from '@/components/AiSetupDialog';
import { assessLength } from '@/lib/essayLength';
import { diffText, diffStats } from '@/lib/textDiff';

const words = (n) => Array.from({ length: n }, (_, i) => \`w\${i + 1}\`).join(' ');
const personalStatement = (content) => ({
  id: 'ps', title: 'Common App Personal Statement', type: 'personal_statement', scope: 'common',
  application_platform: 'common_app', word_limit: 650, prompt: 'Some students have a background', content,
});

const before = 'I built a solar car. It was hard, but I learned about teamwork.';
const after = 'I built a solar car chassis over one summer, and learned how a team argues.';
const { ops } = diffText(before, after);
const stats = diffStats(ops);

const review = {
  overall_score: 8.1,
  per_dimension: [
    { dimension: 'prompt_alignment', score: 9, evidence: 'answers prompt 1', how_to_reach_ten: 'nothing material' },
    { dimension: 'specificity', score: 6, evidence: '"the workshop"', how_to_reach_ten: 'name the machine' },
  ],
  strengths: ['clear arc'], weaknesses: ['abstract middle'], priority_improvements: ['add the number'],
  quoted_evidence: ['"the workshop"'], sounds_like_ai: false, ai_patterns_detected: [], summary: 'Good.',
  word_count: 620, limit: 650, unit: 'words', over_limit: false, under_target: false,
  length_message: '620 of 650 words',
};

const activity = {
  activity_type: 'Robotics',
  // Deliberately over every Common App limit: the editor must warn, not truncate.
  position: 'Captain of the solar car team and lead designer of the front suspension',
  organization: 'Lincoln High',
  description: words(40),
  grade_levels: ['11', '12'], timing: 'School year', hours_per_week: 8, weeks_per_year: 30,
};

const ucasRow = (id, content) => ({
  id, title: \`UCAS \${id}\`, type: 'personal_statement', scope: 'common',
  application_platform: 'ucas', word_limit: 4000, content,
});

const getContext = async () => ({ profileText: '', materialsText: '', applicantText: '' });

const honor = {
  name: 'Japan Physics Olympiad — Silver Medal (top 12 of ~2,400)',
  grade_level: '11', level: 'National',
  note: 'nominated by the school; ceremony in Osaka, March 2025',
};
// An open question parked in the browser store, exactly as applicantQA.js
// saves it: the panel must render the answer box, the feeds badge, and the
// must-include switch without crashing on a real-shaped entry.
globalThis.localStorage.setItem('atlas:applicantQa:v1', JSON.stringify({ entries: [
  { id: 'qa-1', question: 'How many students actually attended the workshops you ran?', why: 'so the WSC entry can show impact instead of a duty list', feeds: 'activities', asked_at: '2026-10-01T10:00:00.000Z', status: 'open', answer: '', include: false, answered_at: '', row_ids: [], analysis: null },
  { id: 'qa-2', question: 'What was your specific role on the thruster team, and how did you get there?', why: 'the profile says "research placement" and nothing else', feeds: 'essays', asked_at: '2026-10-01T10:00:00.000Z', status: 'answered', answer: 'I owned the discharge chamber; a teacher pulled me in after the microwave lab open day.', include: true, answered_at: '2026-10-02T09:00:00.000Z', row_ids: ['r1'], analysis: { status: 'done', insights: 1, facts: 0, note: 'Filed the chamber ownership as a personal point.' } },
] }));

/** Every case is a component plus the props a page really hands it. */
export const cases = {
  'AiStatusPill — first paint (checking)': () => <AiStatusPill />,
  // The sidebar's record of background AI work: idle renders nothing, and the
  // list must survive a running task with a stage detail, a finished one, and a
  // failed one whose error is an Error object.
  'BackgroundTasksPill — idle': () => <BackgroundTasksPill tasks={[]} />,
  'BackgroundTasksPill — running, done, and failed': () => (
    <BackgroundTasksPill tasks={[
      { id: 't1', kind: 'essay', label: 'Applying edits: Roommate essay', stage: 're_review', state: 'running', startedAt: Date.now() - 65000, scope: { essayId: 'e1' } },
      { id: 't2', kind: 'knowledge', label: 'Dissecting materials into sections', stage: 'dissect', detail: '2 of 3: Admitted application', state: 'running', startedAt: Date.now() - 5000, scope: { knowledge: true } },
      { id: 't3', kind: 'application', label: 'Reading the whole application: Stanford', stage: 'application', state: 'done', startedAt: Date.now() - 90000, settledAt: Date.now(), scope: { universityId: 'u1' } },
      { id: 't4', kind: 'essay', label: 'Writing a draft: Why us', stage: 'generate', state: 'failed', error: new Error('The model returned nothing'), startedAt: Date.now() - 20000, settledAt: Date.now(), scope: { essayId: 'e2' } },
    ]} />
  ),
  'AiSetupDialog — open while the provider is read': () => <AiSetupDialog open onOpenChange={() => {}} onStatusChange={() => {}} />,
  'AiSetupDialog — closed': () => <AiSetupDialog open={false} onOpenChange={() => {}} />,
  // The local-model reasoning panel, with the exact shape /api/status returns
  // for a machine running qwen3:8b through Ollama.
  'OllamaReasoning — reasoning model, reasoning on': () => (
    <OllamaReasoning
      status={{
        provider: 'ollama', model: 'qwen3:8b', configured: true, message: '',
        thinking: { supported: true, default_on: true, levels: [], requested: true, on: true, think_budget: 8192, source: 'model' },
        context: { requested: 32768, model_max: 40960, clamped: false },
        notes: [], timeout_ms: 1800000, keep_alive: '30m',
      }}
    />
  ),
  'OllamaReasoning — reasoning switched off by configuration': () => (
    <OllamaReasoning
      status={{
        provider: 'ollama', model: 'qwen3:8b', configured: true, message: '',
        thinking: { supported: true, default_on: true, levels: [], requested: false, on: false, think_budget: 8192, source: 'model' },
        context: { requested: 16384, model_max: 40960, clamped: false },
        notes: [], timeout_ms: 1800000,
      }}
    />
  ),
  'OllamaReasoning — plain model, and a window bigger than the model': () => (
    <OllamaReasoning
      status={{
        provider: 'ollama', model: 'llama3.2', configured: true, message: '',
        thinking: { supported: false, default_on: false, levels: [], requested: null, on: false, think_budget: 8192, source: 'model' },
        context: { requested: 65536, model_max: 131072, clamped: true },
        notes: ['llama3.2 has a 131072-token context, so OLLAMA_NUM_CTX=65536 is reduced to that.'],
      }}
    />
  ),
  'OllamaReasoning — the server has not answered yet': () => <OllamaReasoning status={null} />,
  'LengthMeter — under the band': () => <LengthMeter assessment={assessLength(words(480), personalStatement(''), [])} />,
  'LengthMeter — inside the band': () => <LengthMeter assessment={assessLength(words(620), personalStatement(''), [])} />,
  'LengthMeter — over the ceiling': () => <LengthMeter assessment={assessLength(words(700), personalStatement(''), [])} />,
  'LengthMeter — nothing written': () => <LengthMeter assessment={assessLength('', personalStatement(''), [])} />,
  'LengthMeter — no assessment': () => <LengthMeter assessment={null} />,
  'LengthMeter — compact (UCAS)': () => <LengthMeter assessment={assessLength(words(480), personalStatement(''), [])} compact />,

  'EssayDiffView — full revision': () => (
    <EssayDiffView
      revision={{
        before, after, ops, stats, unit: 'words',
        changes: [{ original: 'It was hard', revised: 'over one summer', reason: 'more specific' }],
        why: 'Made the middle concrete.', protectedItems: ['the workshop scene'],
        gaps: ['name the mentor'], at: new Date().toISOString(),
        summary: 'Sharpened the opening and cut two hedges.',
        scoreBefore: 8.2, scoreAfter: 8.6, scoreDelta: 0.4, repaired: true,
      }}
      onKeep={() => {}} onRestore={() => {}} restoring={false}
    />
  ),
  // The answer Atlas refused: the essay in the editor is still the applicant's own,
  // and the comparison has to say plainly that this version was never applied.
  'EssayDiffView — edit not applied': () => (
    <EssayDiffView
      revision={{
        before, after, ops, stats: { ...stats, preservedRatio: 0.42, rewriteRatio: 0.58 }, unit: 'words',
        changes: [], notApplied: true, redo: true,
        notAppliedReasons: [
          'it replaced 58% of your wording when you asked for an edit (the contract is 80% kept)',
          '2 of your 3 instructions were not carried out',
        ],
        unaddressed: ['we worked hard together'],
      }}
      onKeep={() => {}} onRestore={() => {}} restoring={false} disabled
    />
  ),
  // A flat score that was still kept, and a version put back for a reason the check
  // itself chose — both lines must read in the comparison, not only in a toast.
  'EssayDiffView — set aside after the re-score': () => (
    <EssayDiffView
      revision={{
        before, after, ops, stats, unit: 'words', changes: [],
        scoreBefore: 8, scoreAfter: 8, scoreDelta: 0,
        autoRestored: true, restoreReason: 'the score did not move and 1 phrase the review objected to is still in the draft',
        instructionCheck: { total: 2, missed: 0, declined: 1, unmet: 1, verified: 1, hadNothing: false, items: [
          { instruction: 'Cut the last line', status: 'done', detail: 'the phrase is gone' },
          { instruction: 'Add the workshop date', status: 'declined', detail: 'not in the draft' },
        ] },
      }}
      onKeep={() => {}} onRestore={() => {}} restoring={false} disabled={false}
    />
  ),
  // The edit that left a flagged phrase alone: the page must be able to show the
  // list and the follow-up button, and never assume the change log is complete.
  'EssayDiffView — flagged phrases still present': () => (
    <EssayDiffView
      revision={{
        before, after, ops, stats, unit: 'words', changes: [],
        unaddressed: ['we worked hard together', 'in the end I learned'],
        scoreBefore: 8.2, scoreAfter: 7.9, scoreDelta: -0.3,
        resolvedPhrases: ['It was hard'],
        refused: [{ phrase: 'a turning point', reason: 'the reviewer misread this line; it is the essay\u2019s hinge' }],
        unaddressedNote: '2 of the 3 phrases the review objected to are still in the draft, unchanged.',
      }}
      onKeep={() => {}} onRestore={() => {}} onFixRemaining={() => {}} disabled={false}
    />
  ),
  // The applicant's own instructions, checked against the text: one missed, one
  // verified, one only reported by the model — with a re-score that did not move,
  // which the view must not paint as an improvement.
  'EssayDiffView — instructions checked, score unchanged': () => (
    <EssayDiffView
      revision={{
        before, after, ops, stats, unit: 'words', changes: [],
        scoreBefore: 8.2, scoreAfter: 8.2, scoreDelta: 0,
        instructionCheck: {
          total: 3, missed: 1, declined: 0, verified: 1, hadNothing: false,
          message: '1 of your 3 edit instructions was not carried out.',
          items: [
            { instruction: 'Cut "in the end".', status: 'missed', detail: '\u201cin the end\u201d is still in the draft.' },
            { instruction: 'Keep "solar car".', status: 'done', detail: '\u201csolar car\u201d survives word for word.' },
            { instruction: 'Make the tone warmer.', status: 'reported', detail: 'The editor reports: softened the verbs.' },
          ],
        },
      }}
      onKeep={() => {}} onRestore={() => {}} onFixRemaining={() => {}}
    />
  ),
  // A lower score with the automatic restore on: the comparison stays, marked.
  'EssayDiffView — scored lower and auto-restored': () => (
    <EssayDiffView
      revision={{ before, after, ops, stats, unit: 'words', changes: [], scoreBefore: 8.2, scoreAfter: 7.8, scoreDelta: -0.4, autoRestored: true }}
      onKeep={() => {}} onRestore={() => {}}
    />
  ),
  'EssayDiffView — every flagged phrase resolved': () => (
    <EssayDiffView
      revision={{ before, after, ops, stats, unit: 'words', changes: [], unaddressed: [], resolvedPhrases: ['It was hard', 'but I learned'] }}
      onKeep={() => {}}
    />
  ),
  // handleFixLength and showSnapshotDiff build a revision with no change log.
  'EssayDiffView — length fix only': () => (
    <EssayDiffView revision={{ before, after, ops, stats, unit: 'words', changes: [] }} onKeep={() => {}} />
  ),
  'EssayDiffView — aggressive rewrite': () => (
    <EssayDiffView
      revision={{ before, after, ops, stats: { ...stats, preservedRatio: 0.3 }, unit: 'words', changes: [] }}
      onKeep={() => {}} onRestore={() => {}}
    />
  ),
  'EssayDiffView — no diff': () => <EssayDiffView revision={{ ops: [] }} onKeep={() => {}} />,

  'RevisionProgress — mixed history': () => (
    <RevisionProgress
      entries={[
        { action: 'generate', unit: 'words', wordsBefore: 0, wordsAfter: 480, scoreBefore: null, scoreAfter: null, at: new Date().toISOString() },
        { action: 'repair', unit: 'words', wordsBefore: 480, wordsAfter: 620, scoreBefore: null, scoreAfter: null, note: 'length fixed', at: new Date().toISOString() },
        { action: 'review', unit: 'words', wordsBefore: 620, wordsAfter: 620, scoreBefore: null, scoreAfter: 6.4, at: new Date().toISOString() },
        { action: 'edit', unit: 'words', wordsBefore: 620, wordsAfter: 640, scoreBefore: 6.4, scoreAfter: 8.1, preservedRatio: 0.88, at: new Date().toISOString() },
        { action: 'restore', unit: 'words', wordsBefore: 640, wordsAfter: 620, scoreBefore: 8.1, scoreAfter: 6.4, at: new Date().toISOString() },
        { action: 'manual', unit: 'words', wordsBefore: 620, wordsAfter: 630, at: new Date().toISOString() },
      ]}
      onClear={() => {}}
    />
  ),
  'RevisionProgress — no history': () => <RevisionProgress entries={[]} onClear={() => {}} />,

  'EssayReviewPanel — with a previous score': () => (
    <EssayReviewPanel reviewResult={review} cachedAt={new Date().toISOString()} previousScore={6.4}
      onPolish={() => {}} polishing={false} onReReview={() => {}} reReviewing={false} />
  ),
  'EssayReviewPanel — first review': () => <EssayReviewPanel reviewResult={review} onPolish={() => {}} />,
  'EssayReviewPanel — under target': () => (
    <EssayReviewPanel reviewResult={{ ...review, under_target: true, word_count: 480, length_message: '480 of 650 words' }} onPolish={() => {}} />
  ),
  'EssayReviewPanel — over limit': () => (
    <EssayReviewPanel reviewResult={{ ...review, over_limit: true, word_count: 700, length_message: '700 of 650 words' }} onPolish={() => {}} />
  ),
  'EssayReviewPanel — no review yet': () => <EssayReviewPanel reviewResult={null} onPolish={() => {}} />,

  'UcasStatementEditor — shared budget': () => (
    <UcasStatementEditor
      essays={[ucasRow('q1', 'a'.repeat(1800)), ucasRow('q2', 'b'.repeat(300)), ucasRow('q3', '')]}
      focusId="q2" onChange={() => {}} onFocus={() => {}}
    />
  ),

  'ActivitiesEditor — over-limit fields': () => (
    <ActivitiesEditor value={[activity]} onChange={() => {}} onSharpen={() => {}} sharpeningIndex={null} />
  ),
  // Two entries: the grip, both arrows, and the private keywords box render on
  // every card, and the first/last arrows are disabled at the ends of the list.
  'ActivitiesEditor — two entries with keywords': () => (
    <ActivitiesEditor
      value={[
        { ...activity, keywords: 'raised ¥180,000 over two bake sales; 14 volunteers; started it in grade 10' },
        { ...activity, position: 'Night-shift cook', organization: 'Family restaurant', description: 'Closed the kitchen five nights a week.' },
      ]}
      onChange={() => {}} onSharpen={() => {}} sharpeningIndex={1}
    />
  ),
  'ActivitiesEditor — empty list': () => <ActivitiesEditor value={[]} onChange={() => {}} />,
  'ActivityAiPanel — idle': () => (
    <ActivityAiPanel activities={[activity]} onChange={() => {}} getContext={getContext}
      sharpenIndex={null} onSharpenDone={() => {}} />
  ),

  // Honors: the sharpen affordance, the private note, the over-limit warning,
  // and the empty list must all survive the props the Profile page hands them.
  'HonorsEditor — one entry with note and sharpen': () => (
    <HonorsEditor value={[honor]} onChange={() => {}} onSharpen={() => {}} sharpeningIndex={null} />
  ),
  'HonorsEditor — over-limit name': () => (
    <HonorsEditor value={[{ ...honor, name: words(40) }]} onChange={() => {}} onSharpen={() => {}} sharpeningIndex={0} />
  ),
  'HonorsEditor — empty list': () => <HonorsEditor value={[]} onChange={() => {}} />,
  'HonorsAiPanel — idle': () => (
    <HonorsAiPanel honors={[honor]} onChange={() => {}} getContext={getContext} sharpenIndex={null} onSharpenDone={() => {}} />
  ),

  // The Q&A panel renders from the browser store; it must survive an open
  // question, an answered one, and a missing table — with no model connected.
  'ApplicantQuestionsPanel — store with an open and an answered entry': () => (
    <ApplicantQuestionsPanel inputs={null} rows={[]} materials={[]} tableMissing={false} />
  ),
  'ApplicantQuestionsPanel — table missing': () => (
    <ApplicantQuestionsPanel inputs={null} rows={[]} materials={[]} tableMissing />
  ),
};

export function run() {
  const failures = [];
  let rendered = 0;
  for (const [name, make] of Object.entries(cases)) {
    try {
      const html = renderToStaticMarkup(make());
      rendered += html.length;
    } catch (error) {
      failures.push(\`\${name}: \${error.message}\`);
    }
  }
  return { total: Object.keys(cases).length, failures, rendered };
}
`);

let failures = [];
let total = 0;
let rendered = 0;
try {
const result = await build({
  root,
  logLevel: 'error',
  configFile: false,
  resolve: { alias: { '@': join(root, 'src') } },
  build: {
    ssr: fixtures,
    outDir: workDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { output: { entryFileNames: 'bundle.mjs' } },
  },
});

if (!result) throw new Error('the render-check bundle did not build');

const bundle = join(workDir, 'bundle.mjs');
const { run } = await import(bundle);
({ total, failures, rendered } = run());
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (failures.length) {
  console.error(`render-check: ${failures.length} of ${total} components failed to render`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`render-check: ok (${total} components rendered, ${rendered.toLocaleString()} characters of markup)`);

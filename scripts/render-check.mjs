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
import AiStatusPill from '@/components/AiStatusPill';
import AiSetupDialog from '@/components/AiSetupDialog';
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

/** Every case is a component plus the props a page really hands it. */
export const cases = {
  'AiStatusPill — first paint (checking)': () => <AiStatusPill />,
  'AiSetupDialog — open while the provider is read': () => <AiSetupDialog open onOpenChange={() => {}} onStatusChange={() => {}} />,
  'AiSetupDialog — closed': () => <AiSetupDialog open={false} onOpenChange={() => {}} />,
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
  'ActivitiesEditor — empty list': () => <ActivitiesEditor value={[]} onChange={() => {}} />,
  'ActivityAiPanel — idle': () => (
    <ActivityAiPanel activities={[activity]} onChange={() => {}} getContext={getContext}
      sharpenIndex={null} onSharpenDone={() => {}} />
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

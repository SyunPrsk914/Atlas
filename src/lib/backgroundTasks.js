// A registry of long-running AI work that must outlive the page it started on.
//
// Material reading already runs through a module-level queue (materialJobs.js),
// which is why uploading a file never blocks the app. Essay drafting, reviews,
// edits, the full application review, and the knowledge-base builds used to be
// tied to a page's `useState`: leaving the page lost the status, coming back
// let the applicant start the same job twice, and every other essay in the
// builder was locked while one of them was being written.
//
// This module is the shared ledger for that work. A page starts a task with
// `startBackgroundTask`; the promise runs to completion whether or not the page
// stays mounted (results are persisted by the task itself, through the entity
// API and the per-essay caches in persist.js). Any component can subscribe to
// know what is running — the sidebar pill, the essay editor that must lock ONE
// essay rather than the whole page, the knowledge-base page that must not run
// two refreshes at once.
//
// Pure module: no React, no browser APIs beyond timers.

const tasks = new Map();
/** id → a promise that resolves when that task settles and never rejects. */
const settlements = new Map();
const listeners = new Set();
let counter = 0;

/** How long a finished task stays listed so a page can react to its completion. */
const SETTLED_TTL_MS = 15000;

function publish(task) {
  for (const listener of [...listeners]) {
    try {
      listener(task, listTasks());
    } catch (error) {
      console.error('[atlas] background task listener failed:', error);
    }
  }
}

function snapshot(task) {
  return { ...task, scope: { ...(task.scope || {}) } };
}

/**
 * Starts a job and records it until it settles.
 *
 * @param {object} options
 * @param {string} options.kind       'essay' | 'knowledge' | 'application' | string
 * @param {string} options.label      what the sidebar shows ("Writing a draft: Roommate")
 * @param {object} [options.scope]    what the job locks: { essayId, universityId, knowledge: true }
 * @param {string} [options.stage]    initial stage ('generate', 'review', …)
 * @param {unknown} [options.owner]   an opaque token identifying the page instance that started it
 * @param {(helpers: { setStage: (stage: string, extra?: object) => void, task: object }) => Promise<any>} options.run
 * @returns {{ id: string, promise: Promise<any> }}
 */
export function startBackgroundTask({ kind, label, scope = {}, stage = 'running', owner = null, run }) {
  if (typeof run !== 'function') throw new Error('A background task needs a run() function.');
  counter += 1;
  const id = `task-${Date.now().toString(36)}-${counter}`;
  const task = {
    id, kind: kind || 'task', label: label || 'Working…', scope: { ...scope }, stage,
    owner, state: 'running', startedAt: Date.now(), settledAt: null, error: null, result: undefined,
  };
  tasks.set(id, task);
  publish(snapshot(task));

  const setStage = (nextStage, extra = {}) => {
    const current = tasks.get(id);
    if (!current || current.state !== 'running') return;
    current.stage = nextStage || current.stage;
    Object.assign(current, extra || {});
    publish(snapshot(current));
  };

  const settle = (state, patch) => {
    const current = tasks.get(id);
    if (!current) return;
    Object.assign(current, patch, { state, settledAt: Date.now() });
    publish(snapshot(current));
    const timer = setTimeout(() => {
      if (tasks.get(id) === current) {
        tasks.delete(id);
        settlements.delete(id);
        publish({ ...snapshot(current), state: 'removed' });
      }
    }, SETTLED_TTL_MS);
    // A finished task must not keep a Node process (the verify scripts) alive;
    // browsers return a number here, Node an object with unref().
    const handle = /** @type {{ unref?: () => void } | null} */ (/** @type {unknown} */ (timer));
    if (handle && typeof handle === 'object' && typeof handle.unref === 'function') handle.unref();
  };

  const promise = Promise.resolve()
    .then(() => run({ setStage, task: snapshot(task) }))
    .then((result) => {
      settle('done', { result });
      return result;
    }, (error) => {
      settle('failed', { error: error instanceof Error ? error : new Error(String(error?.message || error || 'Unknown error')) });
      throw error;
    });
  // Anything waiting on this job (a queued section re-examination, see
  // dissectionQueue.js) needs a promise that resolves whatever the outcome is and
  // never rejects, or a failed job would strand the queue behind it.
  settlements.set(id, promise.then(() => undefined, () => undefined));
  // A task that nobody awaits must not surface as an unhandled rejection: the
  // registry already records the failure and the task reported it itself.
  promise.catch(() => undefined);
  return { id, promise };
}

/**
 * Resolves once no running task matches `predicate`.
 *
 * A queue that must not start its job while another one holds the same lock uses
 * this instead of refusing the request: the applicant's click is kept, and the
 * work begins when the way is clear. The number of waits is bounded — a page that
 * keeps starting fresh jobs cannot starve the queue forever — and when the budget
 * runs out the wait ends and the caller decides what to do: the knowledge queue
 * tries to start again, up to `MAX_QUEUE_ATTEMPTS`, then reports that material as
 * failed and moves on to the next one.
 *
 * @param {(task: object) => boolean} [predicate] defaults to every running task
 * @param {{ maxWaits?: number }} [options]
 * @returns {Promise<boolean>} true when the way is clear, false when the budget ran out
 */
export async function waitUntilIdle(predicate = () => true, { maxWaits = 25 } = {}) {
  const matches = () => [...tasks.values()].filter((task) => task.state === 'running' && predicate(snapshot(task)));
  let waits = 0;
  for (;;) {
    const running = matches();
    if (!running.length) return true;
    if (waits >= Math.max(1, Number(maxWaits) || 1)) return false;
    waits += 1;
    await Promise.all(running.map((task) => settlements.get(task.id) || Promise.resolve()));
  }
}

/** The settled result of a task by id, or null when it is unknown or forgotten. */
export function taskResult(id) {
  const task = tasks.get(id);
  if (!task) return null;
  return { state: task.state, result: task.result, error: task.error };
}

/**
 * @param {(task: object, all: object[]) => void} listener called with the task that changed and every listed task
 * @returns {() => void} unsubscribe
 */
export function subscribeBackgroundTasks(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Every task still listed: running ones, plus recently settled ones. */
export function listTasks({ running = false } = {}) {
  const all = [...tasks.values()].map(snapshot);
  return running ? all.filter((task) => task.state === 'running') : all;
}

export function getTask(id) {
  const task = tasks.get(id);
  return task ? snapshot(task) : null;
}

/** The running task that locks this essay, if any. */
export function taskForEssay(essayId) {
  if (!essayId) return null;
  const id = String(essayId);
  for (const task of tasks.values()) {
    if (task.state === 'running' && String(task.scope?.essayId || '') === id) return snapshot(task);
  }
  return null;
}

/** The running task for a scope key such as { knowledge: true } or { universityId }. */
export function findRunningTask(predicate) {
  for (const task of tasks.values()) {
    if (task.state === 'running' && predicate(snapshot(task))) return snapshot(task);
  }
  return null;
}

export function isKnowledgeBusy() {
  return !!findRunningTask((task) => task.kind === 'knowledge' || task.scope?.knowledge);
}

/** Human wording for a running stage, shared by the pill and the editor. */
export const STAGE_LABELS = {
  generate: 'Writing the draft',
  repair: 'Finishing the length',
  review: 'Running the admissions review',
  polish: 'Applying edits',
  re_review: 'Re-scoring the edit',
  restore: 'Restoring your version',
  application: 'Reading the whole application',
  rebuild: 'Rebuilding the knowledge base',
  extend: 'Reading the sources again',
  refresh: 'Re-examining the knowledge base',
  dissect: 'Dissecting a material into sections',
  suggest: 'Reading your materials',
  activity_polish: 'Sharpening the wording',
  running: 'Working',
};

export function describeStage(stage) {
  return STAGE_LABELS[stage] || STAGE_LABELS.running;
}

/** Test hook: forget every task. Never used by the app. */
export function _resetBackgroundTasks() {
  tasks.clear();
  settlements.clear();
  listeners.clear();
}

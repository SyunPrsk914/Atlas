// A queue for re-reading the sections of a material, so several can be asked for
// one after another instead of one click at a time.
//
// The complaint this answers is a workflow one: re-examining a material runs a
// knowledge job, only one knowledge job may run at a time, and every request
// while a job was in flight was refused with "wait for it to finish". With a
// dozen materials that is a dozen watches on a progress bar. Materials ANALYSIS
// already solved this years ago (see materialJobs.js): requests are queued, the
// queue runs one at a time, and each source keeps its own status. This is the
// same shape for the same reason.
//
// What the queue guarantees, and what `run` therefore may assume:
//   - at most one item is in flight, in the order it was asked for;
//   - asking twice for the same material merges into the pending request rather
//     than filing the same sections twice, and a request for the material being
//     re-read right now is noted so it is re-run afterwards;
//   - one item failing does not stop the queue: the failure is its status, and
//     the next item starts;
//   - nothing here touches the database or the model. `run` does (see
//     knowledgeService.js), which keeps this module testable offline.
//
// Pure module: no browser, no React. `npm run verify` exercises it.

/** @typedef {{ id: string, title?: string, force?: boolean, reason?: string }} Job */

/**
 * @param {object} deps
 * @param {(job: Job) => Promise<unknown>} deps.run does the work for one material
 * @param {(event: { type: string, id?: string, status?: object, state: object }) => void} [deps.notify]
 * @returns {{
 *   enqueue: (job: Job) => 'queued'|'running-later'|'merged',
 *   cancel: (id: string) => boolean,
 *   clearWaiting: () => number,
 *   statusFor: (id: string) => object|null,
 *   state: () => { waiting: Job[], current: Job|null, statuses: Record<string, object>, done: number },
 *   subscribe: (listener: (id: string|null, status: object|null, state: object) => void) => () => void,
 * }}
 */
export function createDissectionQueue({ run, notify }) {
  if (typeof run !== 'function') throw new Error('A dissection queue needs a run() function.');
  /** @type {Job[]} */
  const waiting = [];
  /** @type {Map<string, object>} */
  const statuses = new Map();
  /** @type {Set<(id: string|null, status: object|null, state: object) => void>} */
  const listeners = new Set();
  /** @type {Job|null} */
  let current = null;
  /** Ids asked for again while their own job is in flight: re-run when it lands. */
  const again = new Set();
  let doneCount = 0;

  function state() {
    const statusesOut = {};
    for (const [id, status] of statuses) statusesOut[id] = { ...status };
    return {
      waiting: waiting.map((job) => ({ ...job })),
      current: current ? { ...current } : null,
      statuses: statusesOut,
      done: doneCount,
    };
  }

  function publish(id, status) {
    if (status) statuses.set(id, { ...status, at: Date.now() });
    else statuses.delete(id);
    const snapshot = state();
    if (typeof notify === 'function') {
      try {
        notify({ type: status?.state || 'cleared', id, status: statuses.get(id) || null, state: snapshot });
      } catch (error) {
        console.error('[atlas] dissection queue notify failed:', error);
      }
    }
    for (const listener of [...listeners]) {
      try {
        listener(id, statuses.get(id) || null, snapshot);
      } catch (error) {
        console.error('[atlas] dissection queue listener failed:', error);
      }
    }
  }

  function indexOfWaiting(id) {
    return waiting.findIndex((job) => String(job.id) === String(id));
  }

  /** Starts the next waiting job, if nothing is in flight. */
  function drain() {
    if (current) return;
    const next = waiting.shift();
    if (!next) return;
    current = next;
    publish(next.id, { state: 'running', title: next.title || '' });
    Promise.resolve()
      .then(() => run(next))
      .then(
        (result) => {
          finish(next, { state: 'done', title: next.title || '', result });
        },
        (error) => {
          finish(next, { state: 'failed', title: next.title || '', message: String(error?.message || error || 'The re-examination could not run.') });
        },
      );
  }

  function finish(job, status) {
    if (again.has(String(job.id))) {
      again.delete(String(job.id));
      // It was asked for again while it ran — the material may have changed
      // mid-flight, so the answer just written is not necessarily current.
      waiting.unshift({ ...job, force: true, reason: 're-asked while running' });
    }
    current = null;
    doneCount += 1;
    publish(job.id, status);
    drain();
  }

  /**
   * Adds one material to the queue.
   *
   * @param {Job} job `{ id, title, force }` — `force` re-reads a material whose
   *   sections are already filed and unchanged, which is the whole point of
   *   "Re-examine"; `reason` says why the item was queued, for the UI.
   */
  function enqueue(job) {
    const id = String(job?.id ?? '');
    if (!id) return 'merged';
    const status = statuses.get(id);
    if (current && String(current.id) === id) {
      again.add(id);
      return 'running-later';
    }
    const index = indexOfWaiting(id);
    if (index >= 0) {
      // Same material, same job: the newest request wins its place in line.
      waiting[index] = { ...waiting[index], ...job, id, force: job.force || waiting[index].force };
      publish(id, { state: 'queued', title: job.title || '', reason: waiting[index].reason || '' });
      return 'merged';
    }
    waiting.push({ ...job, id });
    publish(id, { state: 'queued', title: job.title || '', reason: job.reason || '' });
    drain();
    return 'queued';
  }

  /** Drops a waiting job. A job already running is left to finish. */
  function cancel(id) {
    const index = indexOfWaiting(id);
    if (index < 0) return false;
    waiting.splice(index, 1);
    publish(String(id), null);
    return true;
  }

  /** Drops everything still waiting and says how many went. */
  function clearWaiting() {
    const count = waiting.length;
    const dropped = waiting.splice(0, waiting.length);
    for (const job of dropped) publish(String(job.id), null);
    return count;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return {
    enqueue, cancel, clearWaiting, state, subscribe,
    statusFor: (id) => (statuses.get(String(id)) ? { ...statuses.get(String(id)) } : null),
  };
}

/** Whether a material's re-examination is pending right now, for the row's UI. */
export function sectionQueueBusyFor(status) {
  return !!status && (status.state === 'queued' || status.state === 'running');
}

/** The one sentence a queued material shows the applicant, in its own row. */
export function describeSectionQueueStatus(status) {
  if (!status) return '';
  if (status.state === 'queued') return 'Queued — it runs when the current job finishes.';
  if (status.state === 'running') return 'Re-examining this source…';
  if (status.state === 'failed') return status.message || 'The re-examination did not finish.';
  if (status.state === 'done') return 'Re-examined.';
  return '';
}

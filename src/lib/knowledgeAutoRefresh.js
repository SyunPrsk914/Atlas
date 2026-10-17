// Keeps the AI Knowledge Base current without anyone pressing Rebuild.
//
// What "current" means here:
//   - a material whose text has been read and analysed but never filed into
//     sections is dissected (see dissectMaterialKnowledge);
//   - when the profile, a material, or a draft changed since the AI items were
//     written, the items are re-examined one by one (refreshApplicantKnowledge),
//     never rebuilt — a rebuild can delete good points, a refresh cannot
//     silently;
//   - when there are sources but no AI items at all, the first build runs.
//
// What it refuses to do:
//   - run in Demo mode or without a live model (demo output is placeholder text
//     and must never be saved as knowledge);
//   - run twice for the same sources, run while another knowledge job is
//     running, or run more often than MIN_INTERVAL_MS;
//   - queue itself in front of the applicant's own AI work: a pass is postponed
//     while an essay or application job is in flight, because every model call
//     in Atlas goes through one FIFO queue (see aiProvider.enqueueAI).
//
// Triggers: Layout mount (a quiet first pass), a material job finishing, a
// profile save, a material create/update/delete, and the knowledge page opening.
// Each trigger only *schedules*; the debounce makes a burst of edits one pass.

import { getKnowledgeAutoUpdate, getStored, setStored } from '@/lib/persist';
import { hasLiveModel } from '@/lib/aiOutcome';
import { materialJobs } from '@/lib/materialService';
import { knowledgeStatus, materialsNeedingDissection, staleDissectionRows } from '@/lib/applicantKnowledge';
import { listTasks } from '@/lib/backgroundTasks';
import {
  readKnowledgeSources, runningKnowledgeTask, startKnowledgeDissection, startKnowledgeRebuild, startKnowledgeRefresh,
} from '@/lib/knowledgeService';

/** Default wait between a trigger and the pass, so a burst of edits is one pass. */
export const DEFAULT_DELAY_MS = 45000;
/** Two automatic passes are never closer than this. */
export const MIN_INTERVAL_MS = 3 * 60 * 1000;
/** How long a pass waits (and re-checks) while the applicant's own AI work is running. */
const BUSY_RETRY_MS = 60000;
/** The most materials one automatic pass files. The rest wait for the next pass. */
const DISSECT_PER_PASS = 2;

const LAST_FINGERPRINT_KEY = 'knowledgeAuto:lastFingerprint';
const LAST_RUN_KEY = 'knowledgeAuto:lastRun';

let timer = null;
let pendingReason = '';
let started = false;
let stopHooks = [];
/** Set once per session when the table is missing: there is nothing to maintain until the schema is applied. */
let tableMissing = false;
/** Listeners told when an automatic pass starts or finishes, so the knowledge page can reload. */
const listeners = new Set();

function notify(event) {
  for (const listener of [...listeners]) {
    try { listener(event); } catch (error) { console.error('[atlas] knowledge auto-update listener failed:', error); }
  }
}

/** @param {(event: { type: 'started'|'finished'|'skipped'|'failed', reason: string, detail?: any }) => void} listener */
export function subscribeKnowledgeAutoRefresh(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Why a pass would not run right now, or '' when it can. */
export function knowledgeAutoRefreshBlocker({ force = false } = {}) {
  if (!force && !getKnowledgeAutoUpdate()) return 'Automatic updates are switched off.';
  if (!hasLiveModel()) return 'No live AI model is connected.';
  if (tableMissing) return 'The knowledge table is missing.';
  if (runningKnowledgeTask()) return 'A knowledge-base job is already running.';
  if (!force) {
    const lastRun = Number(getStored(LAST_RUN_KEY, 0)) || 0;
    if (Date.now() - lastRun < MIN_INTERVAL_MS) return 'A pass ran a moment ago.';
  }
  return '';
}

const userWorkRunning = () => listTasks({ running: true }).some((task) => task.kind !== 'knowledge');

/**
 * One maintenance pass. Safe to call directly (the knowledge page's "Update
 * now" does); the scheduler calls it after the debounce.
 *
 * @returns {Promise<{ ran: string[], skipped: string }>} what ran, or why nothing did
 */
export async function runKnowledgeMaintenance({ force = false, reason = 'manual' } = {}) {
  const blocker = knowledgeAutoRefreshBlocker({ force });
  if (blocker) {
    notify({ type: 'skipped', reason, detail: blocker });
    return { ran: [], skipped: blocker };
  }
  if (!force && userWorkRunning()) {
    // Do not queue a long pass in front of a draft the applicant is waiting for.
    scheduleKnowledgeAutoRefresh(reason, { delayMs: BUSY_RETRY_MS });
    return { ran: [], skipped: 'Waiting for your own AI work to finish first.' };
  }

  let sources;
  try {
    sources = await readKnowledgeSources();
  } catch (error) {
    notify({ type: 'failed', reason, detail: error });
    return { ran: [], skipped: `Could not read the sources: ${String(error?.message || error)}` };
  }
  if (sources.missing) {
    tableMissing = true;
    notify({ type: 'skipped', reason, detail: 'The knowledge table is missing.' });
    return { ran: [], skipped: 'The knowledge table is missing. Run supabase/schema.sql once.' };
  }
  if (sources.inputs.empty) {
    notify({ type: 'skipped', reason, detail: 'Nothing to read yet.' });
    return { ran: [], skipped: 'There is no profile, material, or draft to read yet.' };
  }

  const status = knowledgeStatus(sources.items, sources.inputs.fingerprint);
  const lastFingerprint = getStored(LAST_FINGERPRINT_KEY, '');
  // Sections filed from a material that has since been deleted are removed by
  // the same job that files new ones, so a deletion alone is reason to run it.
  const orphanedSections = staleDissectionRows(sources.materials, sources.items)
    .some((row) => !sources.materials.some((material) => String(material.id) === String(row.source_id)));
  const needsDissection = orphanedSections || (sources.materials.length > 0
    && materialsNeedingDissection(sources.materials, sources.items).length > 0);
  const needsPortrait = !status.built;
  const needsRefresh = status.built && status.stale && lastFingerprint !== sources.inputs.fingerprint;
  if (!needsDissection && !needsPortrait && !needsRefresh) {
    setStored(LAST_RUN_KEY, Date.now());
    notify({ type: 'skipped', reason, detail: 'Already current.' });
    return { ran: [], skipped: 'The knowledge base is already current.' };
  }

  setStored(LAST_RUN_KEY, Date.now());
  notify({ type: 'started', reason });
  const ran = [];
  try {
    if (needsDissection) {
      await startKnowledgeDissection({ owner: 'auto', limit: DISSECT_PER_PASS }).promise;
      ran.push('dissect');
    }
    if (needsPortrait) {
      await startKnowledgeRebuild({ owner: 'auto' }).promise;
      ran.push('build');
    } else if (needsRefresh) {
      await startKnowledgeRefresh({ owner: 'auto' }).promise;
      ran.push('refresh');
    }
    // Remember which sources this pass covered, so a model that leaves one item
    // unstamped cannot make the same pass run again and again.
    setStored(LAST_FINGERPRINT_KEY, sources.inputs.fingerprint);
    notify({ type: 'finished', reason, detail: ran });
  } catch (error) {
    console.warn('[atlas] knowledge auto-update stopped:', error?.message || error);
    notify({ type: 'failed', reason, detail: error });
    return { ran, skipped: String(error?.message || error) };
  }
  return { ran, skipped: '' };
}

/**
 * Asks for a pass soon. Several calls inside the delay collapse into one pass.
 *
 * @param {string} reason what changed ("material saved", "profile saved", …)
 * @param {{ delayMs?: number }} [options]
 */
export function scheduleKnowledgeAutoRefresh(reason = 'change', { delayMs = DEFAULT_DELAY_MS } = {}) {
  if (typeof window === 'undefined') return;
  if (!getKnowledgeAutoUpdate() || !hasLiveModel() || tableMissing) return;
  pendingReason = reason || pendingReason || 'change';
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const why = pendingReason;
    pendingReason = '';
    runKnowledgeMaintenance({ reason: why }).catch(() => undefined);
  }, Math.max(0, delayMs));
}

/** Cancels a scheduled pass (one already running finishes on its own). */
export function cancelScheduledKnowledgeAutoRefresh() {
  if (timer) clearTimeout(timer);
  timer = null;
  pendingReason = '';
}

/**
 * Wires the triggers. Called once from Layout; returns a cleanup. A second
 * call while the first is active is a no-op, so React strict-mode remounts do
 * not double the listeners.
 */
export function startKnowledgeAutoRefresh({ initialDelayMs = 15000 } = {}) {
  if (started || typeof window === 'undefined') return () => undefined;
  started = true;
  // A material that just finished being read and analysed is new knowledge.
  stopHooks.push(materialJobs.subscribe((_id, status) => {
    if (status?.state === 'done') scheduleKnowledgeAutoRefresh('material analysed');
  }));
  scheduleKnowledgeAutoRefresh('app opened', { delayMs: initialDelayMs });
  return () => {
    started = false;
    cancelScheduledKnowledgeAutoRefresh();
    for (const stop of stopHooks) { try { stop(); } catch { /* already stopped */ } }
    stopHooks = [];
  };
}

/** Test hook: forget the session flags. Never used by the app. */
export function _resetKnowledgeAutoRefresh() {
  cancelScheduledKnowledgeAutoRefresh();
  started = false;
  tableMissing = false;
  listeners.clear();
  stopHooks = [];
}

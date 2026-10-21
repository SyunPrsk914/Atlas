// The AI Knowledge Base's data access and its long-running jobs, shared by the
// AI Knowledge Base page and the automatic update (knowledgeAutoRefresh.js).
//
// Every job here runs as a background task (see backgroundTasks.js), so it
// keeps going when the applicant leaves the page, and the page shows what is
// running instead of starting it twice. The jobs themselves live in
// applicantKnowledge.js and take their side effects as parameters; this file
// only wires them to the real database and the real model.

import { base44 } from '@/api/base44Client';
import { getModelOverride } from '@/api/aiProvider';
import { peekAIStatus, runAI } from '@/lib/ai';
import { isLiveOutcome } from '@/lib/aiOutcome';
import {
  buildKnowledgeInputs, rebuildApplicantKnowledge, extendApplicantKnowledge, refreshApplicantKnowledge,
  dissectMaterialKnowledge, materialsNeedingDissection, staleDissectionRows, canDissectMaterial,
} from '@/lib/applicantKnowledge';
import { findRunningTask, startBackgroundTask, waitUntilIdle } from '@/lib/backgroundTasks';
import { createDissectionQueue } from '@/lib/dissectionQueue';

export const MISSING_KNOWLEDGE_TABLE = /applicant_knowledge|ApplicantKnowledge|relation .* does not exist|Could not find the table/i;

export const KNOWLEDGE_TARGET_COLUMNS = ['target_university_id', 'target_essay_id', 'target_platform', 'target_task'];

/**
 * Reads the applicant's sources (profile, materials, drafts) and the saved
 * items. `missing` is true when the knowledge table has not been created yet.
 */
export async function readKnowledgeSources() {
  let missingColumns = base44.capabilities?.missingOptionalColumns?.() || [];
  if (typeof base44.capabilities?.probe === 'function') {
    try { missingColumns = await base44.capabilities.probe(); } catch { /* scope fallbacks remain local if the schema is old */ }
  }
  const [profiles, materials, essays, universities] = await Promise.all([
    base44.entities.Profile.list(),
    base44.entities.Material.list(),
    base44.entities.Essay.list(),
    base44.entities.University.list().catch(() => []),
  ]);
  let items = [];
  let missing = false;
  try {
    items = await base44.entities.ApplicantKnowledge.list();
  } catch (error) {
    if (!MISSING_KNOWLEDGE_TABLE.test(String(error?.message || error))) throw error;
    missing = true;
  }
  return {
    inputs: buildKnowledgeInputs({ profile: profiles, materials, essays }),
    items,
    missing,
    materials,
    universities,
    essays,
    targetScopeLocalOnly: missingColumns.some((column) => KNOWLEDGE_TARGET_COLUMNS.includes(column)),
  };
}

/** The model name recorded on every item a job writes, so an item can be traced to the model that produced it. */
export const currentModelName = () => peekAIStatus()?.model || getModelOverride() || null;

/** The side effects every knowledge job needs. */
function knowledgeDeps() {
  return {
    runAI,
    isLive: isLiveOutcome,
    createRows: (items) => base44.entities.ApplicantKnowledge.bulkCreate(items),
    updateRow: (id, patch) => base44.entities.ApplicantKnowledge.update(id, patch),
    deleteRow: (id) => base44.entities.ApplicantKnowledge.delete(id),
    model: currentModelName(),
  };
}

/** The running knowledge job, if any. Only one may run at a time. */
export function runningKnowledgeTask() {
  return findRunningTask((task) => task.kind === 'knowledge');
}

function startKnowledgeTask({ label, stage, owner, run }) {
  const running = runningKnowledgeTask();
  if (running) {
    throw Object.assign(
      new Error(`${running.label} is still running. Wait for it to finish before starting another knowledge-base job.`),
      { code: 'knowledge_busy' },
    );
  }
  return startBackgroundTask({ kind: 'knowledge', label, scope: { knowledge: true }, stage, owner, run });
}

/** Rebuilds the AI items from the sources as they are saved now. */
export function startKnowledgeRebuild({ owner = null } = {}) {
  return startKnowledgeTask({
    label: 'Rebuilding the knowledge base', stage: 'rebuild', owner,
    run: async () => {
      const fresh = await readKnowledgeSources();
      return rebuildApplicantKnowledge({ inputs: fresh.inputs, existingRows: fresh.items, ...knowledgeDeps() });
    },
  });
}

/** "Go deeper": appends what the sources still hold. */
export function startKnowledgeExtend({ owner = null } = {}) {
  return startKnowledgeTask({
    label: 'Reading the sources again', stage: 'extend', owner,
    run: async () => {
      const fresh = await readKnowledgeSources();
      return extendApplicantKnowledge({ inputs: fresh.inputs, existingRows: fresh.items, ...knowledgeDeps() });
    },
  });
}

/** Re-examines every AI item one by one; keeps, revises, or removes, then adds what is missing. */
export function startKnowledgeRefresh({ owner = null } = {}) {
  return startKnowledgeTask({
    label: 'Re-examining the knowledge base', stage: 'refresh', owner,
    run: async () => {
      const fresh = await readKnowledgeSources();
      return refreshApplicantKnowledge({ inputs: fresh.inputs, existingRows: fresh.items, ...knowledgeDeps() });
    },
  });
}

/**
 * Files the sections of materials that have not been dissected yet (or whose
 * text changed), at most `limit` of them, and removes sections whose material
 * is gone. Returns per-material results so the caller can say what happened.
 */
export function startKnowledgeDissection({ owner = null, limit = 3, materialIds = null, force = false } = {}) {
  return startKnowledgeTask({
    label: 'Dissecting materials into sections', stage: 'dissect', owner,
    run: async ({ setStage }) => {
      const fresh = await readKnowledgeSources();
      if (fresh.missing) return { done: [], skipped: 0, removed: 0, warnings: ['The knowledge table is missing.'] };
      const deps = knowledgeDeps();
      const wanted = materialIds ? new Set(materialIds.map(String)) : null;
      const pending = (force ? fresh.materials.filter(canDissectMaterial) : materialsNeedingDissection(fresh.materials, fresh.items))
        .filter((material) => !wanted || wanted.has(String(material.id)));
      const batch = pending.slice(0, Math.max(0, limit));
      const done = [];
      const warnings = [];
      let rows = fresh.items;
      for (const [index, material] of batch.entries()) {
        setStage('dissect', { detail: `${index + 1} of ${batch.length}: ${material.title || 'material'}` });
        try {
          const outcome = await dissectMaterialKnowledge({
            material, existingRows: rows, universities: fresh.universities, essays: fresh.essays, ...deps,
          });
          done.push({ id: material.id, title: material.title || 'Material', ...outcome });
          warnings.push(...outcome.warnings);
          // Re-read so the next material sees the rows this one just replaced.
          rows = await base44.entities.ApplicantKnowledge.list();
        } catch (error) {
          warnings.push(`“${material.title || 'A material'}” could not be dissected: ${String(error?.message || error)}`);
        }
      }
      // Sections of a material that was deleted, or that changed and was
      // re-filed above, no longer describe anything the applicant has.
      let removed = 0;
      const orphans = staleDissectionRows(fresh.materials, rows)
        .filter((row) => !fresh.materials.some((material) => String(material.id) === String(row.source_id)));
      for (const row of orphans) {
        try {
          await deps.deleteRow(row.id);
          removed += 1;
        } catch {
          warnings.push('An orphaned section could not be removed.');
        }
      }
      return { done, skipped: pending.length - batch.length, removed, warnings };
    },
  });
}

// ---------------------------------------------------------------------------
// Re-examining a material's sections, one after another
// ---------------------------------------------------------------------------
//
// One knowledge job at a time is the rule, so a second request used to be refused
// with "wait for it to finish" and the applicant had to come back and press again
// for each material in turn. The request is queued now: it starts the moment the
// way is clear, every material keeps its own status in the row it was asked from,
// and one material failing does not stop the ones behind it. Nothing about the job
// changed — the same background task, the same lock, the same per-material re-read
// that files sections and keeps the applicant's own edits.

/** How long one queued item keeps asking for the lock before it gives up. */
const MAX_QUEUE_ATTEMPTS = 3;

/** Waits for the knowledge lock, then runs this material's job and returns its result. */
async function runQueuedDissection(job) {
  // A knowledge task started while this item was waiting (a draft being written,
  // the automatic pass) still goes first; the queue never cuts in front of it.
  await waitUntilIdle((task) => task.kind === 'knowledge');
  let lastError = null;
  for (let attempt = 0; attempt < MAX_QUEUE_ATTEMPTS; attempt += 1) {
    try {
      return await startKnowledgeDissection({
        owner: 'section-queue', limit: 1, force: job.force !== false, materialIds: [job.id],
      }).promise;
    } catch (error) {
      if (error?.code !== 'knowledge_busy') throw error;
      lastError = error;
      await waitUntilIdle((task) => task.kind === 'knowledge');
    }
  }
  throw lastError || new Error('The knowledge base is still busy, so this request was not started. Ask again in a moment.');
}

const sectionQueue = createDissectionQueue({ run: runQueuedDissection });

/**
 * Asks for materials to be re-read into sections, in the order given.
 *
 * @param {object|object[]} materials rows (or `{ id, title }` shapes) to re-examine
 * @param {{ force?: boolean }} [options] `force: false` files only what still
 *   needs filing, which is what the "File … into sections" button wants.
 * @returns {{ requested: number, added: number }}
 */
export function queueSectionReExamination(materials, { force = true } = {}) {
  const list = (Array.isArray(materials) ? materials : [materials])
    .filter((material) => material && (material.id || material.key));
  let added = 0;
  for (const material of list) {
    const id = String(material.id ?? material.key);
    const outcome = sectionQueue.enqueue({ id, title: material.title || 'Material', force });
    if (outcome !== 'merged') added += 1;
  }
  return { requested: list.length, added };
}

/** Everything the queue knows: what waits, what runs, and each material's status. */
export function sectionQueueState() {
  return sectionQueue.state();
}

export function sectionQueueStatusFor(id) {
  return sectionQueue.statusFor(id);
}

/** Takes a material out of the queue. A re-read already running finishes on its own. */
export function cancelSectionReExamination(id) {
  return sectionQueue.cancel(id);
}

/** Empties what is waiting, leaving the running job alone. Returns how many went. */
export function clearSectionReExaminationQueue() {
  return sectionQueue.clearWaiting();
}

/** @param {(id: string|null, status: object|null, state: object) => void} listener */
export function subscribeSectionQueue(listener) {
  return sectionQueue.subscribe(listener);
}

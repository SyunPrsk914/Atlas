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
import { findRunningTask, startBackgroundTask } from '@/lib/backgroundTasks';

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

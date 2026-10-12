// Shared targeting rules for material and applicant-knowledge context.
// A blank target means the entry is general. When several targets are set,
// every one must match before the entry is sent to an AI job.

import { PLATFORMS } from './applicationData';
import { getStored, setStored, removeStored } from './persist';

export const CONTEXT_TARGET_COLUMNS = [
  'target_university_id',
  'target_essay_id',
  'target_platform',
  'target_task',
];

export const CONTEXT_TASKS = {
  draft: 'Essay drafts',
  review: 'Essay reviews',
  polish: 'Essay edits',
  length: 'Length fixes',
  application: 'Full application review',
  activity: 'Activity suggestions',
};

const normalized = (value) => String(value ?? '').trim();

export function targetScopeFor(row = {}) {
  if (normalized(row.target_essay_id)) return 'essay';
  if (normalized(row.target_university_id)) return 'university';
  return 'general';
}

export function contextTargetFields(row = {}) {
  return {
    target_university_id: normalized(row.target_university_id) || null,
    target_essay_id: normalized(row.target_essay_id) || null,
    target_platform: normalized(row.target_platform) || null,
    target_task: normalized(row.target_task) || null,
  };
}

/** Whether a targeted record belongs in this exact AI job's context. */
export function matchesContextTarget(row, {
  universityId = '', essayId = '', essayIds = [], platform = '', task = '',
} = {}) {
  const targetUniversity = normalized(row?.target_university_id);
  if (targetUniversity && targetUniversity !== normalized(universityId)) return false;

  const targetEssay = normalized(row?.target_essay_id);
  if (targetEssay) {
    const applicableEssays = new Set([essayId, ...(Array.isArray(essayIds) ? essayIds : [])]
      .map(normalized).filter(Boolean));
    if (!applicableEssays.has(targetEssay)) return false;
  }

  const targetPlatform = normalized(row?.target_platform);
  if (targetPlatform && targetPlatform !== normalized(platform)) return false;

  const targetTask = normalized(row?.target_task);
  if (targetTask && targetTask !== normalized(task)) return false;

  return true;
}

export function filterByContextTarget(rows, context = {}) {
  return (rows || []).filter((row) => matchesContextTarget(row, context));
}

/** Human-readable scope for cards and prompt blocks. */
export function contextTargetLabel(row = {}, { universities = [], essays = [] } = {}) {
  const parts = [];
  const universityId = normalized(row.target_university_id);
  if (universityId) {
    const university = universities.find((item) => String(item.id) === universityId);
    parts.push(university?.name || 'Saved university');
  }

  const essayId = normalized(row.target_essay_id);
  if (essayId) {
    const essay = essays.find((item) => String(item.id) === essayId);
    parts.push(essay?.title || 'Saved essay');
  }

  const targetPlatform = normalized(row.target_platform);
  if (targetPlatform) parts.push(PLATFORMS[targetPlatform]?.short || targetPlatform);

  const targetTask = normalized(row.target_task);
  if (targetTask) parts.push(CONTEXT_TASKS[targetTask] || targetTask);

  return parts.length ? `Only: ${parts.join(' · ')}` : 'All applications and tasks';
}

// Older Supabase projects can run the app before the additive target columns
// are migrated. Keep any target the user saves in this browser until the schema
// is updated; never pretend a field was persisted when Supabase dropped it.
function fallbackKey(entity) {
  return `contextTargetFallback:${entity}`;
}

function fallbackMap(entity) {
  const value = getStored(fallbackKey(entity), {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function pendingContextTargetFallbacks(entity) {
  return Object.entries(fallbackMap(entity)).map(([id, fields]) => ({ id, fields }));
}

export function saveContextTargetFallback(entity, id, fields, missingColumns = CONTEXT_TARGET_COLUMNS) {
  if (!entity || !id) return;
  const missing = new Set(missingColumns || []);
  if (!missing.size) {
    removeContextTargetFallback(entity, id);
    return;
  }
  const map = fallbackMap(entity);
  const prior = map[id] || {};
  const next = { ...prior };
  for (const column of CONTEXT_TARGET_COLUMNS) {
    if (missing.has(column)) {
      if (Object.prototype.hasOwnProperty.call(fields || {}, column)) next[column] = fields[column] ?? null;
    } else {
      // This column has migrated: its database value is authoritative now.
      delete next[column];
    }
  }
  if (Object.keys(next).length) {
    map[id] = next;
    setStored(fallbackKey(entity), map);
  } else {
    delete map[id];
    if (Object.keys(map).length) setStored(fallbackKey(entity), map);
    else removeStored(fallbackKey(entity));
  }
}

export function removeContextTargetFallback(entity, id) {
  if (!entity || !id) return;
  const map = fallbackMap(entity);
  if (!(id in map)) return;
  delete map[id];
  if (Object.keys(map).length) setStored(fallbackKey(entity), map);
  else removeStored(fallbackKey(entity));
}

/** Overlay only fields the current schema cannot return. */
export function mergeContextTargetFallbacks(entity, rows, missingColumns = []) {
  const missing = new Set(missingColumns || []);
  const map = fallbackMap(entity);
  return (rows || []).map((row) => {
    const saved = map[row.id];
    if (!saved) return row;
    const patch = {};
    for (const column of CONTEXT_TARGET_COLUMNS) {
      const databaseValue = row[column];
      const databaseIsBlank = databaseValue === null || databaseValue === undefined || databaseValue === '';
      if ((missing.has(column) || !Object.prototype.hasOwnProperty.call(row, column) || databaseIsBlank)
        && Object.prototype.hasOwnProperty.call(saved, column)) {
        patch[column] = saved[column];
      }
    }
    return Object.keys(patch).length ? { ...row, ...patch } : row;
  });
}

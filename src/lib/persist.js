// Simple localStorage persistence for Atlas.
// Keeps admissions reviews, essay builder state, and other UI selections
// across page navigations and sessions.

const PREFIX = 'atlas:';

function safeParse(json, fallback) {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

export function getStored(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    // Try JSON, fallback to raw string
    const parsed = safeParse(raw, undefined);
    return parsed === undefined ? raw : parsed;
  } catch {
    return fallback;
  }
}

export function setStored(key, value) {
  try {
    const toStore = typeof value === 'string' ? value : JSON.stringify(value);
    // If value is a string that is JSON, we already stringified objects.
    // For raw strings, store as-is but still prefixed; to avoid double-parse issues,
    // store strings directly and objects as JSON.
    if (typeof value === 'string') {
      localStorage.setItem(PREFIX + key, value);
    } else {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    }
  } catch {
    // quota exceeded or private mode — silently ignore
  }
}

export function removeStored(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {}
}

// --- University selection ---
const LAST_UNI_KEY = 'lastUniversityId';
const LAST_ESSAY_KEY = 'lastEssayId';

export function getLastUniversityId() {
  return getStored(LAST_UNI_KEY, null);
}
export function setLastUniversityId(id) {
  if (!id) return;
  setStored(LAST_UNI_KEY, String(id));
}
export function getLastEssayId() {
  return getStored(LAST_ESSAY_KEY, null);
}
export function setLastEssayId(id) {
  if (!id) return;
  setStored(LAST_ESSAY_KEY, String(id));
}

// --- Application review persistence (per university) ---
function reviewKey(universityId) {
  return `review:${universityId}`;
}

export function getCachedReview(universityId) {
  if (!universityId) return null;
  const data = getStored(reviewKey(universityId), null);
  if (!data) return null;
  // Support both legacy raw result and new { result, savedAt } shape
  if (data.result && data.savedAt) return data;
  if (data.acceptance_probability || data.verdict || data.dimensions) {
    return { result: data, savedAt: null };
  }
  return null;
}

export function setCachedReview(universityId, result) {
  if (!universityId || !result) return;
  setStored(reviewKey(universityId), {
    result,
    savedAt: new Date().toISOString(),
  });
}

export function clearCachedReview(universityId) {
  if (!universityId) return;
  removeStored(reviewKey(universityId));
}

// --- Essay review persistence (per essay) ---
function essayReviewKey(essayId) {
  return `essayReview:${essayId}`;
}

export function getCachedEssayReview(essayId) {
  if (!essayId) return null;
  return getStored(essayReviewKey(essayId), null);
}

export function setCachedEssayReview(essayId, reviewResult) {
  if (!essayId || !reviewResult) return;
  setStored(essayReviewKey(essayId), {
    result: reviewResult,
    savedAt: new Date().toISOString(),
  });
}

export function clearCachedEssayReview(essayId) {
  if (!essayId) return;
  removeStored(essayReviewKey(essayId));
}

// --- Essay generation analysis (why this essay) per essay ---
function essayGenKey(essayId) {
  return `essayGen:${essayId}`;
}

export function getCachedEssayGen(essayId) {
  if (!essayId) return null;
  return getStored(essayGenKey(essayId), null);
}

export function setCachedEssayGen(essayId, payload) {
  if (!essayId) return;
  setStored(essayGenKey(essayId), {
    ...payload,
    savedAt: new Date().toISOString(),
  });
}

export function clearCachedEssayGen(essayId) {
  if (!essayId) return;
  removeStored(essayGenKey(essayId));
}

// --- Pre-AI snapshots (per essay) -------------------------------------------
// Every time Atlas replaces text with a model answer it keeps the text it
// replaced. That is what powers "restore the version before this edit" and the
// highlighted original -> edited comparison, and it means an aggressive AI edit
// can never be the end of a draft the applicant wrote themselves.

function essaySnapshotKey(essayId) {
  return `essaySnapshot:${essayId}`;
}

export function getEssaySnapshot(essayId) {
  if (!essayId) return null;
  const saved = getStored(essaySnapshotKey(essayId), null);
  return saved && typeof saved.content === 'string' ? saved : null;
}

export function setEssaySnapshot(essayId, { content, label, review }) {
  if (!essayId) return;
  setStored(essaySnapshotKey(essayId), {
    content: String(content || ''),
    label: String(label || 'previous version'),
    review: review || null,
    savedAt: new Date().toISOString(),
  });
}

export function clearEssaySnapshot(essayId) {
  if (!essayId) return;
  removeStored(essaySnapshotKey(essayId));
}

// --- Score progression (per essay) ------------------------------------------
// One entry per AI action that changed the text, so the applicant can see
// whether editing is actually improving the essay instead of guessing from two
// reviews that may be days apart.

const PROGRESS_LIMIT = 20;

function essayProgressKey(essayId) {
  return `essayProgress:${essayId}`;
}

export function getEssayProgress(essayId) {
  if (!essayId) return [];
  const saved = getStored(essayProgressKey(essayId), []);
  return Array.isArray(saved) ? saved : [];
}

/**
 * @param {object} entry { action, at, wordsBefore, wordsAfter, scoreBefore,
 *   scoreAfter, preservedRatio, note }
 */
export function pushEssayProgress(essayId, entry) {
  if (!essayId || !entry) return [];
  const next = [...getEssayProgress(essayId), { at: new Date().toISOString(), ...entry }].slice(-PROGRESS_LIMIT);
  setStored(essayProgressKey(essayId), next);
  return next;
}

export function clearEssayProgress(essayId) {
  if (!essayId) return;
  removeStored(essayProgressKey(essayId));
}

// --- Editor preferences ------------------------------------------------------
const AUTO_REVIEW_KEY = 'pref:autoReviewAfterEdit';

/**
 * Whether "Apply edits" re-runs the admissions review by itself. On by default:
 * the whole point of an edit is a better score, and without an automatic
 * re-review the applicant cannot tell an improvement from model noise.
 */
export function getAutoReviewAfterEdit() {
  const saved = getStored(AUTO_REVIEW_KEY, null);
  return saved === null ? true : saved === true || saved === 'true';
}

export function setAutoReviewAfterEdit(value) {
  setStored(AUTO_REVIEW_KEY, !!value);
}

const AUTO_RESTORE_WORSE_KEY = 'pref:autoRestoreWorseEdit';

/**
 * Whether an AI edit that re-scores LOWER than the text it replaced is put
 * back by itself. On by default: the applicant asked for edits that make the
 * essay better, and a lower score is the one outcome that must never be kept
 * silently. The snapshot stays either way, so nothing is lost in either mode.
 */
export function getAutoRestoreWorseEdit() {
  const saved = getStored(AUTO_RESTORE_WORSE_KEY, null);
  return saved === null ? true : saved === true || saved === 'true';
}

export function setAutoRestoreWorseEdit(value) {
  setStored(AUTO_RESTORE_WORSE_KEY, !!value);
}

const KNOWLEDGE_AUTO_KEY = 'pref:knowledgeAutoUpdate';

/**
 * Whether the AI knowledge base keeps itself current in the background (new
 * materials are filed, stale items re-examined) without pressing Rebuild.
 * On by default; the AI Knowledge Base page has the switch.
 */
export function getKnowledgeAutoUpdate() {
  const saved = getStored(KNOWLEDGE_AUTO_KEY, null);
  return saved === null ? true : saved === true || saved === 'true';
}

export function setKnowledgeAutoUpdate(value) {
  setStored(KNOWLEDGE_AUTO_KEY, !!value);
}

/**
 * Removes everything this browser has cached for an essay that no longer exists.
 *
 * Deleting a university deletes its school-specific essays with it, and a
 * university row can also be removed from the Universities page. Without this,
 * reviews, snapshots, and history for deleted essays would sit in localStorage
 * forever and could be restored onto a different essay that reuses the id.
 *
 * @param {string|string[]} essayIds
 */
export function clearEssayArtifacts(essayIds) {
  const ids = Array.isArray(essayIds) ? essayIds : [essayIds];
  for (const id of ids) {
    if (!id) continue;
    clearCachedEssayReview(id);
    clearCachedEssayGen(id);
    clearEssaySnapshot(id);
    clearEssayProgress(id);
  }
}

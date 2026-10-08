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

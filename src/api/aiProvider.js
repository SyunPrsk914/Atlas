// The AI provider Atlas uses: NaraRouter through the hosted endpoint.
//
// One provider, one code path, one set of failure modes. Requests go to
// `/api/invoke-llm`, which holds the key server-side, so nothing about the key
// ever reaches the bundle or the browser. The former on-device model path is
// gone; this module replaces the mode/config half of it.
//
// Demo mode stays: with no key configured on the deployment, Atlas returns
// clearly labeled placeholder output and refuses to save it. That is still the
// zero-config onboarding path.

// Relative import on purpose: `src/lib/aiOutcome.js` is loaded by the offline
// verification scripts in plain Node, which resolves relative specifiers but not
// the `@/` alias.
import { makeError } from '../lib/aiError';

/**
 * Bumped from `atlas_ai_mode_v1`, which could hold a value for the removed
 * on-device provider. Reading the old key would resurrect a mode that no longer
 * exists, so the new key starts every browser clean.
 */
export const AI_MODE_KEY = 'atlas_ai_mode_v2';

/**
 * Whether this deployment has a hosted key, as reported by `/api/status`.
 * Cached so `getAIMode()` can stay synchronous for the guards that call it.
 */
export const AI_HOSTED_AVAILABLE_KEY = 'atlas_ai_hosted_available_v1';

export const PROVIDER_LABELS = {
  nararouter: 'NaraRouter',
  gemini: 'Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
};

export function providerLabel(provider) {
  return PROVIDER_LABELS[String(provider || '').toLowerCase()] || provider || 'Hosted AI';
}

function browserStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  return window.localStorage;
}

/** Remembers what `/api/status` reported, so the next page load starts correct. */
export function setHostedAvailable(available, provider = null) {
  const storage = browserStorage();
  if (!storage) return;
  try {
    storage.setItem(AI_HOSTED_AVAILABLE_KEY, available ? '1' : '0');
    if (available && provider) storage.setItem('atlas_ai_provider_v1', String(provider));
  } catch { /* private browsing: the status pill still shows the live truth */ }
}

export function isHostedAvailable() {
  const storage = browserStorage();
  if (!storage) return false;
  try {
    return storage.getItem(AI_HOSTED_AVAILABLE_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberedProvider() {
  const storage = browserStorage();
  if (!storage) return null;
  try {
    return storage.getItem('atlas_ai_provider_v1');
  } catch {
    return null;
  }
}

/**
 * 'hosted' when a real model answers, 'demo' when Atlas returns labeled
 * placeholder text. An explicit choice in AI setup always wins; otherwise Atlas
 * uses the hosted provider when this deployment has one.
 *
 * @returns {'hosted' | 'demo'}
 */
export function getAIMode() {
  const storage = browserStorage();
  if (storage) {
    try {
      const saved = storage.getItem(AI_MODE_KEY);
      if (saved === 'hosted') return 'hosted';
      if (saved === 'demo') return 'demo';
    } catch { /* fall through to the automatic choice */ }
  }
  return isHostedAvailable() ? 'hosted' : 'demo';
}

/** @param {'hosted' | 'demo'} mode */
export function setAIMode(mode) {
  if (!['hosted', 'demo'].includes(mode)) {
    throw makeError('Unknown AI mode. Choose NaraRouter or demo.', { code: 'ai_bad_mode' });
  }
  const storage = browserStorage();
  if (!storage) throw makeError('AI settings are only available in a browser.', { code: 'ai_no_storage' });
  storage.setItem(AI_MODE_KEY, mode);
}

/** Forget an explicit choice and let Atlas follow the deployment again. */
export function clearAIMode() {
  const storage = browserStorage();
  if (!storage) return;
  storage.removeItem(AI_MODE_KEY);
}

/**
 * The model alias the applicant picked in AI setup, if any.
 *
 * Empty means "use the deployment's default" (`NARAROUTER_MODEL`, or the
 * provider's own default). Atlas never hardcodes a guess: an alias the key is
 * not entitled to is a hard 404, so the picker is filled from `/api/models`.
 */
export const AI_MODEL_KEY = 'atlas_ai_model_v1';

export function getModelOverride() {
  const storage = browserStorage();
  if (!storage) return '';
  try {
    return String(storage.getItem(AI_MODEL_KEY) || '').trim();
  } catch {
    return '';
  }
}

export function setModelOverride(model) {
  const storage = browserStorage();
  if (!storage) return;
  const value = String(model || '').trim();
  if (value) storage.setItem(AI_MODEL_KEY, value);
  else storage.removeItem(AI_MODEL_KEY);
}

// ---------------------------------------------------------------------------
// One request at a time
// ---------------------------------------------------------------------------
/**
 * NaraRouter's free plan is rate-limited per minute, and Atlas has features
 * that fire several calls in a row (a long document is analyzed in parts). A
 * FIFO serializer keeps those calls in click order instead of letting them
 * collide into a 429. It adds no app-side quota of its own.
 */
let queue = Promise.resolve();

/**
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
export function enqueueAI(task) {
  const run = queue.then(task, task);
  // Keep the chain alive even when a call fails, and never hold a reference to
  // a settled promise's result.
  queue = run.then(() => undefined, () => undefined);
  return run;
}

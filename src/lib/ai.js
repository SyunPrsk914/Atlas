// One place for every AI call in Atlas: run it, describe exactly what happened,
// and tell the user what to do about it.
//
// Before this existed each page did `catch (e) { console.error(e); alert('Failed
// to run review. Please try again.') }`, which is why "the AI is not integrated"
// was impossible to diagnose: a missing key, an expired session, a rate limit
// and a model safety block all produced the identical dead end.

import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { checkAIStatus } from '@/api/llmClient';

/**
 * Human-readable explanation for anything that can go wrong between the
 * browser and the model.
 * @returns {{ title: string, message: string, action?: { label: string, to: string } }}
 */
export function explainAIError(error, fallbackTitle = 'AI request failed') {
  const message = String(error?.message || error || 'Unknown error');
  const status = error?.status;

  if (status === 401) {
    return {
      title: 'Session expired',
      message,
      action: { label: 'Sign in again', to: '/login' },
    };
  }
  if (status === 429) {
    return { title: 'Rate limited', message };
  }
  if (status === 402) {
    return { title: 'AI key rejected', message };
  }
  if (error?.code === 'unreachable' || error?.code === 'bad_response') {
    return { title: 'AI endpoint not reachable', message };
  }
  if (/Missing Authorization|No API key configured|Could not find the column/i.test(message)) {
    return { title: 'AI is not connected yet', message };
  }
  if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return {
      title: 'Network error',
      message: `${message}. If you are offline, or running the app without the dev server, the AI endpoint cannot be reached.`,
    };
  }
  return { title: fallbackTitle, message };
}

/** Shows an AI failure as a toast with the real reason. Never throws. */
export function notifyAIError(error, fallbackTitle = 'AI request failed') {
  const { title, message, action } = explainAIError(error, fallbackTitle);
  console.error(`[atlas/ai] ${title}:`, error);
  toast.error(title, {
    description: message,
    duration: 9000,
    action: action
      ? { label: action.label, onClick: () => { window.location.href = action.to; } }
      : undefined,
  });
  return { title, message };
}

// ---------------------------------------------------------------------------
// Runtime AI status (used by the header pill and by pre-flight checks)
// ---------------------------------------------------------------------------
let statusPromise = null;
let statusValue = null;

export function getAIStatus() {
  return statusPromise;
}

/** Re-probe the server (called once on mount and after any AI failure). */
export function refreshAIStatus() {
  statusPromise = checkAIStatus()
    .then((s) => {
      statusValue = s;
      return s;
    })
    .catch(() => {
      statusValue = { reachable: false, configured: false };
      return statusValue;
    });
  return statusPromise;
}

export function peekAIStatus() {
  return statusValue;
}

// ---------------------------------------------------------------------------
// The single entry point pages should use
// ---------------------------------------------------------------------------
/**
 * Invoke the model and always return `{ ok, result, meta }` — never throws.
 * Callers branch on `ok` so a failure renders a real message instead of a
 * silently missing essay.
 *
 * @param {object} params      { prompt, response_json_schema, add_context_from_internet, ... }
 * @param {object} opts        { fallbackTitle, quiet }
 */
export async function runAI(params, opts = {}) {
  const { fallbackTitle = 'AI request failed', quiet = false } = opts;
  try {
    const detailed = base44.integrations.Core.InvokeLLMDetailed;
    const { result, meta } = detailed
      ? await detailed(params)
      : { result: await base44.integrations.Core.InvokeLLM(params), meta: {} };

    if (meta?.warning && !quiet) {
      toast.warning(meta.demo ? 'Demo output' : 'Heads up', {
        description: meta.warning,
        duration: 10000,
      });
    }
    // Keep the cached status fresh after a successful call.
    if (statusValue) statusValue = { ...statusValue, configured: true, reachable: true, lastCallOk: true };
    return { ok: true, result, meta: meta || {} };
  } catch (error) {
    if (statusValue) statusValue = { ...statusValue, lastCallError: explainAIError(error, fallbackTitle).title };
    if (!quiet) notifyAIError(error, fallbackTitle);
    return { ok: false, error, meta: {} };
  }
}

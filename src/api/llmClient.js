// Client for /api/invoke-llm — the only real-model path Atlas has. NaraRouter
// is the provider; its key lives server-side and never reaches the bundle.
//
// invokeLLM() keeps the historical contract (returns the parsed object or the
// string) so `base44.integrations.Core.InvokeLLM` is unchanged for callers.
// invokeLLMDetailed() additionally returns the server's `meta` block, which is
// how the UI can tell the user whether a response was web-grounded, produced by
// a demo placeholder, or cut short — instead of guessing.

import { makeError } from '@/lib/aiError';

/** `length` / `max_tokens` means the model was cut off mid-answer. */
export function isTruncatedFinish(finishReason) {
  return ['length', 'max_tokens', 'MAX_TOKENS'].includes(String(finishReason || ''));
}

async function authHeaders(getAuthToken) {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = typeof getAuthToken === 'function' ? await getAuthToken() : null;
    if (token && token !== 'demo-token') headers.Authorization = `Bearer ${token}`;
  } catch { /* proceed without token; server will decide */ }
  return headers;
}

/** @returns {Promise<{ result: any, meta: object }>} */
export async function invokeLLMDetailed(params, getAuthToken) {
  let res;
  try {
    res = await fetch('/api/invoke-llm', {
      method: 'POST',
      headers: await authHeaders(getAuthToken),
      body: JSON.stringify(params),
    });
  } catch {
    throw makeError(
      'Could not reach the AI endpoint at /api/invoke-llm. On Vercel this means the serverless function did not deploy — check that the `api/` folder is committed and redeploy.',
      { code: 'unreachable' },
    );
  }

  let body = {};
  try {
    body = await res.json();
  } catch {
    throw makeError(
      `The AI endpoint returned a non-JSON response (HTTP ${res.status}). If you are running locally, use \`npm run dev\` rather than a static file server — the /api route only exists in the Vite dev server and on Vercel.`,
      { code: 'bad_response', status: res.status },
    );
  }

  if (!res.ok || body.ok === false) {
    throw makeError(body.error || `AI request failed (HTTP ${res.status})`, {
      status: res.status,
      code: body.error?.code || body.code,
      provider: body.provider,
      raw_preview: body.raw_preview,
    });
  }

  const meta = body.meta || {};
  // A provider that stopped at its output cap returned an unfinished answer.
  // Callers treat that as "not done yet" and send the request back, so it is
  // decided in one place rather than re-derived from finish_reason everywhere.
  if (!meta.truncated && isTruncatedFinish(meta.finish_reason)) meta.truncated = true;
  return { result: body.result, meta };
}

export async function invokeLLM(params, getAuthToken) {
  const { result } = await invokeLLMDetailed(params, getAuthToken);
  return result;
}

/**
 * The model aliases this deployment's key can actually call.
 *
 * NaraRouter's authenticated `/v1/models` returns only what the plan entitles,
 * which is the difference between a model picker that works and one that lists
 * aliases the key will 404 on. Never throws: an unreadable list just means the
 * deployment's default model stays in use.
 *
 * @returns {Promise<{ ok: boolean, provider: string|null, models: string[], default_model: string|null, listable: boolean, message?: string }>}
 */
export async function listAIModels() {
  try {
    const res = await fetch('/api/models');
    const body = await res.json().catch(() => null);
    if (!body) return { ok: false, provider: null, models: [], default_model: null, listable: false, message: `HTTP ${res.status}` };
    return body;
  } catch {
    return {
      ok: false, provider: null, models: [], default_model: null, listable: false,
      message: 'No API server found. Run `npm run dev` locally, or redeploy on Vercel so the `api/` functions deploy.',
    };
  }
}

/**
 * Cheap, zero-cost configuration probe for the header status pill. Reports
 * whether a provider key is wired up and whether web grounding is possible.
 * Never throws.
 */
export async function checkAIStatus() {
  try {
    const res = await fetch('/api/status');
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { reachable: false, configured: false, message: `HTTP ${res.status}` };
    }
    return { reachable: true, ...body };
  } catch {
    return {
      reachable: false,
      configured: false,
      message: 'No API server found. Run `npm run dev` locally, or redeploy on Vercel so the `api/` functions deploy.',
    };
  }
}


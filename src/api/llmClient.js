// Optional hosted-provider client for /api/invoke-llm. The default local
// Ollama path is implemented separately in ollamaClient.js and never reaches
// this endpoint. Used only after explicit Hosted mode selection.
//
// invokeLLM() keeps the historical contract (returns the parsed object or the
// string) so `base44.integrations.Core.InvokeLLM` is unchanged for callers.
// invokeLLMDetailed() additionally returns the server's `meta` block, which is
// how the UI can tell the user whether a response was web-grounded, produced by
// a demo placeholder, or cut short — instead of guessing.

import { makeError } from '@/lib/aiError';

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

  return { result: body.result, meta: body.meta || {} };
}

export async function invokeLLM(params, getAuthToken) {
  const { result } = await invokeLLMDetailed(params, getAuthToken);
  return result;
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


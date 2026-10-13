// Ollama (local model server) configuration, shared by the AI endpoint, the
// model list and the status probe. Ollama is OPT-IN: it is used only when
// LLM_PROVIDER=ollama is set on the server. It is never auto-selected, and it
// never receives a request from the browser — the Atlas server calls it.
//
// Safe to import from the Vite dev server and from the serverless functions.

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
export const OLLAMA_DEFAULT_MODEL = 'llama3.2';
// Ollama's own default context is small (2k–4k tokens), and Atlas prompts carry
// whole document parts plus instructions. 16k is a practical default; raise it
// with OLLAMA_NUM_CTX if the machine has the memory for it.
export const OLLAMA_DEFAULT_NUM_CTX = 16384;
const MIN_NUM_CTX = 2048;

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ baseUrl: string, model: string, numCtx: number, problem: string }}
 */
export function ollamaConfig(env = {}) {
  // Accept the OpenAI-style ".../v1" form too; Atlas talks to the native API.
  const rawBase = String(env.OLLAMA_BASE_URL || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
  const baseUrl = rawBase || OLLAMA_DEFAULT_BASE_URL;
  const problem = /^https?:\/\/[^/\s]+/i.test(baseUrl)
    ? ''
    : `OLLAMA_BASE_URL must start with http:// or https:// (for example ${OLLAMA_DEFAULT_BASE_URL}).`;

  const model = String(env.OLLAMA_MODEL || '').trim() || OLLAMA_DEFAULT_MODEL;

  const parsedCtx = Number.parseInt(String(env.OLLAMA_NUM_CTX || ''), 10);
  const numCtx = Number.isFinite(parsedCtx) && parsedCtx >= MIN_NUM_CTX ? parsedCtx : OLLAMA_DEFAULT_NUM_CTX;

  return { baseUrl, model, numCtx, problem };
}

/**
 * Plain-language reason for a network failure that happened before Ollama
 * answered. Node reports these as "fetch failed" with the real code on `cause`.
 * @param {unknown} error
 */
export function describeOllamaNetworkError(error) {
  // With autoSelectFamily, Node may wrap the per-address errors in an
  // AggregateError, so look one level deeper as well.
  const nested = Array.isArray(error?.cause?.errors) ? error.cause.errors : [];
  const code = error?.cause?.code || nested.find((e) => e?.code)?.code || error?.code || '';
  if (code === 'ECONNREFUSED') return 'connection refused: nothing is listening at that address';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the host name could not be resolved';
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT') {
    return 'Ollama did not finish within the wait limit (large prompts on a slow computer can take several minutes; try a smaller model or a shorter document)';
  }
  if (code === 'ETIMEDOUT' || error?.name === 'TimeoutError') return 'the connection timed out';
  return String(error?.cause?.message || error?.message || 'unknown network error');
}

// Ollama (local model server) configuration, shared by the AI endpoint, the
// model list and the status probe. Ollama is OPT-IN: it is used only when
// LLM_PROVIDER=ollama is set on the server. It is never auto-selected, and it
// never receives a request from the browser — the Atlas server calls it.
//
// Reasoning ("thinking") models are configured here too. qwen3:8b is one: it
// writes a private reasoning trace before it writes the answer, and that trace
// is where the depth of the answer comes from. Atlas therefore asks for the
// trace explicitly, reserves output room for it, and keeps the model's own
// sampling guidance instead of the cold temperature a hosted model is happy
// with. Every knob is overridable in `.env.local`; nothing here changes the
// hosted-provider paths.
//
// Safe to import from the Vite dev server and from the serverless functions.

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434';
export const OLLAMA_DEFAULT_MODEL = 'llama3.2';
// Ollama's own default context is small (2k–4k tokens), and Atlas prompts carry
// whole document parts plus instructions. 16k is a practical default; raise it
// with OLLAMA_NUM_CTX if the machine has the memory for it. A reasoning model
// also keeps its trace inside this same window, so it wants more than a plain
// model does: 32768 is the recommended value for qwen3:8b.
export const OLLAMA_DEFAULT_NUM_CTX = 16384;
const MIN_NUM_CTX = 2048;

// --- reasoning ("thinking") controls ----------------------------------------
/** `OLLAMA_THINK` spellings that mean "reason", "do not", "ask the model". */
const THINK_ON = ['on', 'true', 'yes', '1', 'think', 'enabled'];
const THINK_OFF = ['off', 'false', 'no', '0', 'nothink', 'disabled'];
const THINK_AUTO = ['', 'auto', 'default', 'model'];
/** Model-defined effort levels (gpt-oss and friends). Passed through verbatim. */
const THINK_LEVELS = ['low', 'medium', 'high', 'max'];

/** Reasoning is asked for by default: a thinking model left to a global `/set nothink` or a Modelfile would silently lose its depth. */
export const OLLAMA_DEFAULT_THINK = 'on';
/**
 * Tokens of output room reserved for the reasoning trace, on top of whatever
 * the caller asked for as the answer. Ollama counts the trace against
 * `num_predict`, so a cap written for the answer alone is spent on reasoning
 * and the answer comes back empty.
 */
export const OLLAMA_DEFAULT_THINK_BUDGET = 8192;
const MIN_THINK_BUDGET = 1024;

/**
 * Sampling floor and defaults for a reasoning run. Qwen3's and DeepSeek-R1's
 * published guidance for thinking mode is Temperature 0.6, TopP 0.95, TopK 20,
 * MinP 0, with an explicit "DO NOT use greedy decoding, as it can lead to
 * performance degradation and endless repetitions". Atlas's cold scoring
 * temperatures (0.15 for a review) are below that floor, so they are raised
 * while reasoning is on. Set OLLAMA_MIN_TEMPERATURE=0 to keep Atlas's numbers
 * untouched.
 */
export const OLLAMA_DEFAULT_MIN_TEMPERATURE = 0.6;
export const OLLAMA_DEFAULT_TOP_P = 0.95;
export const OLLAMA_DEFAULT_TOP_K = 20;

/**
 * Wall-clock ceiling for one call, in milliseconds. Deep reasoning on a laptop
 * CPU legitimately takes many minutes, so the ceiling is generous — and it is
 * enforced by Atlas rather than by Node's fetch, which would otherwise cut the
 * request at its own 300-second transport timeout.
 */
export const OLLAMA_DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_TIMEOUT_MS = 15000;
/**
 * How long Ollama keeps the model in memory after a call. Ollama's own default
 * is 5 minutes, which means every AI action after a short reading pause pays
 * the full model-load cost again.
 */
export const OLLAMA_DEFAULT_KEEP_ALIVE = '30m';
// `0` (unload as soon as the call ends) and `-1` (never unload) are both valid
// Ollama values and both matter on a machine short of video memory.
const KEEP_ALIVE_PATTERN = /^(-1|0|\d+(?:ns|us|µs|ms|s|m|h))$/;

/**
 * An optional whole number: '' means "do not send it at all", which for
 * `num_gpu` means Ollama decides how much of the model to put on the GPU.
 */
function optionalCountSetting(raw, { min, name }) {
  const text = String(raw ?? '').trim();
  if (text === '') return { value: null, note: '' };
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    return { value: null, note: `${name}="${raw}" is not a whole number of ${min} or more, so Atlas leaves the choice to Ollama.` };
  }
  return { value: parsed, note: '' };
}

function numberSetting(raw, { fallback, min, max, name }) {
  const text = String(raw ?? '').trim();
  if (text === '') return { value: fallback, note: '' };
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return { value: fallback, note: `${name}="${raw}" is not a number, so Atlas used ${fallback}.` };
  }
  if (min !== undefined && parsed < min) {
    return { value: fallback, note: `${name}="${raw}" is below the ${min} minimum, so Atlas used ${fallback}.` };
  }
  if (max !== undefined && parsed > max) {
    return { value: max, note: `${name}="${raw}" is above the ${max} maximum, so Atlas used ${max}.` };
  }
  return { value: parsed, note: '' };
}

/**
 * @param {unknown} raw the OLLAMA_THINK value
 * @returns {{ think: true | false | string | null, note: string }} `null` means
 *   "send no `think` field and let the model decide".
 */
function thinkSetting(raw) {
  const value = String(raw ?? '').trim().toLowerCase();
  if (THINK_AUTO.includes(value)) return { think: null, note: '' };
  if (THINK_ON.includes(value)) return { think: true, note: '' };
  if (THINK_OFF.includes(value)) return { think: false, note: '' };
  if (THINK_LEVELS.includes(value)) return { think: value, note: '' };
  return {
    think: true,
    note: `OLLAMA_THINK="${raw}" is not one of on | off | auto | low | medium | high | max, so Atlas asked for reasoning ("on").`,
  };
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{
 *   baseUrl: string, model: string, numCtx: number, problem: string,
 *   think: true | false | string | null, thinkBudget: number,
 *   minTemperature: number, topP: number, topK: number,
 *   timeoutMs: number, numGpu: number|null, keepAlive: string, warnings: string[]
 * }}
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

  const { think, note: thinkNote } = thinkSetting(env.OLLAMA_THINK === undefined ? OLLAMA_DEFAULT_THINK : env.OLLAMA_THINK);
  const budget = numberSetting(env.OLLAMA_THINK_BUDGET, {
    fallback: OLLAMA_DEFAULT_THINK_BUDGET, min: MIN_THINK_BUDGET, name: 'OLLAMA_THINK_BUDGET',
  });
  // A floor of 0 means "never touch Atlas's temperature".
  const minTemperature = numberSetting(env.OLLAMA_MIN_TEMPERATURE, {
    fallback: OLLAMA_DEFAULT_MIN_TEMPERATURE, min: 0, max: 2, name: 'OLLAMA_MIN_TEMPERATURE',
  });
  const topP = numberSetting(env.OLLAMA_TOP_P, {
    fallback: OLLAMA_DEFAULT_TOP_P, min: 0, max: 1, name: 'OLLAMA_TOP_P',
  });
  const topK = numberSetting(env.OLLAMA_TOP_K, {
    fallback: OLLAMA_DEFAULT_TOP_K, min: 0, max: 4096, name: 'OLLAMA_TOP_K',
  });
  const timeout = numberSetting(env.OLLAMA_TIMEOUT_MS, {
    fallback: OLLAMA_DEFAULT_TIMEOUT_MS, min: MIN_TIMEOUT_MS, name: 'OLLAMA_TIMEOUT_MS',
  });
  const numGpu = optionalCountSetting(env.OLLAMA_NUM_GPU, { min: 0, name: 'OLLAMA_NUM_GPU' });
  const keepAlive = String(env.OLLAMA_KEEP_ALIVE ?? OLLAMA_DEFAULT_KEEP_ALIVE).trim() || OLLAMA_DEFAULT_KEEP_ALIVE;
  const keepAliveOk = KEEP_ALIVE_PATTERN.test(keepAlive);

  return {
    baseUrl,
    model,
    numCtx,
    problem,
    think,
    thinkBudget: Math.floor(budget.value),
    minTemperature: minTemperature.value,
    topP: topP.value,
    topK: Math.floor(topK.value),
    timeoutMs: Math.floor(timeout.value),
    numGpu: numGpu.value,
    keepAlive: keepAliveOk ? keepAlive : OLLAMA_DEFAULT_KEEP_ALIVE,
    // A bad value is never used silently: it is reported by /api/status and
    // appended to the AI answer's warning, and the default takes its place.
    warnings: [
      thinkNote,
      budget.note,
      minTemperature.note,
      topP.note,
      topK.note,
      timeout.note,
      numGpu.note,
      keepAliveOk ? '' : `OLLAMA_KEEP_ALIVE="${keepAlive}" is not an Ollama duration (for example 30m, 1h, -1), so Atlas used ${OLLAMA_DEFAULT_KEEP_ALIVE}.`,
    ].filter(Boolean),
  };
}

/**
 * Plain-language reason for a network failure that happened before Ollama
 * answered. Node reports these as "fetch failed" with the real code on `cause`,
 * or with the code directly on the error for a raw http request.
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

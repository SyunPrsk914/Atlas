// Browser-side Ollama client. Calls the user's loopback server directly; Atlas
// never sends local-model prompts through Vercel or another hosted proxy.
import { makeError } from '../lib/aiError';

export const OLLAMA_CONFIG_KEY = 'atlas_ollama_config_v1';
export const AI_MODE_KEY = 'atlas_ai_mode_v1';
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_MODEL = 'llama3.2:latest';
/**
 * Context window requested for every local call. Ollama's default is much
 * smaller, and a longer prompt would be cut off without any error. 16k tokens
 * fits the largest prompt Atlas builds (profile, materials, knowledge base, and
 * the essay or the analysed part) plus the answer.
 */
export const OLLAMA_NUM_CTX = 16384;

/**
 * Ceiling for the automatic context sizing below. Raising `num_ctx` costs VRAM,
 * so Atlas only goes as far as a normal local model can handle and then says
 * that the prompt had to be clipped.
 */
export const OLLAMA_MAX_NUM_CTX = 32768;

/**
 * Output tokens requested for every local call.
 *
 * `-1` means "generate until the model stops". This used to be left unset, and
 * Ollama's documented default for `num_predict` is 128 tokens — roughly 90
 * words. That single missing option is why a 650-word essay could come back as
 * a fragment and still be saved as the finished draft. Request options override
 * anything a Modelfile sets, so this is now explicit on every call.
 */
export const OLLAMA_NUM_PREDICT = -1;

/**
 * Output tokens reserved when sizing `num_ctx` for a call whose caller did not
 * say how much it expects back. Enough for a long essay plus a JSON analysis.
 */
const RESERVED_OUTPUT_TOKENS = 2560;

/** Rough tokenizer: English prose averages about four characters per token. */
const CHARS_PER_TOKEN = 4;

export function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN);
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Generation options for one call.
 *
 * `num_ctx` is sized from the actual prompt instead of being a fixed guess: if
 * the prompt plus the expected answer would not fit in 16k, the window is
 * raised (up to {@link OLLAMA_MAX_NUM_CTX}) rather than letting Ollama silently
 * drop the beginning of the prompt — which is how a draft could come back
 * ignoring the profile and the materials that were sent to it.
 */
export function buildOllamaOptions(prompt, params = {}) {
  const requestedOutput = Number(params.max_output_tokens);
  const outputTokens = Number.isFinite(requestedOutput) && requestedOutput > 0
    ? requestedOutput
    : RESERVED_OUTPUT_TOKENS;
  const promptTokens = estimateTokens(prompt) + 64;
  const needed = promptTokens + outputTokens;
  const numCtx = clampNumber(needed, OLLAMA_NUM_CTX, OLLAMA_MAX_NUM_CTX);

  const options = { num_ctx: numCtx, num_predict: OLLAMA_NUM_PREDICT };
  const temperature = Number(params.temperature);
  if (Number.isFinite(temperature)) options.temperature = clampNumber(temperature, 0, 2);
  const topP = Number(params.top_p);
  if (Number.isFinite(topP)) options.top_p = clampNumber(topP, 0.05, 1);

  return {
    options,
    numCtx,
    promptTokens,
    outputTokens,
    contextRaised: numCtx > OLLAMA_NUM_CTX,
    // Even at the ceiling the prompt may not fit; the caller must know, because
    // Ollama drops text without reporting an error.
    promptMayBeClipped: needed > OLLAMA_MAX_NUM_CTX,
  };
}

/** `done_reason === 'length'` means the model was cut off mid-answer. */
export function isTruncatedFinish(finishReason) {
  return ['length', 'max_tokens', 'MAX_TOKENS'].includes(String(finishReason || ''));
}

let ollamaQueue = Promise.resolve();

function isCloudModel(name) {
  return /(?:^|[:.-])cloud(?:$|[:.-])/i.test(String(name || ''));
}

function browserStorage() {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('Local AI settings are only available in a browser.');
  }
  return window.localStorage;
}

/**
 * Ollama must remain on this computer. Only loopback URLs are accepted so a
 * setting cannot accidentally point Atlas at an Ollama instance on the public
 * internet or another machine.
 */
export function normalizeOllamaBaseUrl(value = DEFAULT_OLLAMA_BASE_URL) {
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw makeError('Enter a valid Ollama URL, such as http://127.0.0.1:11434.', { code: 'ollama_bad_url' });
  }

  const host = url.hostname.toLowerCase();
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  if (url.protocol !== 'http:' || !isLoopback || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw makeError(
      'For safety, Atlas only accepts a local Ollama URL on this computer (http://127.0.0.1:11434, localhost, or ::1). Do not expose Ollama to the public internet.',
      { code: 'ollama_bad_url' },
    );
  }

  return url.origin.replace(/\/$/, '');
}

export function getOllamaConfig() {
  try {
    const raw = browserStorage().getItem(OLLAMA_CONFIG_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (!saved?.baseUrl || !saved?.model || isCloudModel(saved.model)) return null;
    return {
      baseUrl: normalizeOllamaBaseUrl(saved.baseUrl),
      model: String(saved.model).trim(),
    };
  } catch {
    return null;
  }
}

export function getAIMode() {
  try {
    const saved = browserStorage().getItem(AI_MODE_KEY);
    if (saved === 'hosted') return 'hosted';
    if (saved === 'demo') return 'demo';
    if (saved === 'ollama' && getOllamaConfig()) return 'ollama';
  } catch { /* first visit or storage unavailable: use the labeled demo */ }
  return getOllamaConfig() ? 'ollama' : 'demo';
}

export function setAIMode(mode) {
  if (!['ollama', 'hosted', 'demo'].includes(mode)) {
    throw new Error('Unknown AI mode. Choose Ollama, hosted, or demo.');
  }
  browserStorage().setItem(AI_MODE_KEY, mode);
}

function originHint() {
  return typeof window !== 'undefined' ? window.location.origin : 'the Atlas page origin';
}

async function fetchTags(baseUrl) {
  const normalized = normalizeOllamaBaseUrl(baseUrl);
  let response;
  try {
    response = await fetch(`${normalized}/api/tags`, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  } catch (error) {
    throw makeError(
      `Could not read Ollama at ${normalized}/api/tags. Make sure Ollama is running and set OLLAMA_ORIGINS to include ${originHint()}. Keep Ollama bound to 127.0.0.1; do not expose it to the public internet. Browser detail: ${error?.message || 'network or CORS error'}`,
      { code: 'ollama_unreachable', cause: error },
    );
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw makeError(
      payload.error || `Ollama /api/tags returned HTTP ${response.status}.`,
      { code: 'ollama_probe_failed', status: response.status },
    );
  }

  const models = Array.isArray(payload.models)
    ? payload.models
      .map((item) => String(item?.name || item?.model || '').trim())
      .filter((name) => name && !isCloudModel(name))
    : [];
  return { baseUrl: normalized, models };
}

/** Probe /api/tags. Saving the model setting always performs this probe first. */
export async function probeOllama(baseUrl = DEFAULT_OLLAMA_BASE_URL) {
  return fetchTags(baseUrl);
}

function resolveInstalledModel(requested, models) {
  const model = String(requested || '').trim();
  if (!model || isCloudModel(model)) return null;
  const found = models.find((installed) => installed === model)
    || models.find((installed) => installed.replace(/:latest$/, '') === model)
    || models.find((installed) => installed === `${model}:latest`);
  return found || null;
}

/** Probe tags, verify the selected model is installed, then persist the choice. */
export async function configureOllama({ baseUrl, model }) {
  const result = await fetchTags(baseUrl);
  if (isCloudModel(model)) {
    throw makeError('Atlas requires an on-device Ollama model. Ollama cloud models are not used by the local free path.', { code: 'ollama_cloud_model' });
  }
  const selectedModel = resolveInstalledModel(model, result.models);
  if (!selectedModel) {
    const available = result.models.length ? ` Installed models: ${result.models.join(', ')}.` : ' No models are installed yet.';
    throw makeError(
      `Model "${String(model || '').trim() || '(empty)'}" was not found in Ollama /api/tags.${available} Run "ollama pull ${String(model || 'llama3.2').trim() || 'llama3.2'}" and try again.`,
      { code: 'ollama_model_missing', models: result.models },
    );
  }

  const config = { baseUrl: result.baseUrl, model: selectedModel };
  browserStorage().setItem(OLLAMA_CONFIG_KEY, JSON.stringify(config));
  setAIMode('ollama');
  return { ...config, models: result.models };
}

function parseJSON(text) {
  if (typeof text !== 'string') return null;
  const candidates = [text.trim()];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch { /* try the next extracted candidate */ }
  }
  return null;
}

function promptWithSchema(prompt, schema, strictRetry = false) {
  if (!schema) return prompt;
  const lead = strictRetry
    ? 'STRICT JSON RETRY: Your previous response was not valid JSON. Return exactly one complete JSON value, with no markdown, no commentary, no trailing commas, and no text before or after it. Follow this schema exactly.'
    : 'Respond with only one valid JSON value matching this schema. Do not include markdown fences or commentary.';
  return `${prompt}\n\n${lead}\n${JSON.stringify(schema)}`;
}

async function requestOllama(config, prompt, schema, options) {
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options,
      ...(schema ? { format: schema } : {}),
    }),
  }).catch((error) => {
    throw makeError(
      `Could not reach local Ollama at ${config.baseUrl}. Make sure it is running and allow ${originHint()} in OLLAMA_ORIGINS. Ollama must stay local; do not expose port 11434 to the public internet. Browser detail: ${error?.message || 'network or CORS error'}`,
      { code: 'ollama_unreachable', cause: error },
    );
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeError(
      payload.error || `Ollama /api/chat failed (HTTP ${response.status}).`,
      { status: response.status, code: 'ollama_request_failed', provider: 'ollama' },
    );
  }

  const text = payload?.message?.content ?? payload?.response ?? '';
  if (!String(text).trim()) {
    throw makeError(
      isTruncatedFinish(payload?.done_reason)
        ? `Ollama returned nothing it could use: the model hit its output limit before writing an answer (done_reason "${payload.done_reason}").`
        : payload?.error || 'Ollama returned an empty response.',
      { status: 502, code: 'ollama_empty_response', provider: 'ollama', finish_reason: payload?.done_reason || '' },
    );
  }

  return {
    text: String(text),
    model: payload.model || config.model,
    finishReason: payload.done_reason || '',
    truncated: isTruncatedFinish(payload.done_reason),
    evalCount: Number(payload.eval_count) || 0,
  };
}

/** Every local answer carries the same provenance, including whether it was cut short. */
function ollamaMeta(response, extra = {}) {
  const warnings = ['Not web-grounded: this Ollama answer used the local model and the text supplied to Atlas; no web search was used.'];
  if (response.truncated) {
    warnings.unshift('This answer was cut off by the model before it finished (done_reason "length"), so it may end mid-sentence. Atlas will not treat a truncated answer as a finished draft.');
  }
  if (extra.contextRaised) {
    warnings.push(`The context window was raised to ${extra.numCtx.toLocaleString()} tokens for this call so the whole prompt and answer would fit.`);
  }
  if (extra.promptMayBeClipped) {
    warnings.push(`This prompt is about ${extra.promptTokens.toLocaleString()} tokens — longer than the ${OLLAMA_MAX_NUM_CTX.toLocaleString()}-token window Atlas will request, so Ollama may have dropped part of it. Remove a material or two from the prompt and try again.`);
  }
  return {
    provider: 'ollama',
    model: response.model,
    grounded: false,
    demo: false,
    finish_reason: response.finishReason,
    truncated: !!response.truncated,
    num_ctx: extra.numCtx || null,
    prompt_tokens: extra.promptTokens || null,
    warning: warnings.join(' '),
  };
}

async function runOllamaRequest(params, config) {
  const schema = params.response_json_schema || null;
  const prompt = String(params.prompt || '');
  const sizing = buildOllamaOptions(promptWithSchema(prompt, schema), params);
  const first = await requestOllama(config, promptWithSchema(prompt, schema), schema, sizing.options);

  if (!schema) {
    return { result: first.text, meta: ollamaMeta(first, sizing) };
  }

  const parsedFirst = parseJSON(first.text);
  if (parsedFirst !== null) {
    return { result: parsedFirst, meta: ollamaMeta(first, sizing) };
  }

  // Keep the retry inside this queued task, so another request cannot jump in
  // between the first attempt and its stricter JSON retry.
  const retry = await requestOllama(config, promptWithSchema(prompt, schema, true), schema, sizing.options);
  const parsedRetry = parseJSON(retry.text);
  if (parsedRetry === null) {
    throw makeError(
      retry.truncated
        ? `Ollama model "${retry.model}" was cut off before it finished the JSON answer (done_reason "length"), so the response could not be parsed. The prompt is probably too long for the model's output budget — send fewer materials, or ask for a shorter answer.`
        : `Ollama model "${retry.model}" returned invalid JSON after one stricter retry. The last response could not be parsed.`,
      {
        status: 502,
        code: retry.truncated ? 'ollama_truncated_json' : 'ollama_invalid_json',
        raw_preview: retry.text.slice(0, 400),
        provider: 'ollama',
        finish_reason: retry.finishReason,
      },
    );
  }

  return { result: parsedRetry, meta: ollamaMeta(retry, sizing) };
}

/** Run local inference in click order; queued requests never fail just because another call is active. */
export function invokeOllamaDetailed(params, suppliedConfig = getOllamaConfig()) {
  if (!suppliedConfig) {
    return Promise.reject(makeError('No local Ollama model is configured. Open AI setup to connect one.', { code: 'ollama_not_configured' }));
  }
  const config = {
    baseUrl: normalizeOllamaBaseUrl(suppliedConfig.baseUrl),
    model: String(suppliedConfig.model || '').trim(),
  };
  if (!config.model) {
    return Promise.reject(makeError('No Ollama model is selected. Open AI setup to choose one.', { code: 'ollama_not_configured' }));
  }

  const queued = ollamaQueue.then(
    () => runOllamaRequest(params, config),
    () => runOllamaRequest(params, config),
  );
  ollamaQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

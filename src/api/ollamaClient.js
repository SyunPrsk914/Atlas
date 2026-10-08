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

async function requestOllama(config, prompt, schema) {
  const response = await fetch(`${config.baseUrl}/api/chat`, {
    method: 'POST',
    mode: 'cors',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      options: { num_ctx: OLLAMA_NUM_CTX },
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
      payload?.error || 'Ollama returned an empty response.',
      { status: 502, code: 'ollama_empty_response', provider: 'ollama' },
    );
  }

  return {
    text: String(text),
    model: payload.model || config.model,
    finishReason: payload.done_reason || '',
  };
}

async function runOllamaRequest(params, config) {
  const schema = params.response_json_schema || null;
  const prompt = String(params.prompt || '');
  const first = await requestOllama(config, promptWithSchema(prompt, schema), schema);

  if (!schema) {
    return {
      result: first.text,
      meta: {
        provider: 'ollama',
        model: first.model,
        grounded: false,
        demo: false,
        finish_reason: first.finishReason,
        warning: 'Not web-grounded: this Ollama answer used the local model and the text supplied to Atlas; no web search was used.',
      },
    };
  }

  const parsedFirst = parseJSON(first.text);
  if (parsedFirst !== null) {
    return {
      result: parsedFirst,
      meta: {
        provider: 'ollama',
        model: first.model,
        grounded: false,
        demo: false,
        finish_reason: first.finishReason,
        warning: 'Not web-grounded: this Ollama answer used the local model and the text supplied to Atlas; no web search was used.',
      },
    };
  }

  // Keep the retry inside this queued task, so another request cannot jump in
  // between the first attempt and its stricter JSON retry.
  const retry = await requestOllama(config, promptWithSchema(prompt, schema, true), schema);
  const parsedRetry = parseJSON(retry.text);
  if (parsedRetry === null) {
    throw makeError(
      `Ollama model "${retry.model}" returned invalid JSON after one stricter retry. The last response could not be parsed.`,
      { status: 502, code: 'ollama_invalid_json', raw_preview: retry.text.slice(0, 400), provider: 'ollama' },
    );
  }

  return {
    result: parsedRetry,
    meta: {
      provider: 'ollama',
      model: retry.model,
      grounded: false,
      demo: false,
      finish_reason: retry.finishReason,
      warning: 'Not web-grounded: this Ollama answer used the local model and the text supplied to Atlas; no web search was used.',
    },
  };
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

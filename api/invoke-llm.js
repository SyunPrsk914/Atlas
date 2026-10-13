// /api/invoke-llm — the AI endpoint. NaraRouter is the provider Atlas ships
// with; the key stays server-side and never reaches the browser bundle.
//
// This is the only path to a real model: every AI feature in the app calls it.
// The key is configured server-side and the provider's own quotas and prices
// remain in force — Atlas adds none of its own.
//
// Providers: NaraRouter is the default (chosen when NARAROUTER_API_KEY is set).
// Ollama runs a model on this computer and is used ONLY when LLM_PROVIDER=ollama
// is set explicitly; see api/ollamaConfig.js, api/ollamaChat.js,
// api/ollamaReasoning.js and DEPLOYMENT.md (Part 2.7).
//
// Request body (POST):
//   {
//     prompt: string,                     // required
//     response_json_schema?: object,      // JSON Schema -> returns parsed object
//     add_context_from_internet?: bool,   // web grounding (Gemini only)
//     model?: string,                     // provider model or alias
//     max_tokens?: number,
//     temperature?: number                // clamped to 0-2
//   }
// Response: { ok: true, result: <string|object>, meta: {...} }
//
// `meta` is new and purely additive — older clients that only read `result`
// keep working. It tells the UI what actually happened, which is what the
// Knowledge Base / Essay Builder screens need in order to stop guessing:
//   { provider, model, grounded, demo, warning, finish_reason }
// For a local Ollama it also carries what the run actually did:
//   { thinking, reasoning_chars, recovered_from_thinking, sampling }
// `finish_reason` of "length"/"max_tokens" means the answer was cut off; the
// client turns that into `meta.truncated` so essay actions can send it back.
//
// This module is used BOTH as a Vercel function (export default) and by the
// Vite dev server middleware (export handleInvokeLLM), so it must not assume
// Vercel's parsed `req.body` — see readBody().

import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseConfig } from './supabaseConfig.js';
import { ollamaConfig, describeOllamaNetworkError } from './ollamaConfig.js';
import { ollamaChat } from './ollamaChat.js';
import {
  describeOllamaModel, rememberThinkingSupport, resolveThinkValue,
  thinkingIsOn, splitThinkingTrace,
} from './ollamaReasoning.js';

// ---------------------------------------------------------------------------
// Model aliases used in the frontend (kept compatible with the old Base44
// aliases such as `gemini_3_flash`).
// ---------------------------------------------------------------------------
// Legacy Base44 aliases -> current Gemini API model IDs.
// The `*-latest` pointers are used deliberately: Google retires concrete model
// IDs regularly, and a stale ID would otherwise make every AI feature fail.
// Anyone who needs a pinned model sets GEMINI_MODEL in Vercel.
const GEMINI_ALIASES = {
  gemini_3_flash: 'gemini-flash-latest',
  gemini_3_pro: 'gemini-pro-latest',
  gemini_2_5_flash: 'gemini-2.5-flash',
  gemini_2_5_pro: 'gemini-2.5-pro',
  gemini_2_0_flash: 'gemini-2.0-flash',
  gemini_flash: 'gemini-flash-latest',
  gemini_pro: 'gemini-pro-latest',
};

const PROVIDER_DEFAULTS = {
  gemini: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  nararouter: process.env.NARAROUTER_MODEL || 'agnes-3-flash',
  openai: process.env.OPENAI_MODEL || 'gpt-4o',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
  groq: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  openrouter: process.env.OPENROUTER_MODEL || 'openrouter/auto',
};

const KNOWN_PROVIDERS = ['nararouter', 'ollama', 'gemini', 'groq', 'openrouter', 'openai', 'anthropic'];

function detectProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  // NaraRouter is Atlas's provider. The other adapters remain for a deployment
  // that already has a key, but they are never preferred over it.
  if (process.env.NARAROUTER_API_KEY) return 'nararouter';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return '';
}

function apiKeyFor(provider) {
  switch (provider) {
    case 'gemini': return process.env.GEMINI_API_KEY;
    case 'nararouter': return process.env.NARAROUTER_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
    case 'groq': return process.env.GROQ_API_KEY;
    case 'openrouter': return process.env.OPENROUTER_API_KEY;
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    return req.body; // Vercel already parsed JSON
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

/** Convert a plain JSON Schema into Gemini's responseSchema subset. */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return undefined;
  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if (schema.properties) {
    out.properties = {};
    for (const [k, v] of Object.entries(schema.properties)) out.properties[k] = toGeminiSchema(v);
  }
  if (Array.isArray(schema.required) && schema.required.length) out.required = schema.required;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  return out;
}

/** Extract a JSON object/array from model text, tolerating code fences. */
function extractJSON(text) {
  if (typeof text !== 'string') return null;
  const candidates = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1]);
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  const arrStart = text.indexOf('[');
  const arrEnd = text.lastIndexOf(']');
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(text.slice(arrStart, arrEnd + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c.trim());
    } catch { /* keep trying */ }
  }
  return null;
}

function buildPrompt(prompt, responseJsonSchema) {
  if (!responseJsonSchema) return prompt;
  return `${prompt}

Respond with ONLY one valid JSON object that strictly matches this JSON Schema. No markdown fences, no commentary, no text before or after the JSON:
${JSON.stringify(responseJsonSchema)}`;
}

/**
 * Turn a raw provider failure into a message an applicant can act on.
 * The old code forwarded provider strings verbatim, which is how "AI not
 * working" became undiagnosable — this maps the common cases explicitly.
 */
function explainProviderError(provider, message, status) {
  const m = String(message || '');
  if (status === 429) {
    // Preserve the provider's actual error body. Never rewrite a real 429 into
    // an app-authored success or a generic quota message.
    return m || `${provider.toUpperCase()} returned HTTP 429.`;
  }
  if (status === 401 || status === 403 || /api key not valid|permission denied|unauthorized/i.test(m)) {
    return `Your ${provider.toUpperCase()} API key was rejected. It is missing, expired, or has the wrong permissions — re-check the key in Vercel → Environment Variables.`;
  }
  if (/billing|credit balance|payment required/i.test(m)) {
    return `Your ${provider.toUpperCase()} account has no remaining credit. Add credit, or switch to a different provider key.`;
  }
  if (status === 404 || /not found|not supported/i.test(m)) {
    return `The configured ${provider.toUpperCase()} model does not exist or is not available to this key. Set the *_MODEL env var to a model your key can call (see DEPLOYMENT.md).`;
  }
  if (/safety|blocked|prohibited_content/i.test(m)) {
    return 'The provider blocked this request for safety reasons. Rephrase the request (usually caused by copying a copyrighted essay verbatim) and try again.';
  }
  return m;
}

// ---------------------------------------------------------------------------
// Provider adapters -> { text, finishReason } or throw Error
// ---------------------------------------------------------------------------
async function callGemini({ prompt, responseJsonSchema, addContext, model, maxTokens, temperature }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set on the server.');

  const aliases = GEMINI_ALIASES;
  let resolved = aliases[model] || model || PROVIDER_DEFAULTS.gemini;
  const wantsJson = !!responseJsonSchema && !addContext;
  let finishReason = '';
  let grounded = false;

  const call = async (modelName) => {
    const generationConfig = {};
    if (wantsJson) {
      generationConfig.responseMimeType = 'application/json';
      const s = toGeminiSchema(responseJsonSchema);
      if (s) generationConfig.responseSchema = s;
    }
    // Output cap: older 2.0 models cap at 8192; newer families allow much more.
    generationConfig.maxOutputTokens = maxTokens
      || (modelName.startsWith('gemini-2.0') ? 8192 : 32768);
    // A scoring or editing call asks for a low temperature so two runs over the
    // same essay produce comparable numbers instead of a random walk.
    if (Number.isFinite(temperature)) generationConfig.temperature = temperature;

    const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig };
    if (addContext) body.tools = [{ google_search: {} }];

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || `Gemini request failed (HTTP ${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.provider = 'gemini';
      throw err;
    }
    const candidate = data?.candidates?.[0];
    finishReason = candidate?.finishReason || '';
    const groundingMetadata = candidate?.groundingMetadata;
    grounded = !!(
      groundingMetadata?.groundingChunks?.length
      || groundingMetadata?.webSearchQueries?.length
    );
    const parts = candidate?.content?.parts || [];
    return parts.map((p) => p.text || '').join('');
  };

  // `call` assigns finishReason before resolving, so reading it here is safe.
  const run = async (modelName) => ({
    text: await call(modelName),
    model: modelName,
    finishReason,
    grounded,
  });

  try {
    return await run(resolved);
  } catch (e) {
    // If the requested/alias model does not exist, fall back once.
    if (e.status === 404 && resolved !== PROVIDER_DEFAULTS.gemini) {
      resolved = PROVIDER_DEFAULTS.gemini;
      return run(resolved);
    }
    throw e;
  }
}

async function callOpenAICompatible({ provider = 'openai', prompt, responseJsonSchema, model, maxTokens, temperature }) {
  const key = apiKeyFor(provider);
  if (!key) throw new Error(`${provider.toUpperCase()}_API_KEY is not set on the server.`);
  const base = (provider === 'openai'
    ? process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    : provider === 'groq'
      ? process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1'
      : provider === 'openrouter'
        ? process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
        : process.env.NARAROUTER_BASE_URL || 'https://router.bynara.id/v1'
  ).replace(/\/$/, '');

  const body = {
    model: model || PROVIDER_DEFAULTS[provider],
    messages: [{ role: 'user', content: prompt }],
  };
  if (responseJsonSchema) body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;
  if (Number.isFinite(temperature)) body.temperature = temperature;

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL || 'https://atlas.app';
    headers['X-Title'] = 'Atlas';
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const providerError = data?.error;
    const errorMessage = typeof providerError === 'string'
      ? providerError
      : providerError?.message || `${provider.toUpperCase()} request failed (HTTP ${res.status})`;
    const details = [
      providerError?.type ? `Type: ${providerError.type}` : '',
      providerError?.request_id ? `Request ID: ${providerError.request_id}` : '',
    ].filter(Boolean);
    const err = new Error([errorMessage, ...details].join(' · '));
    err.status = res.status;
    err.provider = provider;
    err.providerCode = providerError?.type;
    throw err;
  }
  return { text: data?.choices?.[0]?.message?.content || '', model: data?.model || body.model, finishReason: data?.choices?.[0]?.finish_reason || '' };
}

async function callAnthropic({ prompt, responseJsonSchema, model, maxTokens, temperature }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');

  const body = {
    model: model && model.startsWith('claude') ? model : PROVIDER_DEFAULTS.anthropic,
    max_tokens: maxTokens || 8192,
    messages: [{ role: 'user', content: prompt }],
    ...(Number.isFinite(temperature) ? { temperature } : {}),
  };
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Anthropic request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.provider = 'anthropic';
    throw err;
  }
  return {
    text: (data?.content || []).map((b) => b.text || '').join(''),
    model: body.model,
    finishReason: data?.stop_reason || '',
  };
}

// Local Ollama (opt-in: LLM_PROVIDER=ollama). Uses Ollama's native /api/chat so
// the context window can be set explicitly (num_ctx) and a prompt that does not
// fit is refused (truncate: false) instead of being cut silently. No key is sent
// and no fallback to another model is attempted: a missing model is reported.
//
// Reasoning models are handled here, because getting this wrong is what makes a
// local qwen3:8b worse than it is:
//
//   * `think` is sent explicitly (see api/ollamaReasoning.js), so a global
//     `/set nothink` or a Modelfile cannot quietly switch the depth off, and a
//     model that has no reasoning control never receives one (Ollama 400s).
//   * The reasoning trace is read from `message.thinking` and kept OUT of the
//     answer. It is also where a JSON answer sometimes lands, so it is used as
//     a recovery source instead of being thrown away as "empty response".
//   * `num_predict` reserves room for the trace on top of the answer. Ollama
//     counts both against the same budget, so an answer-sized cap is spent on
//     reasoning and the answer arrives empty with done_reason "length".
//   * Sampling follows the model's own published guidance for thinking mode
//     (Qwen3 and DeepSeek-R1: temperature 0.6, top_p 0.95, top_k 20, never
//     greedy), which is warmer than the cold temperature Atlas asks a hosted
//     scoring call for.
//   * The call is streamed, so a generation longer than Node's 300-second fetch
//     transport timeout is not killed at five minutes.
async function callOllama({ prompt, responseJsonSchema, model, maxTokens, temperature }) {
  const cfg = ollamaConfig(process.env);
  if (cfg.problem) {
    throw Object.assign(new Error(cfg.problem), { status: 503, provider: 'ollama', userMessage: cfg.problem });
  }
  const requested = model || cfg.model;
  // Local manifest read, cached. It says whether the model reasons, and how big
  // its own context window is. Never throws.
  const info = await describeOllamaModel(cfg.baseUrl, requested);

  const thinkValue = resolveThinkValue(cfg.think, info.support);
  const reasoning = thinkingIsOn(thinkValue, info.support);

  const options = { num_ctx: cfg.numCtx };

  // -1 is "no output cap of Atlas's own" (what every other provider path means
  // when the caller names no cap) and it also overrides a `num_predict` a
  // Modelfile might set, which would silently truncate a reasoning run.
  const answerTokens = Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : 0;
  options.num_predict = answerTokens ? answerTokens + (reasoning ? cfg.thinkBudget : 0) : -1;

  let raisedFrom = null;
  if (Number.isFinite(temperature)) {
    let used = temperature;
    if (reasoning && cfg.minTemperature > 0 && used < cfg.minTemperature) used = cfg.minTemperature;
    options.temperature = used;
    if (used !== temperature) raisedFrom = temperature;
  }
  if (reasoning) {
    options.top_p = cfg.topP;
    options.top_k = cfg.topK;
  }

  const body = {
    model: requested,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    truncate: false,
    options,
    // Ollama's own keep-alive default is 5 minutes, so every AI action after a
    // short reading pause would reload a multi-gigabyte model from disk.
    keep_alive: cfg.keepAlive,
  };
  if (thinkValue !== undefined) body.think = thinkValue;
  // Generic JSON mode: the schema is already spelled out in the prompt, and
  // Ollama's schema-constrained decoding is not needed for these answers.
  if (responseJsonSchema) body.format = 'json';

  const unreachable = (reason) => {
    const message = `Could not reach Ollama at ${cfg.baseUrl} (${reason}). Start Ollama on this computer (open the Ollama app, or run \`ollama serve\` in a terminal), then press Re-check in AI setup.`;
    return Object.assign(new Error(message), { status: 503, provider: 'ollama', userMessage: message });
  };
  const userError = (status, message) => Object.assign(new Error(message), { status, provider: 'ollama', userMessage: message });

  let response;
  try {
    response = await ollamaChat(cfg.baseUrl, body, { timeoutMs: cfg.timeoutMs });
    if (response.status === 400 && /does not support thinking/i.test(response.error || '') && body.think !== undefined) {
      // The model itself refuses the control. Honour that once and remember it,
      // rather than failing every AI action on this model.
      rememberThinkingSupport(cfg.baseUrl, requested, false);
      const { think: _ignored, ...withoutThink } = body;
      response = await ollamaChat(cfg.baseUrl, withoutThink, { timeoutMs: cfg.timeoutMs });
      if (response.status < 200 || response.status >= 300) return failOllama(response);
      return answerFrom(response, { cfg, requested, reasoning: false, options, raisedFrom, info });
    }
  } catch (error) {
    if (error?.timedOut) {
      const minutes = Math.max(1, Math.round(cfg.timeoutMs / 60000));
      throw userError(504, `Ollama did not finish within ${minutes} minute(s). Deep reasoning on this computer can take a long time: raise OLLAMA_TIMEOUT_MS in .env.local, send fewer or shorter materials, set OLLAMA_THINK=off for a direct answer, or use a smaller model.`);
    }
    throw unreachable(describeOllamaNetworkError(error));
  }

  if (response.status < 200 || response.status >= 300) return failOllama(response);
  return answerFrom(response, { cfg, requested, reasoning, options, raisedFrom, info });

  /** Turn an Ollama failure into a message that says what to do about it. */
  function failOllama(failed) {
    const raw = String(failed.error || failed.rawPreview || '').trim();
    let message;
    if (/context length|exceeds.*context|input length/i.test(raw)) {
      message = `The prompt is larger than Ollama's context window (${cfg.numCtx} tokens). Raise OLLAMA_NUM_CTX in .env.local (for example 32768, if the computer has the memory) or send fewer or shorter materials. Atlas does not cut prompts silently.`;
    } else if (failed.status === 404 || /not found/i.test(raw)) {
      message = `Ollama does not have the model "${requested}". Run \`ollama pull ${requested}\` in a terminal, or choose a model you already have in AI setup (or set OLLAMA_MODEL).`;
    } else if (failed.status === 401 || failed.status === 403) {
      message = `Ollama refused the request (HTTP ${failed.status}): ${raw || 'access denied'}. If this is a cloud model, sign in with \`ollama signin\`.`;
    } else {
      message = `Ollama returned HTTP ${failed.status}${raw ? `: ${raw}` : ''}`;
    }
    throw userError(failed.status, message);
  }

  /** Build Atlas's answer from the streamed chunks. */
  function answerFrom(streamed, context) {
    const split = splitThinkingTrace(streamed.content);
    const trace = [streamed.thinking, split.thinking].filter(Boolean).join('\n\n').trim();
    // A real trace is the strongest possible evidence that this model reasons;
    // remember it so the next call does not have to ask.
    if (trace) rememberThinkingSupport(cfg.baseUrl, requested, true);
    // done_reason "length" = Ollama stopped at the output cap; surface it the
    // way the other adapters do so the client sends the answer back for a retry.
    const finishReason = streamed.finishReason === 'length' ? 'length' : (streamed.finishReason || '');
    return {
      text: split.text,
      model: streamed.model || requested,
      finishReason,
      promptEvalCount: streamed.promptEvalCount,
      thinking: trace,
      reasoning: context.reasoning,
      numCtx: context.cfg.numCtx,
      modelContextLength: context.info.contextLength,
      configWarnings: context.cfg.warnings,
      sampling: {
        num_ctx: context.options.num_ctx,
        num_predict: context.options.num_predict,
        ...(context.options.temperature === undefined ? {} : { temperature: context.options.temperature }),
        ...(context.raisedFrom === null ? {} : { raised_from: context.raisedFrom }),
        ...(context.options.top_p === undefined ? {} : { top_p: context.options.top_p }),
        ...(context.options.top_k === undefined ? {} : { top_k: context.options.top_k }),
      },
    };
  }
}

// Providers retire model IDs on their own schedule. If a caller-supplied model
// is no longer offered, retry once with the provider default so a stale
// preference degrades to "slightly different model" rather than a hard failure.
async function callWithModelFallback(call, requested, fallback) {
  try {
    return await call(requested);
  } catch (e) {
    const missingModel = e?.status === 404
      || e?.status === 400
      || /model_not_found|does not exist|not found|deprecat|invalid model/i.test(e?.message || '');
    if (!missingModel || !fallback || requested === fallback) throw e;
    console.warn(`[invoke-llm] model "${requested}" unavailable, falling back to "${fallback}"`);
    return call(fallback);
  }
}

// ---------------------------------------------------------------------------
// Main handler (works on Vercel and in the Vite dev server)
// ---------------------------------------------------------------------------
export async function handleInvokeLLM(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', 'POST, OPTIONS');
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    send(res, 405, { error: 'Method not allowed. Use POST.' });
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch {
    send(res, 400, { error: 'Invalid JSON body.' });
    return;
  }

  const {
    prompt,
    response_json_schema: responseJsonSchema,
    add_context_from_internet: addContext,
    model,
    max_tokens: maxTokens,
    temperature: rawTemperature,
  } = body || {};

  // Optional and clamped: an unknown or out-of-range value must not break a
  // call, and a caller cannot push a provider into an unsupported range.
  const temperature = Number.isFinite(Number(rawTemperature))
    ? Math.min(Math.max(Number(rawTemperature), 0), 2)
    : undefined;

  if (!prompt || typeof prompt !== 'string') {
    send(res, 400, { error: '`prompt` is required.' });
    return;
  }

  // --- Auth: require a valid Supabase JWT when Supabase is configured. ---
  // Do not pass the first env var that happens to be set. A Postgres URI in
  // SUPABASE_URL used to win over a valid VITE_ / NEXT_PUBLIC_ project URL and
  // createClient threw "Invalid supabaseUrl" before any model call.
  const supabaseConfig = resolveSupabaseConfig(process.env);
  const nothingConfigured = !supabaseConfig.url && !supabaseConfig.key && supabaseConfig.problems.length === 0;
  const allowAnon = process.env.LLM_ALLOW_ANON === 'true' || nothingConfigured;
  if (!allowAnon) {
    if (!supabaseConfig.configured) {
      send(res, 500, {
        error: supabaseConfig.invalidReason
          || supabaseConfig.problems[0]
          || 'Supabase is not configured correctly, so the AI endpoint cannot verify your session.',
      });
      return;
    }
    const header = req.headers?.authorization || req.headers?.Authorization || '';
    const token = String(header).replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      send(res, 401, { error: 'Your session is missing, so the AI endpoint rejected the request. Sign out and sign back in.' });
      return;
    }
    try {
      const sb = createClient(supabaseConfig.url, supabaseConfig.key, { auth: { persistSession: false } });
      const { data, error } = await sb.auth.getUser(token);
      if (error || !data?.user) {
        send(res, 401, { error: 'Your session has expired. Sign out and sign back in — the AI endpoint only accepts a valid Supabase session.' });
        return;
      }
    } catch (e) {
      send(res, 500, { error: `Auth check failed: ${e.message}` });
      return;
    }
  }

  // This is the only real-model path Atlas has. Gemini remains the only
  // provider that can request Google Search grounding; NaraRouter cannot, and
  // the client says so instead of implying otherwise.
  const provider = detectProvider();
  const groundingRequested = !!addContext;
  const groundingPossible = groundingRequested && provider === 'gemini' && !!process.env.GEMINI_API_KEY;

  // An explicit but unknown LLM_PROVIDER is a configuration error: name it,
  // rather than reporting a generic "no provider" that hides the typo.
  if (provider && !KNOWN_PROVIDERS.includes(provider)) {
    send(res, 503, { error: `Unknown LLM_PROVIDER "${provider}". Use nararouter | ollama | gemini | groq | openrouter | openai | anthropic.` });
    return;
  }
  // Ollama needs no key: it is a local server, selected explicitly.
  if (!provider || (provider !== 'ollama' && !apiKeyFor(provider))) {
    send(res, 503, {
      error: 'No AI provider is configured for this deployment. Set NARAROUTER_API_KEY (see DEPLOYMENT.md) and redeploy, set LLM_PROVIDER=ollama to use a local Ollama, or use demo mode until then.',
    });
    return;
  }

  const finalPrompt = buildPrompt(prompt, responseJsonSchema);

  try {
    let out;
    if (provider === 'gemini') {
      out = await callGemini({
        prompt: finalPrompt,
        responseJsonSchema,
        addContext: groundingPossible,
        model,
        maxTokens,
        temperature,
      });
    } else if (['openai', 'groq', 'openrouter', 'nararouter'].includes(provider)) {
      const call = (requestedModel) => callOpenAICompatible({
        provider,
        prompt: finalPrompt,
        responseJsonSchema,
        model: requestedModel,
        maxTokens,
        temperature,
      });
      // NaraRouter aliases are plan-specific: `/v1/models` returns only what a
      // key is entitled to, and anything else is a 404. Retry once with the
      // deployment default so a stale alias degrades to a different model
      // instead of failing every AI action in the app. Real 429s and auth
      // errors are still reported verbatim, never retried into another model.
      out = provider === 'nararouter'
        ? await callWithModelFallback(
          call,
          model || PROVIDER_DEFAULTS.nararouter,
          PROVIDER_DEFAULTS.nararouter,
        )
        : await callWithModelFallback(
          call,
          model || PROVIDER_DEFAULTS[provider],
          PROVIDER_DEFAULTS[provider],
        );
    } else if (provider === 'ollama') {
      // No fallback model: a missing Ollama model is reported, never swapped.
      out = await callOllama({ prompt: finalPrompt, responseJsonSchema, model, maxTokens, temperature });
    } else if (provider === 'anthropic') {
      out = await callWithModelFallback(
        (m) => callAnthropic({ prompt: finalPrompt, responseJsonSchema, model: m, maxTokens, temperature }),
        model && model.startsWith('claude') ? model : PROVIDER_DEFAULTS.anthropic,
        PROVIDER_DEFAULTS.anthropic,
      );
    } else {
      send(res, 503, { error: `Unknown LLM_PROVIDER "${provider}". Use nararouter | ollama | gemini | groq | openrouter | openai | anthropic.` });
      return;
    }

    const text = out.text || '';
    // A reasoning model keeps its chain of thought next to the answer. Two
    // things follow: an answer can be missing while the trace is full, and a
    // JSON answer can end up INSIDE the trace. Neither is "the AI returned an
    // empty response", and neither may be thrown away.
    const trace = typeof out.thinking === 'string' ? out.thinking : '';
    let parsed = null;
    let parsedFromTrace = false;
    if (responseJsonSchema) {
      parsed = extractJSON(text);
      if (!parsed && trace.trim()) {
        parsed = extractJSON(trace);
        if (parsed) parsedFromTrace = true;
      }
    }

    if (!text.trim() && !parsed) {
      send(res, 502, {
        error: trace.trim()
          ? 'The model wrote only its reasoning and never reached the answer. Give it more room: raise OLLAMA_NUM_CTX in .env.local (for example 32768), send fewer or shorter materials, or set OLLAMA_THINK=off for a direct answer.'
          : ['MAX_TOKENS', 'length'].includes(out.finishReason)
            ? 'The AI ran out of output space before finishing. Shorten the request or raise max_tokens.'
            : 'The AI returned an empty response. This usually means the provider blocked the prompt — try rephrasing, or raise max_tokens.',
        ...(trace.trim() ? { reasoning_chars: trace.length } : {}),
        ...(responseJsonSchema ? { raw_preview: String(trace || text).slice(0, 400) } : {}),
      });
      return;
    }

    const actuallyGrounded = groundingPossible && provider === 'gemini' && !!out.grounded;
    const warnings = [];
    if (provider !== 'gemini') {
      warnings.push(`Not web-grounded: ${provider} does not use Gemini Google Search grounding. This answer is based on the model and any text you supplied.`);
    } else if (groundingRequested && !actuallyGrounded) {
      warnings.push('Gemini completed this call without web-grounding metadata. Treat the answer as not web-grounded.');
    }
    if (['MAX_TOKENS', 'length'].includes(out.finishReason)) {
      warnings.push('The response hit the model output cap and may be incomplete.');
    }
    if (parsedFromTrace) {
      warnings.push('The model wrote its JSON inside its reasoning trace instead of the answer; Atlas recovered it from there. Raising OLLAMA_NUM_CTX gives it room to answer normally.');
    }
    if (provider === 'ollama') {
      if (out.promptEvalCount && out.numCtx && out.promptEvalCount >= out.numCtx) {
        // Defensive: Ollama refuses an oversized prompt, so this should not happen.
        warnings.push(`The prompt filled the Ollama context window (${out.numCtx} tokens); the answer may ignore part of it. Raise OLLAMA_NUM_CTX.`);
      }
      if (out.modelContextLength && out.numCtx > out.modelContextLength) {
        // Ollama clamps a larger window down to the model's own limit quietly.
        warnings.push(`${out.model || 'This model'} has a ${out.modelContextLength}-token context, so the requested ${out.numCtx} is reduced to that. Set OLLAMA_NUM_CTX=${out.modelContextLength} (or lower) to stop asking for more than the model has.`);
      }
      if (out.finishReason === 'length' && trace) {
        warnings.push('The reasoning trace and the answer together filled the output budget.');
      }
      for (const note of out.configWarnings || []) warnings.push(note);
    }
    const meta = {
      provider,
      model: out.model || null,
      grounded: actuallyGrounded,
      demo: false,
      finish_reason: out.finishReason || '',
      warning: warnings.join(' '),
    };
    if (provider === 'ollama') {
      // Purely additive: older clients ignore fields they do not read. The
      // trace itself stays on the server (it is long and it is not the answer),
      // but its size tells the UI that reasoning actually happened.
      meta.thinking = !!out.reasoning;
      meta.reasoning_chars = trace.length;
      if (parsedFromTrace) meta.recovered_from_thinking = true;
      if (out.sampling) meta.sampling = out.sampling;
    }

    if (responseJsonSchema) {
      if (!parsed) {
        send(res, 502, {
          error: 'The AI did not return valid JSON. Please retry.',
          raw_preview: String(text).slice(0, 400),
        });
        return;
      }
      send(res, 200, { ok: true, result: parsed, meta });
      return;
    }

    send(res, 200, { ok: true, result: String(text), meta });
  } catch (e) {
    const status = Number.isInteger(e.status) && e.status >= 400 && e.status <= 599 ? e.status : 502;
    send(res, status, {
      // Ollama errors arrive already written for the applicant; do not re-map them.
      error: e.userMessage || explainProviderError(e.provider || provider, e.message, e.status),
      provider: e.provider || provider,
      ...(e.providerCode ? { code: e.providerCode } : {}),
    });
  }
}

// Vercel Node.js entrypoint.
export default async function handler(req, res) {
  await handleInvokeLLM(req, res);
}

// Vercel function config: allow long generations (essay + knowledge research).
export const config = { maxDuration: 300 };

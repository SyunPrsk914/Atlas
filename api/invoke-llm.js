// /api/invoke-llm — optional hosted-provider endpoint for explicit Hosted mode.
//
// The default local Ollama path does not call this function. Hosted keys are
// configured server-side and their provider quotas/prices remain in force.
//
// Request body (POST):
//   {
//     prompt: string,                     // required
//     response_json_schema?: object,      // JSON Schema -> returns parsed object
//     add_context_from_internet?: bool,   // web grounding (Gemini only)
//     model?: string,                     // provider model or alias
//     max_tokens?: number
//   }
// Response: { ok: true, result: <string|object>, meta: {...} }
//
// `meta` is new and purely additive — older clients that only read `result`
// keep working. It tells the UI what actually happened, which is what the
// Knowledge Base / Essay Builder screens need in order to stop guessing:
//   { provider, model, grounded, demo, warning, finish_reason }
//
// This module is used BOTH as a Vercel function (export default) and by the
// Vite dev server middleware (export handleInvokeLLM), so it must not assume
// Vercel's parsed `req.body` — see readBody().

import { createClient } from '@supabase/supabase-js';
import { resolveSupabaseConfig } from './supabaseConfig.js';

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

function detectProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.NARAROUTER_API_KEY) return 'nararouter';
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
async function callGemini({ prompt, responseJsonSchema, addContext, model, maxTokens }) {
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

async function callOpenAICompatible({ provider = 'openai', prompt, responseJsonSchema, model, maxTokens }) {
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

async function callAnthropic({ prompt, responseJsonSchema, model, maxTokens }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set on the server.');

  const body = {
    model: model && model.startsWith('claude') ? model : PROVIDER_DEFAULTS.anthropic,
    max_tokens: maxTokens || 8192,
    messages: [{ role: 'user', content: prompt }],
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
  } = body || {};

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

  // Hosted inference is only reached after the user explicitly selects it in
  // AI setup. Ollama requests never touch this endpoint. Gemini is the only
  // hosted provider allowed to request Google Search grounding.
  const provider = detectProvider();
  const groundingRequested = !!addContext;
  const groundingPossible = groundingRequested && provider === 'gemini' && !!process.env.GEMINI_API_KEY;

  if (!provider || !apiKeyFor(provider)) {
    send(res, 503, {
      error: 'No hosted AI provider is configured for this deployment. Select a local Ollama model in AI setup, or configure an optional hosted provider key.',
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
      });
    } else if (['openai', 'groq', 'openrouter', 'nararouter'].includes(provider)) {
      const call = (requestedModel) => callOpenAICompatible({
        provider,
        prompt: finalPrompt,
        responseJsonSchema,
        model: requestedModel,
        maxTokens,
      });
      // NaraRouter aliases are plan-specific and the gateway reports its real
      // 4xx/429 errors. Do not retry a failed request with a different model.
      out = provider === 'nararouter'
        ? await call(model || PROVIDER_DEFAULTS.nararouter)
        : await callWithModelFallback(
          call,
          model || PROVIDER_DEFAULTS[provider],
          PROVIDER_DEFAULTS[provider],
        );
    } else if (provider === 'anthropic') {
      out = await callWithModelFallback(
        (m) => callAnthropic({ prompt: finalPrompt, responseJsonSchema, model: m, maxTokens }),
        model && model.startsWith('claude') ? model : PROVIDER_DEFAULTS.anthropic,
        PROVIDER_DEFAULTS.anthropic,
      );
    } else {
      send(res, 503, { error: `Unknown LLM_PROVIDER "${provider}". Use gemini | nararouter | groq | openrouter | openai | anthropic.` });
      return;
    }

    const text = out.text || '';
    if (!text.trim()) {
      send(res, 502, {
        error: out.finishReason === 'MAX_TOKENS'
          ? 'The AI ran out of output space before finishing. Shorten the request or raise max_tokens.'
          : 'The AI returned an empty response. This usually means the provider blocked the prompt — try rephrasing, or raise max_tokens.',
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
    if (out.finishReason === 'MAX_TOKENS') {
      warnings.push('The response hit the hosted model output cap and may be incomplete.');
    }
    const meta = {
      provider,
      model: out.model || null,
      grounded: actuallyGrounded,
      demo: false,
      finish_reason: out.finishReason || '',
      warning: warnings.join(' '),
    };

    if (responseJsonSchema) {
      const parsed = extractJSON(text);
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
      error: explainProviderError(e.provider || provider, e.message, e.status),
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

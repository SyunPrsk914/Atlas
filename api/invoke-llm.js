// /api/invoke-llm — Vercel serverless function replacing Base44's Core.InvokeLLM.
//
// The app pays no Base44 credits: the model call is made with YOUR provider API
// key (Gemini / OpenAI / Anthropic) configured as Vercel environment variables.
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
  openai: process.env.OPENAI_MODEL || 'gpt-4o',
  anthropic: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
};

function detectProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return '';
}

function apiKeyFor(provider) {
  switch (provider) {
    case 'gemini': return process.env.GEMINI_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'anthropic': return process.env.ANTHROPIC_API_KEY;
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

/** Build a schema-shaped demo payload (used only when no AI key is configured). */
function demoSchemaValue(schema, demoText, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return demoText;
  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties || {})) out[k] = demoSchemaValue(v, demoText, depth + 1);
      return out;
    }
    case 'array':
      return [demoSchemaValue(schema.items, demoText, depth + 1)];
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return demoText;
  }
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
  if (status === 429 || /rate limit|quota|resource_exhausted/i.test(m)) {
    return 'The AI provider is rate-limiting you (quota or requests-per-minute exceeded). Wait a minute, or check the billing/quota page for your key in Vercel → Environment Variables.';
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
    const parts = candidate?.content?.parts || [];
    return parts.map((p) => p.text || '').join('');
  };

  // `call` assigns finishReason before resolving, so reading it here is safe.
  const run = async (modelName) => ({
    text: await call(modelName),
    model: modelName,
    finishReason,
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

async function callOpenAI({ prompt, responseJsonSchema, model, maxTokens }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set on the server.');
  const base = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');

  const body = {
    model: model && !model.startsWith('gemini') && !model.startsWith('claude')
      ? model
      : PROVIDER_DEFAULTS.openai,
    messages: [{ role: 'user', content: prompt }],
  };
  if (responseJsonSchema) body.response_format = { type: 'json_object' };
  if (maxTokens) body.max_tokens = maxTokens;

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `OpenAI request failed (HTTP ${res.status})`);
    err.status = res.status;
    err.provider = 'openai';
    throw err;
  }
  return { text: data?.choices?.[0]?.message?.content || '', model: body.model, finishReason: data?.choices?.[0]?.finish_reason || '' };
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

  // --- Provider selection ---
  // Internet-grounded research needs Google Search grounding -> only Gemini.
  // When a non-Gemini key is the active provider we still answer (so the
  // screen is usable), but we say out loud that the answer is NOT web-grounded.
  const provider = detectProvider();
  const groundingRequested = !!addContext;
  const groundingPossible = groundingRequested && provider === 'gemini' && !!process.env.GEMINI_API_KEY;
  const groundingWarning = groundingRequested && !groundingPossible
    ? 'Web search grounding is only available with Gemini. Set GEMINI_API_KEY and LLM_PROVIDER=gemini in Vercel to get live, source-checked university research — this answer came from the model\'s own knowledge.'
    : '';

  if (!provider || !apiKeyFor(provider)) {
    // No AI key configured (typical for first-run Demo mode): return clearly
    // labeled DEMO content that matches the requested shape, so every screen
    // stays explorable. This is never mistaken for real output — every string
    // is explicitly marked, and real keys switch it off automatically.
    const demoText = 'DEMO OUTPUT — no AI provider is connected yet. Add GEMINI_API_KEY (recommended), OPENAI_API_KEY, or ANTHROPIC_API_KEY to your Vercel project (or .env.local) to get real, deeply-researched, university-specific writing. See DEPLOYMENT.md, Part 2.';
    send(res, 200, {
      ok: true,
      result: responseJsonSchema ? demoSchemaValue(responseJsonSchema, demoText) : demoText,
      meta: {
        provider: provider || 'none',
        model: null,
        grounded: false,
        demo: true,
        warning: 'No AI provider key is configured on the server, so this is placeholder text — not a real answer.',
      },
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
    } else if (provider === 'openai') {
      out = await callWithModelFallback(
        (m) => callOpenAI({ prompt: finalPrompt, responseJsonSchema, model: m, maxTokens }),
        model && !model.startsWith('gemini') && !model.startsWith('claude') ? model : PROVIDER_DEFAULTS.openai,
        PROVIDER_DEFAULTS.openai,
      );
    } else if (provider === 'anthropic') {
      out = await callWithModelFallback(
        (m) => callAnthropic({ prompt: finalPrompt, responseJsonSchema, model: m, maxTokens }),
        model && model.startsWith('claude') ? model : PROVIDER_DEFAULTS.anthropic,
        PROVIDER_DEFAULTS.anthropic,
      );
    } else {
      send(res, 503, { error: `Unknown LLM_PROVIDER "${provider}". Use gemini | openai | anthropic.` });
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

    const meta = {
      provider,
      model: out.model || null,
      grounded: groundingPossible,
      demo: false,
      finish_reason: out.finishReason || '',
      warning: groundingWarning
        || (out.finishReason === 'MAX_TOKENS'
          ? 'The response hit the model output cap and may be incomplete.'
          : ''),
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
    const status = e.status === 429 ? 429 : e.status === 401 || e.status === 403 ? 402 : 502;
    send(res, status, {
      error: explainProviderError(e.provider || provider, e.message, e.status),
    });
  }
}

// Vercel Node.js entrypoint.
export default async function handler(req, res) {
  await handleInvokeLLM(req, res);
}

// Vercel function config: allow long generations (essay + knowledge research).
export const config = { maxDuration: 300 };

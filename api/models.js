// /api/models — which model aliases this deployment's key can actually call.
//
// NaraRouter's authenticated `/v1/models` returns exactly the aliases the plan
// entitles, which is the only reliable way to pick a model: the public list
// includes aliases a free key cannot call, and a wrong alias is a hard 404.
// The key stays server-side; only the alias list comes back.
//
// GET /api/models -> { ok, provider, models: string[], default_model }

import { resolveSupabaseConfig } from './supabaseConfig.js';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

const MODEL_LIST_ENDPOINTS = {
  nararouter: () => `${process.env.NARAROUTER_BASE_URL || 'https://router.bynara.id/v1'}/models`,
  openrouter: () => 'https://openrouter.ai/api/v1/models',
  groq: () => 'https://api.groq.com/openai/v1/models',
  openai: () => 'https://api.openai.com/v1/models',
};

function detectProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
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
    case 'nararouter': return process.env.NARAROUTER_API_KEY;
    case 'groq': return process.env.GROQ_API_KEY;
    case 'openrouter': return process.env.OPENROUTER_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    default: return '';
  }
}

function defaultModelFor(provider) {
  const envKey = `${provider.toUpperCase()}_MODEL`;
  if (process.env[envKey]) return process.env[envKey];
  return provider === 'nararouter' ? 'agnes-3-flash' : '';
}

export async function handleModels(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'Method not allowed. Use GET.' });
    return;
  }

  const provider = detectProvider();
  const key = apiKeyFor(provider);
  const endpoint = MODEL_LIST_ENDPOINTS[provider];
  const configured = resolveSupabaseConfig(process.env).configured;

  // A provider with no list endpoint (Gemini, Anthropic) is not an error: the
  // deployment's *_MODEL env var is the answer, and the UI says so.
  if (!provider || !key || !endpoint) {
    send(res, 200, {
      ok: true,
      supabase_configured: configured,
      provider: provider || null,
      models: [],
      default_model: provider ? defaultModelFor(provider) : null,
      listable: false,
      message: provider
        ? `${provider} does not expose a model list Atlas can read. Atlas uses ${defaultModelFor(provider) || `the ${provider.toUpperCase()}_MODEL env var`}.`
        : 'No AI provider key is configured on this deployment.',
    });
    return;
  }

  try {
    const response = await fetch(endpoint(), {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      send(res, 200, {
        ok: false,
        supabase_configured: configured,
        provider,
        models: [],
        default_model: defaultModelFor(provider),
        listable: true,
        message: `The provider returned HTTP ${response.status} for its model list. Atlas will keep using ${defaultModelFor(provider) || 'its default model'}. ${body.slice(0, 200)}`.trim(),
      });
      return;
    }
    const body = await response.json().catch(() => null);
    const rows = Array.isArray(body?.data) ? body.data : (Array.isArray(body?.models) ? body.models : []);
    const models = rows
      .map((row) => (typeof row === 'string' ? row : row?.id || row?.model || row?.alias || ''))
      .filter(Boolean)
      .sort();
    send(res, 200, {
      ok: true,
      supabase_configured: configured,
      provider,
      models,
      default_model: defaultModelFor(provider),
      listable: true,
      message: models.length
        ? `${models.length} model alias(es) this key can call.`
        : 'The provider returned an empty model list. Atlas will keep using its default model.',
    });
  } catch (error) {
    send(res, 200, {
      ok: false,
      supabase_configured: configured,
      provider,
      models: [],
      default_model: defaultModelFor(provider),
      listable: true,
      message: `Could not read the model list: ${error?.message || error}. Atlas will keep using ${defaultModelFor(provider) || 'its default model'}.`,
    });
  }
}

export default async function handler(req, res) {
  await handleModels(req, res);
}

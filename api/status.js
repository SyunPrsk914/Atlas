// /api/status — zero-cost diagnostic endpoint.
//
// The old app had no way to answer "is the AI actually connected?" from the
// browser: every screen just showed "Failed. Please try again." This endpoint
// reports the *configuration* (never the keys themselves) so the UI can show an
// honest status pill and the Knowledge Base can tell the user why research is
// or is not web-grounded.
//
// GET /api/status -> { ok, configured, provider, model, grounding, ... }

import { resolveSupabaseConfig } from './supabaseConfig.js';
import { ollamaConfig, describeOllamaNetworkError } from './ollamaConfig.js';

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

/**
 * Ollama has no key to check, so "configured" means "a local Ollama answers".
 * The probe is a single GET to the local server, with a short timeout, and it
 * never reports the base URL's credentials (there are none).
 */
async function probeOllama() {
  const cfg = ollamaConfig(process.env);
  if (cfg.problem) return { ok: false, message: cfg.problem, model: cfg.model };
  try {
    const response = await fetch(`${cfg.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!response.ok) {
      return { ok: false, model: cfg.model, message: `Ollama answered HTTP ${response.status} at ${cfg.baseUrl}. Check that it is the Ollama server.` };
    }
    return { ok: true, model: cfg.model, message: '' };
  } catch (error) {
    return {
      ok: false,
      model: cfg.model,
      message: `Ollama is not running at ${cfg.baseUrl} (${describeOllamaNetworkError(error)}). Start Ollama on this computer, then press Re-check.`,
    };
  }
}

async function readEnvStatus() {
  const keys = {
    gemini: !!process.env.GEMINI_API_KEY,
    nararouter: !!process.env.NARAROUTER_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };

  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  // NaraRouter first: it is the provider Atlas is built around. The others are
  // reported only when a deployment already has one of those keys.
  const preference = ['nararouter', 'gemini', 'groq', 'openrouter', 'openai', 'anthropic'];
  const provider = explicit || preference.find((name) => keys[name]) || '';

  if (provider === 'ollama') {
    const probe = await probeOllama();
    return {
      configured: probe.ok,
      provider,
      model: probe.model,
      grounding: false,
      message: probe.message,
      available_providers: Object.keys(keys).filter((p) => keys[p]),
    };
  }

  return {
    configured: !!provider && keys[provider] === true,
    provider: provider || null,
    model: provider ? (process.env[`${provider.toUpperCase()}_MODEL`] || null) : null,
    // Web grounding (Google Search) is a Gemini-only tool.
    grounding: provider === 'gemini' && keys.gemini,
    available_providers: Object.keys(keys).filter((p) => keys[p]),
  };
}

export async function handleStatus(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, { error: 'Method not allowed. Use GET.' });
    return;
  }

  const supabaseConfig = resolveSupabaseConfig(process.env);
  send(res, 200, {
    ok: true,
    supabase_configured: supabaseConfig.configured,
    // A problem string, never the URL or the key.
    supabase_problem: supabaseConfig.configured
      ? null
      : (supabaseConfig.invalidReason || supabaseConfig.problems[0] || null),
    llm_allow_anon: process.env.LLM_ALLOW_ANON === 'true',
    ...(await readEnvStatus()),
  });
}

export default async function handler(req, res) {
  await handleStatus(req, res);
}

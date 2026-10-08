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

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readEnvStatus() {
  const keys = {
    gemini: !!process.env.GEMINI_API_KEY,
    nararouter: !!process.env.NARAROUTER_API_KEY,
    groq: !!process.env.GROQ_API_KEY,
    openrouter: !!process.env.OPENROUTER_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
  };

  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  const provider = explicit || Object.keys(keys).find((name) => keys[name]) || '';

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
    ...readEnvStatus(),
  });
}

export default async function handler(req, res) {
  await handleStatus(req, res);
}

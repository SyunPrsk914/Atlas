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
import { describeOllamaModel, resolveThinkValue, thinkingIsOn } from './ollamaReasoning.js';

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
 *
 * It also reads the configured model's manifest, so the pill can say whether
 * the model reasons (qwen3:8b does) and whether the context window asked for is
 * bigger than the model's own — both of which change the quality of an answer.
 */
async function probeOllama() {
  const cfg = ollamaConfig(process.env);
  if (cfg.problem) return { ok: false, message: cfg.problem, model: cfg.model, notes: cfg.warnings };
  try {
    const response = await fetch(`${cfg.baseUrl}/api/tags`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      return { ok: false, model: cfg.model, notes: cfg.warnings, message: `Ollama answered HTTP ${response.status} at ${cfg.baseUrl}. Check that it is the Ollama server.` };
    }
  } catch (error) {
    return {
      ok: false,
      model: cfg.model,
      notes: cfg.warnings,
      message: `Ollama is not running at ${cfg.baseUrl} (${describeOllamaNetworkError(error)}). Start Ollama on this computer, then press Re-check.`,
    };
  }

  // Ollama is up. Now describe the model Atlas will actually call.
  const info = await describeOllamaModel(cfg.baseUrl, cfg.model);
  const thinkValue = resolveThinkValue(cfg.think, info.support);
  const windowTooBig = !!info.contextLength && cfg.numCtx > info.contextLength;
  const notes = [
    ...cfg.warnings,
    windowTooBig
      ? `${cfg.model} has a ${info.contextLength}-token context, so OLLAMA_NUM_CTX=${cfg.numCtx} is reduced to that.`
      : '',
    info.ok ? '' : info.problem,
  ].filter(Boolean);

  return {
    ok: true,
    model: cfg.model,
    // A healthy connection has no complaint to make; the reasoning state is
    // reported in its own field, not smuggled into a warning message.
    message: '',
    notes,
    thinking: {
      // Whether the model says it can reason, and what Atlas will ask for.
      supported: info.support.supported,
      default_on: info.support.defaultOn,
      levels: info.support.levels,
      requested: thinkValue === undefined ? null : thinkValue,
      on: thinkingIsOn(thinkValue, info.support),
      think_budget: cfg.thinkBudget,
      source: info.support.source,
    },
    context: {
      requested: cfg.numCtx,
      model_max: info.contextLength,
      clamped: windowTooBig,
    },
    sampling: {
      min_temperature: cfg.minTemperature,
      top_p: cfg.topP,
      top_k: cfg.topK,
    },
    timeout_ms: cfg.timeoutMs,
    keep_alive: cfg.keepAlive,
  };
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
      // What the local model can actually do, so the setup panel can say
      // whether a reasoning model is being asked to reason.
      ...(probe.thinking ? { thinking: probe.thinking } : {}),
      ...(probe.context ? { context: probe.context } : {}),
      ...(probe.notes ? { notes: probe.notes } : {}),
      ...(probe.sampling ? { sampling: probe.sampling } : {}),
      ...(probe.timeout_ms ? { timeout_ms: probe.timeout_ms } : {}),
      ...(probe.keep_alive ? { keep_alive: probe.keep_alive } : {}),
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

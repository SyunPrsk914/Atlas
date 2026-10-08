// Central AI routing and honest status/error reporting for Atlas.
// Local Ollama is the default real-model path and is called by the browser at
// 127.0.0.1. Hosted providers are optional and only used after the user selects
// Hosted in AI setup. With no selected model, Atlas returns labeled demo data.

import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { checkAIStatus } from '@/api/llmClient';
import {
  getAIMode,
  getOllamaConfig,
  invokeOllamaDetailed,
  probeOllama,
} from '@/api/ollamaClient';

/**
 * Human-readable explanation for anything that can go wrong between the
 * browser and the model.
 * @returns {{ title: string, message: string, action?: { label: string, to: string } }}
 */
export function explainAIError(error, fallbackTitle = 'AI request failed') {
  const message = String(error?.message || error || 'Unknown error');
  const status = error?.status;
  const providerLabels = {
    nararouter: 'NaraRouter',
    openrouter: 'OpenRouter',
    gemini: 'Gemini',
    groq: 'Groq',
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    ollama: 'Ollama',
  };
  const providerName = providerLabels[String(error?.provider || '').toLowerCase()] || error?.provider || 'AI provider';

  if (status === 401 && error?.provider) {
    return { title: `${providerName} rejected the API key`, message };
  }
  if (status === 403 && error?.provider) {
    return { title: `${providerName} denied model access`, message };
  }
  if (status === 401) {
    return {
      title: 'Session expired',
      message,
      action: { label: 'Sign in again', to: '/login' },
    };
  }
  if (status === 429) {
    // Keep the provider's own 429 body intact. Atlas never invents a quota
    // response for local work and never converts a provider failure to success.
    return { title: `${providerName} returned HTTP 429`, message };
  }
  if (status === 402) {
    return { title: 'Hosted AI key rejected', message };
  }
  if (error?.code === 'ollama_unreachable') {
    return { title: 'Local Ollama is not reachable', message };
  }
  if (error?.code === 'research_fetch_failed' || error?.code === 'research_login_required') {
    return { title: 'Could not fetch the public source page', message };
  }
  if (error?.code === 'unreachable' || error?.code === 'bad_response') {
    return { title: 'Hosted AI endpoint not reachable', message };
  }
  if (/Missing Authorization|No API key configured|Could not find the column/i.test(message)) {
    return { title: 'AI is not connected yet', message };
  }
  if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return {
      title: 'Network error',
      message: `${message}. Check your connection and the AI provider selected in AI setup.`,
    };
  }
  return { title: fallbackTitle, message };
}

/** Shows an AI failure as a toast with the real reason. Never throws. */
export function notifyAIError(error, fallbackTitle = 'AI request failed') {
  const { title, message, action } = explainAIError(error, fallbackTitle);
  console.error(`[atlas/ai] ${title}:`, error);
  toast.error(title, {
    description: message,
    duration: 10000,
    action: action
      ? { label: action.label, onClick: () => { window.location.href = action.to; } }
      : undefined,
  });
  return { title, message };
}

// ---------------------------------------------------------------------------
// Runtime AI status (used by the sidebar pill and AI setup)
// ---------------------------------------------------------------------------
let statusValue = null;

export function getAIStatus() {
  return statusValue;
}

/** Re-check the currently selected path and its model configuration. */
export async function refreshAIStatus() {
  const mode = getAIMode();
  try {
    if (mode === 'ollama') {
      const config = getOllamaConfig();
      if (!config) {
        statusValue = {
          reachable: true,
          configured: false,
          provider: 'demo',
          mode: 'demo',
          message: 'No local model is configured. Open AI setup to connect Ollama.',
        };
      } else {
        const { models } = await probeOllama(config.baseUrl);
        const modelInstalled = models.includes(config.model);
        statusValue = {
          reachable: true,
          configured: true,
          provider: 'ollama',
          model: config.model,
          mode: 'ollama',
          modelInstalled,
          message: modelInstalled ? '' : `The configured model "${config.model}" is no longer installed in Ollama.`,
        };
      }
    } else if (mode === 'hosted') {
      statusValue = { ...(await checkAIStatus()), mode: 'hosted' };
    } else {
      statusValue = {
        reachable: true,
        configured: false,
        provider: 'demo',
        mode: 'demo',
        message: 'Demo output is active. Connect a local Ollama model in AI setup for real generation.',
      };
    }
  } catch (error) {
    const config = getOllamaConfig();
    statusValue = {
      reachable: false,
      configured: !!config,
      provider: config ? 'ollama' : 'demo',
      mode,
      model: config?.model || null,
      message: String(error?.message || error),
    };
  }
  return statusValue;
}

export function peekAIStatus() {
  return statusValue;
}

function demoValue(schema, demoText, depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 6) return demoText;
  switch (schema.type) {
    case 'object': {
      const result = {};
      for (const [key, value] of Object.entries(schema.properties || {})) {
        result[key] = demoValue(value, demoText, depth + 1);
      }
      return result;
    }
    case 'array':
      return [demoValue(schema.items, demoText, depth + 1)];
    case 'number':
    case 'integer':
      return 0;
    case 'boolean':
      return false;
    default:
      return demoText;
  }
}

function demoResponse(params) {
  const demoText = 'DEMO OUTPUT — no model is configured. Open AI setup to connect your local Ollama model, or select an optional hosted provider. This is placeholder text, not an AI answer.';
  return {
    result: params.response_json_schema ? demoValue(params.response_json_schema, demoText) : demoText,
    meta: {
      provider: 'demo',
      model: null,
      grounded: false,
      demo: true,
      warning: 'DEMO OUTPUT — this is placeholder text, not an AI answer. Connect a model in AI setup to generate real output.',
    },
  };
}

// ---------------------------------------------------------------------------
// Single entry point used by current AI features
// ---------------------------------------------------------------------------
/**
 * Invoke the selected model and always return `{ ok, result, meta }`.
 * Local calls use a FIFO queue in ollamaClient; a configured local model never
 * silently falls back to demo or a hosted provider after an error.
 *
 * @param {object} params { prompt, response_json_schema, add_context_from_internet, ... }
 * @param {object} opts { fallbackTitle, quiet }
 */
export async function runAI(params, opts = {}) {
  const { fallbackTitle = 'AI request failed', quiet = false } = opts;
  try {
    const mode = getAIMode();
    let output;
    if (mode === 'ollama') {
      output = await invokeOllamaDetailed(params, getOllamaConfig());
    } else if (mode === 'hosted') {
      const detailed = base44.integrations.Core.InvokeLLMDetailed;
      output = detailed
        ? await detailed(params)
        : { result: await base44.integrations.Core.InvokeLLM(params), meta: {} };
    } else {
      output = demoResponse(params);
    }

    const { result, meta = {} } = output;
    if (meta.demo && !quiet) {
      toast.warning('Demo output', {
        description: meta.warning || 'This is placeholder text, not a model-generated answer.',
        duration: 10000,
      });
    } else if (meta.warning && !quiet) {
      toast.warning(meta.grounded ? 'Web-grounded answer' : 'Not web-grounded', {
        description: meta.warning,
        duration: 8500,
      });
    } else if (meta.provider && meta.provider !== 'gemini' && !meta.grounded && !quiet) {
      // Persistently communicated in the result surface where applicable, and
      // also shown here for every non-Gemini answer from any feature.
      toast.warning('Not web-grounded', {
        description: `${meta.provider} does not use Gemini Google Search grounding. This answer is based on the model and any text you supplied.`,
        duration: 8500,
      });
    }

    if (statusValue) {
      statusValue = {
        ...statusValue,
        configured: mode !== 'demo',
        reachable: true,
        provider: meta.provider || statusValue.provider,
        model: meta.model || statusValue.model,
        lastCallOk: true,
      };
    }
    return { ok: true, result, meta };
  } catch (error) {
    if (statusValue) statusValue = { ...statusValue, lastCallError: explainAIError(error, fallbackTitle).title };
    if (!quiet) notifyAIError(error, fallbackTitle);
    return { ok: false, error, meta: {} };
  }
}

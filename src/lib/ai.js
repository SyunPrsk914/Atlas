// Central AI routing and honest status/error reporting for Atlas.
//
// One real-model path: the provider the server reports, reached through
// `/api/invoke-llm`, which holds any key server-side. NaraRouter is the default;
// a local Ollama is used only when the server is set to LLM_PROVIDER=ollama.
// With no provider configured, Atlas returns clearly labeled demo output and
// refuses to save it.
//
// Every status message and error names the provider that is actually in use,
// taken from the server's answer, never a hard-coded name.

import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { checkAIStatus } from '@/api/llmClient';
import {
  enqueueAI,
  getAIMode,
  getModelOverride,
  providerLabel,
  rememberedProvider,
  setHostedAvailable,
} from '@/api/aiProvider';

export { hasLiveModel, isLiveOutcome } from './aiOutcome';

/** What to do when no provider is configured, for the provider the user expects. */
function setupHint(provider) {
  if (provider === 'ollama') {
    return 'Set LLM_PROVIDER=ollama in .env.local, start Ollama on this computer, and press Re-check in AI setup (see DEPLOYMENT.md).';
  }
  return 'Set NARAROUTER_API_KEY on the deployment (see DEPLOYMENT.md), or set LLM_PROVIDER=ollama to use a local Ollama.';
}

/**
 * Human-readable explanation for anything that can go wrong between the
 * browser and the model.
 * @returns {{ title: string, message: string, action?: { label: string, to: string } }}
 */
export function explainAIError(error, fallbackTitle = 'AI request failed') {
  const message = String(error?.message || error || 'Unknown error');
  const status = error?.status;
  const providerName = providerLabel(error?.provider);

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
    // response and never converts a provider failure into a success.
    return {
      title: `${providerName} is rate-limiting this key`,
      message: `${message} Wait a moment and try again — Atlas sends AI calls one at a time in the order you clicked them, so a burst of clicks is not the cause.${error?.provider === 'nararouter' ? ' The free NaraRouter plan is limited per minute; its live pricing page lists the current numbers.' : ''}`,
    };
  }
  if (status === 402) {
    return { title: `${providerName} key has no remaining credit`, message };
  }
  if (error?.code === 'research_fetch_failed' || error?.code === 'research_login_required') {
    return { title: 'Could not fetch the public source page', message };
  }
  if (error?.provider === 'ollama' && status === 503) {
    return { title: 'Ollama is not running', message };
  }
  if (error?.code === 'unreachable' || error?.code === 'bad_response') {
    return { title: 'AI endpoint not reachable', message };
  }
  if (/Missing Authorization|No API key configured|No hosted AI provider|Could not find the column/i.test(message)) {
    return {
      title: 'AI is not connected yet',
      message: `${message} ${setupHint(error?.provider)} Then reopen AI setup.`,
    };
  }
  if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return {
      title: 'Network error',
      message: `${message}. Check your connection, then reopen AI setup to confirm your AI provider is still selected.`,
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

/**
 * Re-check the connection. `/api/status` is a zero-cost configuration probe: it
 * reports whether a key is wired up without ever returning the key.
 */
export async function refreshAIStatus() {
  const mode = getAIMode();
  try {
    const hosted = await checkAIStatus();
    setHostedAvailable(!!hosted?.configured, hosted?.provider || null);
    if (mode === 'hosted') {
      // The server names the provider it will actually call; before it answers
      // (or if the server is unreachable) the last provider seen is shown.
      const provider = hosted?.provider || rememberedProvider() || null;
      const label = providerLabel(provider || 'nararouter');
      statusValue = {
        ...hosted,
        mode: 'hosted',
        provider,
        providerLabel: label,
        message: hosted?.configured
          ? (hosted.message || '')
          : `${label} is selected but it is not connected. ${hosted?.message || setupHint(provider)} Or switch to demo mode in AI setup.`,
      };
    } else {
      statusValue = {
        ...hosted,
        mode: 'demo',
        provider: 'demo',
        providerLabel: 'Demo',
        message: hosted?.configured
          ? 'Demo output is active. Select your AI provider in AI setup for real generation.'
          : (hosted?.message
            // The server's own reason, e.g. "Ollama is not running at …".
            ? `Demo output is active. ${hosted.message}`
            : 'Demo output is active — no AI provider is connected yet.'),
      };
    }
  } catch (error) {
    statusValue = {
      reachable: false,
      configured: false,
      provider: mode === 'hosted' ? (rememberedProvider() || null) : 'demo',
      providerLabel: mode === 'hosted' ? providerLabel(rememberedProvider() || null) : 'Demo',
      mode,
      model: null,
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
  const demoText = 'DEMO OUTPUT — no AI provider is connected to this deployment. Open AI setup to connect one. This is placeholder text, not an AI answer.';
  return {
    result: params.response_json_schema ? demoValue(params.response_json_schema, demoText) : demoText,
    meta: {
      provider: 'demo',
      model: null,
      grounded: false,
      demo: true,
      warning: 'DEMO OUTPUT — this is placeholder text, not a model-generated answer. Connect an AI provider in AI setup to generate real output.',
    },
  };
}

// ---------------------------------------------------------------------------
// Single entry point used by every AI feature
// ---------------------------------------------------------------------------
/**
 * Invoke the model and always return `{ ok, result, meta }`.
 *
 * Calls are serialized in click order (see `enqueueAI`) so a feature that fires
 * several requests — a long document analyzed in parts — cannot collide into a
 * provider rate limit. A configured provider never silently falls back to demo
 * output after an error.
 *
 * @param {object} params { prompt, response_json_schema, add_context_from_internet, ... }
 * @param {object} opts { fallbackTitle, quiet }
 */
export async function runAI(params, opts = {}) {
  const { fallbackTitle = 'AI request failed', quiet = false } = opts;
  const mode = getAIMode();
  if (mode !== 'hosted') {
    const output = demoResponse(params);
    if (!quiet) {
      toast.warning('Demo output', {
        description: output.meta.warning,
        duration: 10000,
      });
    }
    return { ok: true, result: output.result, meta: output.meta };
  }

  try {
    const output = await enqueueAI(async () => {
      const detailed = base44.integrations.Core.InvokeLLMDetailed;
      // The endpoint speaks `max_tokens`; callers speak `max_output_tokens`.
      // Translate so one call site serves both, and never lower a provider's own
      // generous default when the caller did not ask for a specific cap.
      const hostedParams = { ...params };
      // The model chosen in AI setup applies to every feature: no caller pins a
      // model for a single request, so changing it in AI setup changes the whole app.
      const chosen = getModelOverride();
      if (chosen && !hostedParams.model) hostedParams.model = chosen;
      if (!hostedParams.max_tokens && hostedParams.max_output_tokens) {
        hostedParams.max_tokens = hostedParams.max_output_tokens;
      }
      delete hostedParams.max_output_tokens;
      return detailed
        ? await detailed(hostedParams)
        : { result: await base44.integrations.Core.InvokeLLM(hostedParams), meta: {} };
    });

    const { result, meta = {} } = output;
    if (meta.truncated && !quiet) {
      // A cut-off answer is not a slightly worse answer, it is an incomplete
      // one. Say so loudly: this is how a 650-word essay used to become 90
      // words with nothing on screen to explain it.
      toast.error('The model stopped before finishing', {
        description: 'The answer hit the model\'s output limit, so it may be cut off mid-sentence. Atlas flags it rather than passing it off as a finished draft — try again, or send fewer materials.',
        duration: 12000,
      });
    }
    if (meta.demo && !quiet) {
      toast.warning('Demo output', {
        description: meta.warning || 'This is placeholder text, not a model-generated answer.',
        duration: 10000,
      });
    } else if (meta.grounded && !quiet) {
      toast.success('Web-grounded answer', { description: meta.warning || '', duration: 8500 });
    } else if (params.add_context_from_internet && !meta.grounded && !quiet) {
      // Only worth interrupting for when grounding was actually asked for:
      // NaraRouter is the provider now, and it does not offer Google Search
      // grounding, so saying so on every single call would be noise. The status
      // pill and the University Research page state it permanently instead.
      toast.warning('Not web-grounded', {
        description: meta.warning || `${providerLabel(meta.provider)} does not offer Google Search grounding. This answer comes from the model and the text Atlas supplied — including the research already saved for this university.`,
        duration: 8500,
      });
    }

    if (statusValue) {
      statusValue = {
        ...statusValue,
        configured: true,
        reachable: true,
        provider: meta.provider || statusValue.provider,
        providerLabel: providerLabel(meta.provider || statusValue.provider),
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

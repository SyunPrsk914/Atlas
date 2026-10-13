// Central AI routing and honest status/error reporting for Atlas.
//
// One real-model path: NaraRouter, reached through `/api/invoke-llm`, which
// holds the key server-side. With no key configured on the deployment, Atlas
// returns clearly labeled demo output and refuses to save it.
//
// There is deliberately no second provider path: every failure mode, status
// message, and setting describes this one provider, so nothing can disagree
// with anything else. The former on-device model path is removed.

import { toast } from 'sonner';
import { base44 } from '@/api/base44Client';
import { checkAIStatus } from '@/api/llmClient';
import {
  enqueueAI,
  getAIMode,
  getModelOverride,
  providerLabel,
  setHostedAvailable,
} from '@/api/aiProvider';

export { hasLiveModel, isLiveOutcome } from './aiOutcome';

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
      message: `${message} Wait a moment and try again — Atlas sends AI calls one at a time in the order you clicked them, so a burst of clicks is not the cause. The free NaraRouter plan is limited per minute; its live pricing page lists the current numbers.`,
    };
  }
  if (status === 402) {
    return { title: `${providerName} key has no remaining credit`, message };
  }
  if (error?.code === 'research_fetch_failed' || error?.code === 'research_login_required') {
    return { title: 'Could not fetch the public source page', message };
  }
  if (error?.code === 'unreachable' || error?.code === 'bad_response') {
    return { title: 'AI endpoint not reachable', message };
  }
  if (/Missing Authorization|No API key configured|No hosted AI provider|Could not find the column/i.test(message)) {
    return {
      title: 'AI is not connected yet',
      message: `${message} Set NARAROUTER_API_KEY on the deployment (see DEPLOYMENT.md), then reopen AI setup.`,
    };
  }
  if (/fetch failed|Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return {
      title: 'Network error',
      message: `${message}. Check your connection, then reopen AI setup to confirm NaraRouter is still selected.`,
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
      statusValue = {
        ...hosted,
        mode: 'hosted',
        providerLabel: providerLabel(hosted?.provider),
        message: hosted?.configured
          ? (hosted.message || '')
          : 'NaraRouter is selected but this deployment has no API key. Add NARAROUTER_API_KEY, or switch to demo mode in AI setup.',
      };
    } else {
      statusValue = {
        ...hosted,
        mode: 'demo',
        provider: 'demo',
        providerLabel: 'Demo',
        message: hosted?.configured
          ? 'Demo output is active. Select NaraRouter in AI setup for real generation.'
          : 'Demo output is active — this deployment has no AI key configured yet.',
      };
    }
  } catch (error) {
    statusValue = {
      reachable: false,
      configured: false,
      provider: mode === 'hosted' ? 'nararouter' : 'demo',
      providerLabel: mode === 'hosted' ? 'NaraRouter' : 'Demo',
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
  const demoText = 'DEMO OUTPUT — no AI key is configured on this deployment. Open AI setup to select NaraRouter. This is placeholder text, not an AI answer.';
  return {
    result: params.response_json_schema ? demoValue(params.response_json_schema, demoText) : demoText,
    meta: {
      provider: 'demo',
      model: null,
      grounded: false,
      demo: true,
      warning: 'DEMO OUTPUT — this is placeholder text, not a model-generated answer. Select NaraRouter in AI setup to generate real output.',
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

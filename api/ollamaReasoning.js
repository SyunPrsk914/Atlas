// Reasoning ("thinking") support for local Ollama models.
//
// qwen3:8b, the model Atlas recommends for local use, is a reasoning model: it
// writes a private chain of thought and only then writes the answer. Ollama
// exposes that as a first-class feature — `think` on the request, and the trace
// in `message.thinking` next to the answer in `message.content` — and
// `/api/show` says which controls a model accepts.
//
// Atlas uses those controls instead of guessing:
//   * it asks for reasoning explicitly, so a global `/set nothink`, a Modelfile
//     or an older template cannot quietly take the depth away;
//   * it never sends `think` to a model that says it has no such control,
//     because Ollama answers that with HTTP 400;
//   * it keeps the trace out of the answer, and recovers the answer from the
//     trace when a model writes its JSON there and leaves `content` empty.
//
// The probe result is cached per model: `/api/show` is a local manifest read,
// but there is no reason to repeat it on every AI action.

/** Cache lifetime for a `/api/show` read. A re-pulled model is picked up after this. */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** How long to wait for the local manifest before giving up and asking anyway. */
const PROBE_TIMEOUT_MS = 4000;

/** @type {Map<string, { at: number, info: object }>} */
const cache = new Map();

/**
 * What a model's `/api/show` answer says about its reasoning controls.
 *
 * `supported` is `true` / `false` when the model says so, and `null` when the
 * server is older than the field or the manifest could not be read — an unknown
 * is never treated as "no", because that would silently switch reasoning off.
 *
 * @param {object} show the /api/show response body
 * @returns {{ supported: boolean|null, defaultOn: boolean, levels: string[], source: string }}
 */
export function thinkingSupport(show = {}) {
  const thinking = show?.thinking;
  const values = Array.isArray(thinking?.values) ? thinking.values : null;
  if (values && values.length) {
    const levels = values.filter((value) => typeof value === 'string' && value.trim() !== '');
    const supported = values.some((value) => value === true || (typeof value === 'string' && value.trim() !== ''));
    const fallback = thinking?.default;
    const defaultOn = fallback === true || (typeof fallback === 'string' && fallback.trim() !== '');
    return { supported, defaultOn, levels, source: 'model' };
  }
  const capabilities = Array.isArray(show?.capabilities) ? show.capabilities : [];
  if (capabilities.includes('thinking')) {
    return { supported: true, defaultOn: true, levels: [], source: 'capabilities' };
  }
  if (show && typeof show === 'object') {
    // An older server with no thinking metadata: fall back to the model family
    // and to a template that opens a reasoning block. Asking anyway is safe —
    // a model that refuses is retried once without `think`.
    const family = String(show?.details?.family || show?.details?.family_id || '').toLowerCase();
    const template = String(show?.template || '');
    const knownFamily = /(qwen3|qwq|deepseek[-_ ]?r1|deepseek-v3\.1|gpt[-_ ]?oss)/.test(family);
    if (knownFamily || /<think>/i.test(template)) {
      return { supported: null, defaultOn: true, levels: [], source: 'template' };
    }
    return { supported: false, defaultOn: false, levels: [], source: 'model' };
  }
  return { supported: null, defaultOn: false, levels: [], source: 'unknown' };
}

/**
 * The longest context the model itself advertises, or null.
 *
 * Ollama silently clamps a larger `num_ctx` down to this, so Atlas compares the
 * two and says so rather than letting the window shrink without a word.
 * @param {object} show
 * @returns {number|null}
 */
export function modelContextLength(show = {}) {
  const info = show?.model_info;
  if (!info || typeof info !== 'object') return null;
  let best = null;
  for (const [key, value] of Object.entries(info)) {
    if (!/\.context_length$/i.test(key)) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0 && (best === null || parsed > best)) best = parsed;
  }
  return best;
}

/**
 * @typedef {object} OllamaModelInfo
 * @property {boolean} ok the manifest could be read
 * @property {string} model
 * @property {object|null} show the raw /api/show body
 * @property {{ supported: boolean|null, defaultOn: boolean, levels: string[], source: string }} support
 * @property {number|null} contextLength
 * @property {string} problem why the manifest could not be read ('' when it could)
 */

/**
 * Read one model's manifest. Never throws: an unreadable manifest means
 * "unknown", and the caller then asks the model itself.
 *
 * @param {string} baseUrl
 * @param {string} model
 * @param {{ timeoutMs?: number, refresh?: boolean }} [options]
 * @returns {Promise<OllamaModelInfo>}
 */
export async function describeOllamaModel(baseUrl, model, { timeoutMs = PROBE_TIMEOUT_MS, refresh = false } = {}) {
  const key = `${baseUrl}|${model}`;
  if (!refresh) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.info;
  }

  /** @type {OllamaModelInfo} */
  let info;
  try {
    const response = await fetch(`${String(baseUrl).replace(/\/+$/, '')}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const show = await response.json().catch(() => null);
    if (!response.ok || !show) {
      info = {
        ok: false,
        model,
        show: null,
        support: thinkingSupport(null),
        contextLength: null,
        problem: `Ollama answered HTTP ${response.status} for this model's details, so Atlas asks the model itself whether it can reason.`,
      };
    } else {
      info = {
        ok: true,
        model,
        show,
        support: thinkingSupport(show),
        contextLength: modelContextLength(show),
        problem: '',
      };
    }
  } catch (error) {
    info = {
      ok: false,
      model,
      show: null,
      support: thinkingSupport(null),
      contextLength: null,
      problem: `Atlas could not read this model's details (${String(error?.message || error)}), so it asks the model itself whether it can reason.`,
    };
  }

  cache.set(key, { at: Date.now(), info });
  return info;
}

/**
 * Record what a real answer proved about a model: a reasoning trace in the
 * response means the model reasons, and Ollama's own
 * `"x" does not support thinking` refusal means it does not. This keeps Atlas
 * right even on a server too old to describe its models.
 *
 * @param {string} baseUrl
 * @param {string} model
 * @param {boolean} supported
 */
export function rememberThinkingSupport(baseUrl, model, supported) {
  const key = `${baseUrl}|${model}`;
  const previous = cache.get(key)?.info;
  if (previous?.support?.supported === supported && previous?.support?.source === 'response') return;
  cache.set(key, {
    at: Date.now(),
    info: {
      ok: previous?.ok ?? false,
      model,
      show: previous?.show ?? null,
      support: { supported, defaultOn: supported, levels: previous?.support?.levels || [], source: 'response' },
      contextLength: previous?.contextLength ?? null,
      problem: previous?.problem ?? '',
    },
  });
}

/**
 * The `think` value to send, or `undefined` to send nothing at all.
 *
 * A model that advertises no reasoning control never receives one: Ollama
 * answers `think: true` on such a model with HTTP 400.
 *
 * @param {true | false | string | null} wanted from `ollamaConfig().think`
 * @param {{ supported: boolean|null }} support
 * @returns {true | false | string | undefined}
 */
export function resolveThinkValue(wanted, support) {
  if (wanted === null || wanted === undefined) return undefined;
  if (support?.supported === false) return undefined;
  return wanted;
}

/** Whether reasoning is in force for this call. */
export function thinkingIsOn(thinkValue, support) {
  if (thinkValue !== undefined) return thinkValue !== false;
  return !!support?.defaultOn;
}

const THINK_BLOCK = /[ \t]*<think>([\s\S]*?)<\/think>[ \t]*\n?/gi;
const OPEN_THINK = /<think>/i;

/**
 * Separate an answer from any reasoning a model leaked into it.
 *
 * Current Ollama splits the two into `message.thinking` and `message.content`
 * itself; an older server, or a model with a hand-written template, can leave
 * `<think>…
</think>

` inside the answer. That text is reasoning, so it
 * is never allowed to stand in for an answer — least of all as the JSON a
 * review or a draft is parsed from.
 *
 * @param {string} text
 * @returns {{ text: string, thinking: string }}
 */
export function splitThinkingTrace(text) {
  const raw = typeof text === 'string' ? text : '';
  if (!raw) return { text: '', thinking: '' };
  const traces = [];
  let answer = raw.replace(THINK_BLOCK, (_match, inner) => {
    traces.push(inner);
    return '';
  });
  // A run stopped mid-reasoning leaves the block open. Cut it away: everything
  // after `<think>` is an unfinished thought, not a draft.
  const open = answer.search(OPEN_THINK);
  if (open >= 0) {
    traces.push(answer.slice(open + '<think>'.length));
    answer = answer.slice(0, open);
  }
  return {
    text: answer.replace(/^\s+|\s+$/g, ''),
    thinking: traces.join('\n\n').replace(/^\s+|\s+$/g, ''),
  };
}

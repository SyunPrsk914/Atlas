// Verification for the local Ollama provider (LLM_PROVIDER=ollama).
//
// Runs the REAL server handlers (api/invoke-llm.js, api/status.js,
// api/models.js) against a small mock of Ollama's HTTP API and a mock of the
// NaraRouter OpenAI-compatible endpoint, so no real model and no network are
// needed. It checks:
//
//   1. the request sent to Ollama (native /api/chat, streamed, no key, no
//      silent truncation, explicit context window, JSON mode only when a schema
//      is asked, the reasoning controls, keep-alive);
//   2. reasoning ("thinking") models such as qwen3:8b: that Atlas asks them to
//      think, keeps the trace out of the answer, reserves output room for it,
//      keeps their own sampling guidance, recovers a JSON answer that landed in
//      the trace, and never sends `think` to a model that refuses it;
//   3. the answers: parsed JSON, plain text, cut-off answers, empty answers,
//      reasoning-only answers;
//   4. every failure a local user can actually hit, each with a message that
//      says what to do (not running, model not pulled, prompt too large, OOM,
//      the Atlas deadline);
//   5. that a missing model is never swapped for another model;
//   6. the status pill and the model picker tell the truth about Ollama;
//   7. that NaraRouter is still the default and still works unchanged.
//
// Run with: node --import ./scripts/register-ext.mjs scripts/verify-ollama.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { ollamaConfig, describeOllamaNetworkError } from '../api/ollamaConfig.js';
import { ollamaChat } from '../api/ollamaChat.js';
import { splitThinkingTrace, thinkingSupport } from '../api/ollamaReasoning.js';

// ---------------------------------------------------------------------------
// Mock Ollama + mock NaraRouter
// ---------------------------------------------------------------------------
const seen = [];

/**
 * What each model's own manifest (`/api/show`) claims. Mirrors the real
 * shapes: qwen3 advertises on/off with thinking on by default, gpt-oss
 * advertises effort levels, llama3.2 has no reasoning control at all.
 */
const MANIFESTS = {
  'qwen3:8b': { thinking: { values: [false, true], default: true }, family: 'qwen3', context: 40960, capabilities: ['completion', 'thinking', 'tools'] },
  'gpt-oss:20b': { thinking: { values: ['low', 'medium', 'high'], default: 'medium' }, family: 'gpt-oss', context: 131072, capabilities: ['completion', 'thinking'] },
  'llama3.2:latest': { thinking: { values: [false], default: false }, family: 'llama', context: 131072, capabilities: ['completion', 'tools'] },
  'llama3.2': { thinking: { values: [false], default: false }, family: 'llama', context: 131072, capabilities: ['completion', 'tools'] },
  'qwen2.5:7b': { thinking: { values: [false], default: false }, family: 'qwen2', context: 32768, capabilities: ['completion', 'tools'] },
  // The other fixture models stand in for "a reasoning model that …"; they all
  // inherit qwen3's controls.
  default: { thinking: { values: [false, true], default: true }, family: 'qwen3', context: 40960, capabilities: ['completion', 'thinking'] },
};
const NO_THINK_SUPPORT = 'refuses-thinking';

// The closing reasoning tag is assembled here rather than written literally.
const THINK_CLOSE = '</' + 'think' + '>';

/** One streamed Ollama answer, built from the parts a model would emit. */
function streamAnswer(res, body, parts) {
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
  const chunkBase = { model: body.model, created_at: '2026-10-13T00:00:00Z', done: false };
  for (const part of parts) {
    if (typeof part === 'string') {
      // A raw write, so the caller's line buffering is exercised.
      res.write(part);
      continue;
    }
    res.write(`${JSON.stringify({ ...chunkBase, ...part })}\n`);
  }
}

function finishWith(res, body, extra = {}) {
  res.write(`${JSON.stringify({
    model: body.model, created_at: '2026-10-13T00:00:00Z', done: true,
    prompt_eval_count: 40, eval_count: 9, ...extra,
  })}\n`);
}

const server = createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    const send = (status, payload) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    seen.push({ method: req.method, url: req.url, body, headers: req.headers });

    if (req.method === 'GET' && req.url === '/api/tags') {
      return send(200, {
        models: [
          { name: 'qwen3:8b', model: 'qwen3:8b' },
          { name: 'qwen2.5:7b', model: 'qwen2.5:7b' },
          { name: 'llama3.2:latest', model: 'llama3.2:latest' },
        ],
      });
    }

    if (req.method === 'POST' && req.url === '/api/show') {
      const manifest = MANIFESTS[body.model] || MANIFESTS.default;
      return send(200, {
        model: body.model,
        details: { family: manifest.family, parameter_size: '8.2B' },
        capabilities: manifest.capabilities,
        ...(manifest.thinking ? { thinking: manifest.thinking } : {}),
        model_info: { [`${manifest.family}.context_length`]: manifest.context },
        template: '<|im_start|>user\n{{ .Prompt }}<|im_end|>\n<|im_start|>assistant\n',
      });
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const fail = (status, error) => send(status, { error });

      // A model with no reasoning control answers `think: true` the way Ollama
      // does: HTTP 400 naming the model. Atlas must recover from that.
      if (body.model === NO_THINK_SUPPORT && body.think) {
        return fail(400, `"${body.model}" does not support thinking`);
      }

      switch (body.model) {
        case 'llama3.2':
        case 'llama3.2:latest': {
          streamAnswer(res, body, [{ message: { role: 'assistant', content: '{"ok": true, "n": 3}' } }]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case 'qwen2.5:7b': {
          streamAnswer(res, body, [{ message: { role: 'assistant', content: 'plain text answer' } }]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case 'qwen3:8b': {
          // The reasoning trace arrives first and in pieces, then the answer —
          // one content chunk is deliberately split across two writes.
          streamAnswer(res, body, [
            { message: { role: 'assistant', thinking: 'First I weigh the evidence ' } },
            { message: { role: 'assistant', thinking: 'in the transcript, then the essay prompt.' } },
            { message: { role: 'assistant', content: 'The draft works ' } },
            '{"model":"qwen3:8b","done":false,"mess',
            'age":{"role":"assistant","content":"because the opening is specific."}}\n',
          ]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case 'json-in-thinking': {
          // The documented failure mode: everything useful is in the trace and
          // the answer field comes back empty.
          streamAnswer(res, body, [
            { message: { role: 'assistant', thinking: 'Scoring each dimension in turn. {"ok": true, "n": 7}' } },
            { message: { role: 'assistant', content: '' } },
          ]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case 'thinking-only': {
          // Reasoning with no answer at all, and no JSON to recover.
          streamAnswer(res, body, [
            { message: { role: 'assistant', thinking: 'Let me think about the applicant for a moment.' } },
            { message: { role: 'assistant', content: '' } },
          ]);
          finishWith(res, body, { done_reason: 'length' });
          return res.end();
        }
        case 'leaked-think': {
          // An older server (or a hand-written template) leaves the tags in the
          // answer itself.
          streamAnswer(res, body, [
            { message: { role: 'assistant', content: '<think>Weighing the options.\n' + THINK_CLOSE + '\n\nA clean answer.' } },
          ]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case 'short-len': {
          streamAnswer(res, body, [{ message: { role: 'assistant', content: 'partial answ' } }]);
          finishWith(res, body, { done_reason: 'length' });
          return res.end();
        }
        case 'empty-model': {
          streamAnswer(res, body, [{ message: { role: 'assistant', content: '' } }]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case NO_THINK_SUPPORT: {
          // Reached only on the retry, once `think` is gone.
          streamAnswer(res, body, [{ message: { role: 'assistant', content: 'A direct answer.' } }]);
          finishWith(res, body, { done_reason: 'stop' });
          return res.end();
        }
        case 'slow-model': {
          // Says nothing until after the Atlas deadline has passed.
          res.on('error', () => { /* the client gave up first: that is the point */ });
          const late = setTimeout(() => {
            if (res.writableEnded || res.destroyed) return;
            streamAnswer(res, body, [{ message: { role: 'assistant', content: 'too late' } }]);
            finishWith(res, body, { done_reason: 'stop' });
            res.end();
          }, 8000);
          late.unref?.();
          return undefined;
        }
        case 'missing-model':
          return fail(404, `model "${body.model}" not found, try pulling it first`);
        case 'ctx-model':
          return fail(400, 'input length exceeds maximum context length');
        case 'oom-model':
          return fail(500, 'model requires more system memory (12.0 GiB) than is available');
        case 'kv-oom':
          // Verbatim from a real machine: an 8B model with a large context on a
          // GPU that cannot hold weights and cache at once.
          return fail(500, 'llama-server reported out-of-memory during startup: ggml_backend_buft_alloc_buffer_n_default: failed to allocate Vulkan0 buffer of size 1073741824 llama_init_from_model: failed to initialize the context: failed to allocate buffer for kv cache');
        default:
          return fail(404, `model "${body.model}" not found, try pulling it first`);
      }
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      return send(200, {
        model: body.model,
        choices: [{ message: { role: 'assistant', content: '{"ok": true, "n": 1}' }, finish_reason: 'stop' }],
      });
    }

    send(404, { error: `mock has no route for ${req.method} ${req.url}` });
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const mockBase = `http://127.0.0.1:${server.address().port}`;
// A port nothing listens on: connecting to it fails immediately (ECONNREFUSED).
// Take a free port from the OS and close it again, so the number is real.
const probe = createServer();
await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const deadBase = `http://127.0.0.1:${probe.address().port}`;
await new Promise((resolve) => probe.close(resolve));

// ---------------------------------------------------------------------------
// Environment control: the handlers read process.env at call time.
// ---------------------------------------------------------------------------
const CLEARED = /^(SUPABASE_|VITE_SUPABASE_|NEXT_PUBLIC_SUPABASE_|NARAROUTER_|GEMINI_|GROQ_|OPENROUTER_|OPENAI_|ANTHROPIC_|OLLAMA_|LLM_)/;
function setEnv(vars) {
  for (const key of Object.keys(process.env)) if (CLEARED.test(key)) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
}

const { handleInvokeLLM } = await import('../api/invoke-llm.js');
const { handleStatus } = await import('../api/status.js');
const { handleModels } = await import('../api/models.js');

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = payload ?? ''; },
    json() { return JSON.parse(this.body); },
  };
}

async function invoke(payload) {
  const res = fakeRes();
  await handleInvokeLLM({ method: 'POST', headers: {}, body: payload }, res);
  return { status: res.statusCode, body: res.json() };
}

async function getJson(handler) {
  const res = fakeRes();
  await handler({ method: 'GET', headers: {} }, res);
  return { status: res.statusCode, body: res.json() };
}

function lastChatFor(model) {
  return [...seen].reverse().find((r) => r.url === '/api/chat' && r.body.model === model);
}

const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, n: { type: 'integer' } }, required: ['ok'] };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error });
  }
}

// --- configuration -----------------------------------------------------------
await test('config: defaults to 127.0.0.1:11434, llama3.2, 16384-token context', () => {
  const cfg = ollamaConfig({});
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:11434');
  assert.equal(cfg.model, 'llama3.2');
  assert.equal(cfg.numCtx, 16384);
  assert.equal(cfg.problem, '');
});

await test('config: a trailing slash or /v1 suffix is normalised; a bad URL is reported', () => {
  assert.equal(ollamaConfig({ OLLAMA_BASE_URL: 'http://host:11434/v1/' }).baseUrl, 'http://host:11434');
  assert.equal(ollamaConfig({ OLLAMA_NUM_CTX: 'abc' }).numCtx, 16384, 'a non-number falls back to the default');
  assert.equal(ollamaConfig({ OLLAMA_NUM_CTX: '1024' }).numCtx, 16384, 'a context below 2048 is ignored');
  assert.equal(ollamaConfig({ OLLAMA_NUM_CTX: '32768' }).numCtx, 32768);
  assert.match(ollamaConfig({ OLLAMA_BASE_URL: 'localhost:11434' }).problem, /must start with http/);
});

await test('config: reasoning is asked for by default, with room for the trace and the model\'s own sampling', () => {
  const cfg = ollamaConfig({});
  assert.equal(cfg.think, true, 'a thinking model left to a global nothink would lose its depth');
  assert.equal(cfg.thinkBudget, 8192);
  assert.equal(cfg.minTemperature, 0.6, "Qwen3's published floor for thinking mode");
  assert.equal(cfg.topP, 0.95);
  assert.equal(cfg.topK, 20);
  assert.equal(cfg.keepAlive, '30m');
  assert.equal(cfg.timeoutMs, 30 * 60 * 1000);
  assert.deepEqual(cfg.warnings, []);
});

await test('config: OLLAMA_THINK accepts on/off/auto/levels, and says so when it does not', () => {
  assert.equal(ollamaConfig({ OLLAMA_THINK: 'off' }).think, false);
  assert.equal(ollamaConfig({ OLLAMA_THINK: 'FALSE' }).think, false);
  assert.equal(ollamaConfig({ OLLAMA_THINK: 'auto' }).think, null, 'auto = send no think field');
  assert.equal(ollamaConfig({ OLLAMA_THINK: 'high' }).think, 'high');
  assert.equal(ollamaConfig({ OLLAMA_THINK: 'max' }).think, 'max');
  const bad = ollamaConfig({ OLLAMA_THINK: 'sometimes' });
  assert.equal(bad.think, true, 'an unreadable value falls back to reasoning, never to less quality');
  assert.match(bad.warnings.join(' '), /OLLAMA_THINK="sometimes"/);
});

await test('config: a value that cannot be used is reported, not applied silently', () => {
  const cfg = ollamaConfig({
    OLLAMA_THINK_BUDGET: '10', OLLAMA_MIN_TEMPERATURE: '3', OLLAMA_TIMEOUT_MS: '10',
    OLLAMA_KEEP_ALIVE: 'half an hour',
  });
  assert.equal(cfg.thinkBudget, 8192);
  assert.equal(cfg.minTemperature, 2, 'a floor above the provider maximum is capped, and the note says so');
  assert.equal(cfg.timeoutMs, 30 * 60 * 1000);
  assert.equal(cfg.keepAlive, '30m');
  assert.equal(cfg.warnings.length, 4, cfg.warnings.join(' | '));
  // A floor of 0 is a real choice: "never touch Atlas's temperature".
  assert.equal(ollamaConfig({ OLLAMA_MIN_TEMPERATURE: '0' }).minTemperature, 0);
});

await test('config: the video-memory levers are opt-in, and 0 is a real keep-alive', async () => {
  assert.equal(ollamaConfig({}).numGpu, null, 'unset means Ollama decides');
  assert.equal(ollamaConfig({ OLLAMA_NUM_GPU: '0' }).numGpu, 0);
  assert.equal(ollamaConfig({ OLLAMA_NUM_GPU: '20' }).numGpu, 20);
  const bad = ollamaConfig({ OLLAMA_NUM_GPU: 'lots' });
  assert.equal(bad.numGpu, null);
  assert.match(bad.warnings.join(' '), /OLLAMA_NUM_GPU="lots"/);
  // Unloading straight after a call is the escape hatch on a small GPU.
  assert.equal(ollamaConfig({ OLLAMA_KEEP_ALIVE: '0' }).keepAlive, '0');
  assert.equal(ollamaConfig({ OLLAMA_KEEP_ALIVE: '-1' }).keepAlive, '-1');
  assert.deepEqual(ollamaConfig({ OLLAMA_KEEP_ALIVE: '0' }).warnings, []);
});

await test('network errors: connection refused is named in plain words', async () => {
  try {
    await fetch(`${deadBase}/api/tags`);
    assert.fail('expected the closed port to refuse');
  } catch (error) {
    assert.match(describeOllamaNetworkError(error), /connection refused/);
  }
});

await test('reasoning: a manifest decides what a model supports', () => {
  assert.deepEqual(
    thinkingSupport({ thinking: { values: [false, true], default: true } }),
    { supported: true, defaultOn: true, levels: [], source: 'model' },
  );
  assert.deepEqual(
    thinkingSupport({ thinking: { values: ['low', 'medium', 'high'], default: 'medium' } }),
    { supported: true, defaultOn: true, levels: ['low', 'medium', 'high'], source: 'model' },
  );
  assert.deepEqual(
    thinkingSupport({ thinking: { values: [false], default: false } }),
    { supported: false, defaultOn: false, levels: [], source: 'model' },
  );
  // An older server with no metadata: the capability list still counts.
  assert.equal(thinkingSupport({ capabilities: ['completion', 'thinking'] }).supported, true);
  // A readable manifest with no reasoning evidence means the model has none.
  assert.equal(thinkingSupport({ details: { family: 'llama' } }).supported, false);
  // A manifest that could not be read at all is "unknown", never "no": Atlas
  // asks anyway and learns from the answer.
  assert.equal(thinkingSupport(null).supported, null);
  assert.equal(thinkingSupport({ details: { family: 'qwen3' } }).supported, null);
});

await test('reasoning: a leaked reasoning block is separated from the answer', () => {
  const clean = splitThinkingTrace('<think>A thought.' + THINK_CLOSE + '\n\nThe answer.');
  assert.equal(clean.text, 'The answer.');
  assert.equal(clean.thinking, 'A thought.');
  // A run cut off mid-reasoning leaves the block open: that is not an answer.
  const cut = splitThinkingTrace('<think>An unfinished thought');
  assert.equal(cut.text, '');
  assert.match(cut.thinking, /unfinished/);
  assert.deepEqual(splitThinkingTrace(''), { text: '', thinking: '' });
});

// --- status and model picker -------------------------------------------------
await test('status: Ollama selected and answering -> configured, default model, no message', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await getJson(handleStatus);
  assert.equal(status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.provider, 'ollama');
  assert.equal(body.model, 'llama3.2');
  assert.equal(body.grounding, false);
  assert.equal(body.message, '');
});

await test('status: reports that llama3.2 has no reasoning, and qwen3:8b does', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'llama3.2' });
  const plain = (await getJson(handleStatus)).body;
  assert.equal(plain.thinking.supported, false, 'llama3.2 must not be reported as a reasoning model');
  assert.equal(plain.thinking.on, false);

  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b' });
  const thinking = (await getJson(handleStatus)).body;
  assert.equal(thinking.thinking.supported, true);
  assert.equal(thinking.thinking.on, true, 'Atlas asks for the reasoning it is configured to ask for');
  assert.equal(thinking.thinking.requested, true);
  assert.equal(thinking.thinking.think_budget, 8192);
  assert.equal(thinking.context.requested, 16384);
  assert.equal(thinking.context.model_max, 40960);
  assert.equal(thinking.context.clamped, false);
  assert.ok(seen.some((r) => r.url === '/api/show'), 'the model is described from its own manifest');
});

await test('status: a context window bigger than the model\'s own is named, not clamped silently', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b', OLLAMA_NUM_CTX: '65536' });
  const { body } = await getJson(handleStatus);
  assert.equal(body.context.clamped, true);
  assert.match(body.notes.join(' '), /40960-token context/);
  assert.equal(body.message, '', 'a healthy connection still has no error message');
});

await test('status: Ollama selected but not running -> NOT configured, with the fix in the message', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: deadBase });
  const { body } = await getJson(handleStatus);
  assert.equal(body.configured, false, 'the pill must not claim a connection that does not exist');
  assert.equal(body.provider, 'ollama', 'the pill names the selected provider, never NaraRouter');
  assert.match(body.message, /Ollama is not running/);
  assert.match(body.message, /Re-check/);
});

await test('models: lists the models pulled into Ollama, sorted, with the default', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { body } = await getJson(handleModels);
  assert.equal(body.ok, true);
  assert.equal(body.provider, 'ollama');
  assert.equal(body.listable, true);
  assert.deepEqual(body.models, ['llama3.2:latest', 'qwen2.5:7b', 'qwen3:8b']);
  assert.equal(body.default_model, 'llama3.2');
});

await test('models: says which installed models reason, so the picker is not a guess', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { body } = await getJson(handleModels);
  assert.deepEqual(body.thinking_models, ['qwen3:8b']);
  assert.match(body.message, /reason before answering/);
});

await test('models: an unreachable Ollama says so instead of an empty success', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: deadBase });
  const { body } = await getJson(handleModels);
  assert.equal(body.ok, false);
  assert.deepEqual(body.models, []);
  assert.match(body.message, /not reachable/);
});

// --- generation: the request that goes to Ollama -----------------------------
await test('chat: JSON schema -> native /api/chat, streamed, format json, no key, never truncated, parsed object back', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Score this.', response_json_schema: SCHEMA });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.result, { ok: true, n: 3 });
  assert.equal(body.meta.provider, 'ollama');
  assert.equal(body.meta.model, 'llama3.2');
  assert.equal(body.meta.finish_reason, 'stop');
  assert.equal(body.meta.grounded, false);

  const sent = lastChatFor('llama3.2').body;
  assert.equal(sent.stream, true, 'streamed: a long run must not die on a transport timeout');
  assert.equal(sent.truncate, false, 'a prompt larger than the window must be refused, not cut silently');
  assert.equal(sent.format, 'json');
  assert.equal(sent.options.num_ctx, 16384);
  assert.equal(sent.options.num_predict, -1, 'no cap of Atlas\'s own, and no Modelfile cap inherited');
  assert.equal(sent.keep_alive, '30m');
  assert.match(sent.messages[0].content, /Respond with ONLY one valid JSON object/);
  const chatCall = seen.find((r) => r.url === '/api/chat');
  assert.equal(chatCall.headers.authorization, undefined, 'no API key is ever sent to Ollama');
});

await test('chat: a model with no reasoning control is never sent `think` (Ollama would 400)', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_NUM_CTX: '32768' });
  const { status, body } = await invoke({
    prompt: 'Say something.', model: 'qwen2.5:7b', temperature: 0.2, max_tokens: 500,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.result, 'plain text answer');
  assert.equal(body.meta.model, 'qwen2.5:7b', 'the model chosen in AI setup is the one that runs');
  assert.equal(body.meta.thinking, false);
  assert.equal(body.meta.reasoning_chars, 0);
  const sent = lastChatFor('qwen2.5:7b').body;
  assert.equal(sent.format, undefined);
  assert.equal('think' in sent, false, 'a plain model never receives the control');
  assert.equal(sent.options.temperature, 0.2, "Atlas's own temperature is untouched without reasoning");
  assert.equal(sent.options.top_p, undefined);
  assert.equal(sent.options.num_predict, 500, 'the cap the caller asked for, with no trace to reserve for');
  assert.equal(sent.options.num_ctx, 32768, 'OLLAMA_NUM_CTX is honoured');
});

await test('chat: qwen3:8b is asked to think, and the trace never reaches the answer', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b' });
  const { status, body } = await invoke({ prompt: 'Review this draft.' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(
    body.result,
    'The draft works because the opening is specific.',
    'the answer is assembled from the stream, with no reasoning in it',
  );
  assert.doesNotMatch(String(body.result), /weigh the evidence/);
  assert.equal(body.meta.thinking, true);
  assert.ok(body.meta.reasoning_chars > 40, `expected a real trace, got ${body.meta.reasoning_chars}`);
  assert.equal(body.meta.recovered_from_thinking, undefined);

  const sent = lastChatFor('qwen3:8b').body;
  assert.equal(sent.think, true, 'reasoning is asked for explicitly');
  assert.equal(sent.stream, true);
});

await test('chat: reasoning gets the model\'s own sampling, and a cold scoring temperature is raised to it', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b' });
  const { status, body } = await invoke({ prompt: 'Score it.', temperature: 0.15 });
  assert.equal(status, 200, JSON.stringify(body));
  const sent = lastChatFor('qwen3:8b').body;
  assert.equal(sent.options.temperature, 0.6, 'Qwen3 degrades and repeats below its thinking-mode floor');
  assert.equal(sent.options.top_p, 0.95);
  assert.equal(sent.options.top_k, 20);
  assert.equal(body.meta.sampling.raised_from, 0.15, 'the change is reported, never silent');
  assert.equal(body.meta.sampling.temperature, 0.6);
});

await test('chat: a caller cap is topped up by the reasoning budget, so the answer still fits', async () => {
  seen.length = 0;
  setEnv({
    LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b', OLLAMA_THINK_BUDGET: '4096',
  });
  await invoke({ prompt: 'Review it.', max_tokens: 1000 });
  const sent = lastChatFor('qwen3:8b').body;
  assert.equal(sent.options.num_predict, 5096, 'answer cap + trace headroom');
});

await test('chat: OLLAMA_THINK=off asks for no reasoning and changes nothing else', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b', OLLAMA_THINK: 'off' });
  const { body } = await invoke({ prompt: 'Review it.', temperature: 0.15, max_tokens: 800 });
  const sent = lastChatFor('qwen3:8b').body;
  assert.equal(sent.think, false);
  assert.equal(sent.options.temperature, 0.15, 'no reasoning, so no sampling floor');
  assert.equal(sent.options.top_p, undefined);
  assert.equal(sent.options.num_predict, 800, 'no trace to reserve for');
  assert.equal(body.meta.thinking, false);
});

await test('chat: OLLAMA_THINK=auto leaves the choice to the model', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b', OLLAMA_THINK: 'auto' });
  await invoke({ prompt: 'Review it.' });
  const sent = lastChatFor('qwen3:8b').body;
  assert.equal('think' in sent, false, 'no control is sent, so the model default stands');
});

await test('chat: a JSON answer written inside the reasoning trace is recovered, not reported empty', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'json-in-thinking' });
  const { status, body } = await invoke({ prompt: 'Score it.', response_json_schema: SCHEMA });
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.result, { ok: true, n: 7 });
  assert.equal(body.meta.recovered_from_thinking, true);
  assert.match(body.meta.warning, /recovered it from there/);
});

await test('chat: reasoning tags leaked into the answer are stripped, and counted as reasoning', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'leaked-think' });
  const { status, body } = await invoke({ prompt: 'Say something.' });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.result, 'A clean answer.');
  assert.ok(body.meta.reasoning_chars > 0);
});

await test('chat: reasoning with no answer is its own error, and says how to fix it', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'thinking-only' });
  const { status, body } = await invoke({ prompt: 'Review it.', response_json_schema: SCHEMA });
  assert.equal(status, 502);
  assert.match(body.error, /wrote only its reasoning/);
  assert.match(body.error, /OLLAMA_NUM_CTX/);
  assert.match(body.error, /OLLAMA_THINK=off/);
  assert.ok(body.reasoning_chars > 0);
  assert.doesNotMatch(body.error, /empty response/, 'an unfinished thought is not an empty response');
});

await test('chat: a cut-off answer (done_reason length) is reported as finish_reason length', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Long one.', model: 'short-len' });
  assert.equal(status, 200);
  assert.equal(body.meta.finish_reason, 'length');
  assert.match(body.meta.warning, /output cap/);
});

await test('chat: a context window bigger than the model\'s own is reported on the answer too', async () => {
  setEnv({
    LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'qwen3:8b', OLLAMA_NUM_CTX: '65536',
  });
  const { body } = await invoke({ prompt: 'Review it.' });
  assert.match(body.meta.warning, /40960-token context/);
  assert.match(body.meta.warning, /OLLAMA_NUM_CTX=40960/);
});

await test('chat: an empty answer is an explicit error, never a blank success', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Empty.', model: 'empty-model' });
  assert.equal(status, 502);
  assert.match(body.error, /empty response/);
});

await test('transport: the Atlas deadline is the only one, and it is reported in minutes', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const started = Date.now();
  await assert.rejects(
    ollamaChat(mockBase, { model: 'slow-model', messages: [], stream: true }, { timeoutMs: 300 }),
    (error) => error.timedOut === true,
    'a run that outlasts the deadline is stopped by Atlas, not by a transport timeout',
  );
  assert.ok(Date.now() - started < 3000, 'the deadline fired, it did not wait for the model');
});

// --- failures a local user can actually hit ----------------------------------
await test('chat: Ollama not running -> 503 that says how to start it', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: deadBase });
  const { status, body } = await invoke({ prompt: 'Hello.' });
  assert.equal(status, 503);
  assert.equal(body.provider, 'ollama');
  assert.ok(body.error.startsWith(`Could not reach Ollama at ${deadBase} (connection refused`), body.error);
  assert.match(body.error, /ollama serve/);
  assert.doesNotMatch(body.error, /NaraRouter|NARAROUTER/, 'the message must not name another provider');
});

await test('chat: model not pulled -> 404 with the exact pull command, and NO silent swap to another model', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Hello.', model: 'missing-model' });
  assert.equal(status, 404);
  assert.match(body.error, /ollama pull missing-model/);
  const attempts = seen.filter((r) => r.url === '/api/chat');
  assert.equal(attempts.length, 1, 'exactly one attempt: a missing model is reported, not replaced');
  assert.equal(attempts[0].body.model, 'missing-model');
});

await test('chat: prompt larger than the context window -> explains OLLAMA_NUM_CTX, does not cut', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Huge.', model: 'ctx-model' });
  assert.equal(status, 400);
  assert.match(body.error, /larger than Ollama's context window/);
  assert.match(body.error, /OLLAMA_NUM_CTX/);
});

await test('chat: out-of-memory is turned into a fix, and still shows what Ollama said', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Hello.', model: 'oom-model' });
  assert.equal(status, 500);
  assert.match(body.error, /ran out of memory/);
  assert.match(body.error, /OLLAMA_NUM_CTX/);
  assert.match(body.error, /model requires more system memory/, "Ollama's own words are never dropped");
});

await test('chat: the KV-cache failure names the context window first, not the prompt', async () => {
  setEnv({
    LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_MODEL: 'kv-oom', OLLAMA_NUM_CTX: '32768',
  });
  const { status, body } = await invoke({ prompt: 'Hello.' });
  assert.equal(status, 500);
  assert.match(body.error, /reserves the KV cache up front for all 32768 tokens/);
  assert.match(body.error, /OLLAMA_NUM_CTX/);
  assert.match(body.error, /OLLAMA_FLASH_ATTENTION=1/);
  assert.match(body.error, /OLLAMA_KV_CACHE_TYPE=q8_0/);
  assert.match(body.error, /ollama stop kv-oom/);
  assert.match(body.error, /OLLAMA_KEEP_ALIVE=0/);
  assert.match(body.error, /OLLAMA_NUM_GPU/);
  assert.match(body.error, /failed to allocate buffer for kv cache/, "the real error is still there to read");
  assert.doesNotMatch(body.error, /larger than Ollama's context window/, 'this is not a prompt-too-large error');
});

await test('chat: OLLAMA_NUM_GPU is only sent when it is set, so Ollama keeps choosing by default', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  await invoke({ prompt: 'Hello.' });
  assert.equal(lastChatFor('llama3.2').body.options.num_gpu, undefined);

  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_NUM_GPU: '0' });
  await invoke({ prompt: 'Hello.' });
  assert.equal(lastChatFor('llama3.2').body.options.num_gpu, 0, 'CPU only, when the GPU cannot hold the model');
});

await test('chat: a model that refuses `think` is retried once without it, and still answers', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Hello.', model: NO_THINK_SUPPORT });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.meta.provider, 'ollama');
  const attempts = seen.filter((r) => r.url === '/api/chat' && r.body.model === NO_THINK_SUPPORT);
  assert.equal(attempts.length, 2, 'one attempt with the control, one without');
  assert.equal(attempts[0].body.think, true);
  assert.equal('think' in attempts[1].body, false);
  assert.equal(body.meta.thinking, false);
});

// --- provider selection ------------------------------------------------------
await test('selection: an explicit LLM_PROVIDER=ollama beats a NaraRouter key on the same machine', async () => {
  seen.length = 0;
  setEnv({
    LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase,
    NARAROUTER_API_KEY: 'sk-nry-test', NARAROUTER_BASE_URL: `${mockBase}/v1`,
  });
  const { body } = await invoke({ prompt: 'Hello.', response_json_schema: SCHEMA });
  assert.equal(body.meta.provider, 'ollama');
  assert.ok(seen.some((r) => r.url === '/api/chat'));
  assert.ok(!seen.some((r) => r.url === '/v1/chat/completions'), 'NaraRouter was not called');
});

await test('selection: NaraRouter remains the default when a key is set and Ollama is not selected', async () => {
  seen.length = 0;
  setEnv({ NARAROUTER_API_KEY: 'sk-nry-test', NARAROUTER_BASE_URL: `${mockBase}/v1`, OLLAMA_BASE_URL: mockBase });
  const status = await getJson(handleStatus);
  assert.equal(status.body.provider, 'nararouter');
  assert.equal(status.body.configured, true);
  const { body } = await invoke({ prompt: 'Hello.', response_json_schema: SCHEMA });
  assert.equal(body.meta.provider, 'nararouter');
  assert.deepEqual(body.result, { ok: true, n: 1 });
  assert.ok(!seen.some((r) => r.url === '/api/chat'), 'Ollama was not called when NaraRouter is the provider');
  assert.equal(body.meta.thinking, undefined, 'the reasoning fields belong to the local provider only');
});

await test('selection: nothing configured -> a clear 503 that names both ways to fix it', async () => {
  setEnv({});
  const { status, body } = await invoke({ prompt: 'Hello.' });
  assert.equal(status, 503);
  assert.match(body.error, /NARAROUTER_API_KEY/);
  assert.match(body.error, /LLM_PROVIDER=ollama/);
});

await test('selection: an unknown LLM_PROVIDER is rejected with the full list of valid names', async () => {
  setEnv({ LLM_PROVIDER: 'llamacpp', NARAROUTER_API_KEY: 'x' });
  const { status, body } = await invoke({ prompt: 'Hello.' });
  assert.equal(status, 503);
  assert.match(body.error, /Use nararouter \| ollama/);
});

// --- report ------------------------------------------------------------------
server.close();
let failed = 0;
for (const r of results) {
  if (!r.ok) {
    failed += 1;
    console.error(`FAIL ${r.name}\n  ${r.error?.message || r.error}`);
  }
}
if (failed) {
  console.error(`verify-ollama: ${failed} of ${results.length} checks failed`);
  process.exit(1);
}
console.log(`verify-ollama: ok (${results.length} checks)`);

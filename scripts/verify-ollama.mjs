// Verification for the local Ollama provider (LLM_PROVIDER=ollama).
//
// Runs the REAL server handlers (api/invoke-llm.js, api/status.js,
// api/models.js) against a small mock of Ollama's HTTP API and a mock of the
// NaraRouter OpenAI-compatible endpoint, so no real model and no network are
// needed. It checks:
//
//   1. the request sent to Ollama (native /api/chat, no key, no silent
//      truncation, explicit context window, JSON mode only when a schema is asked);
//   2. the answers: parsed JSON, plain text, cut-off answers, empty answers;
//   3. every failure a local user can actually hit, each with a message that
//      says what to do (not running, model not pulled, prompt too large, OOM);
//   4. that a missing model is never swapped for another model;
//   5. the status pill and the model picker tell the truth about Ollama;
//   6. that NaraRouter is still the default and still works unchanged.
//
// Run with: node --import ./scripts/register-ext.mjs scripts/verify-ollama.mjs

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { ollamaConfig, describeOllamaNetworkError } from '../api/ollamaConfig.js';

// ---------------------------------------------------------------------------
// Mock Ollama + mock NaraRouter
// ---------------------------------------------------------------------------
const seen = [];

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
          { name: 'qwen2.5:7b', model: 'qwen2.5:7b' },
          { name: 'llama3.2:latest', model: 'llama3.2:latest' },
        ],
      });
    }

    if (req.method === 'POST' && req.url === '/api/chat') {
      const base = { model: body.model, created_at: '2026-10-13T00:00:00Z', done: true, prompt_eval_count: 40, eval_count: 9 };
      switch (body.model) {
        case 'llama3.2':
          return send(200, { ...base, message: { role: 'assistant', content: '{"ok": true, "n": 3}' }, done_reason: 'stop' });
        case 'qwen2.5:7b':
          return send(200, { ...base, message: { role: 'assistant', content: 'plain text answer' }, done_reason: 'stop' });
        case 'short-len':
          return send(200, { ...base, message: { role: 'assistant', content: 'partial answ' }, done_reason: 'length' });
        case 'empty-model':
          return send(200, { ...base, message: { role: 'assistant', content: '' }, done_reason: 'stop' });
        case 'missing-model':
          return send(404, { error: `model "${body.model}" not found, try pulling it first` });
        case 'ctx-model':
          return send(400, { error: 'input length exceeds maximum context length' });
        case 'oom-model':
          return send(500, { error: 'model requires more system memory (12.0 GiB) than is available' });
        default:
          return send(404, { error: `model "${body.model}" not found, try pulling it first` });
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

await test('network errors: connection refused is named in plain words', async () => {
  try {
    await fetch(`${deadBase}/api/tags`);
    assert.fail('expected the closed port to refuse');
  } catch (error) {
    assert.match(describeOllamaNetworkError(error), /connection refused/);
  }
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
  assert.deepEqual(body.models, ['llama3.2:latest', 'qwen2.5:7b']);
  assert.equal(body.default_model, 'llama3.2');
});

await test('models: an unreachable Ollama says so instead of an empty success', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: deadBase });
  const { body } = await getJson(handleModels);
  assert.equal(body.ok, false);
  assert.deepEqual(body.models, []);
  assert.match(body.message, /not reachable/);
});

// --- generation: the request that goes to Ollama -----------------------------
await test('chat: JSON schema -> native /api/chat, format json, no key, never truncated, parsed object back', async () => {
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
  assert.equal(sent.stream, false);
  assert.equal(sent.truncate, false, 'a prompt larger than the window must be refused, not cut silently');
  assert.equal(sent.format, 'json');
  assert.equal(sent.options.num_ctx, 16384);
  assert.match(sent.messages[0].content, /Respond with ONLY one valid JSON object/);
  const chatCall = seen.find((r) => r.url === '/api/chat');
  assert.equal(chatCall.headers.authorization, undefined, 'no API key is ever sent to Ollama');
});

await test('chat: plain text -> string answer, no JSON format, temperature and max tokens passed through', async () => {
  seen.length = 0;
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase, OLLAMA_NUM_CTX: '32768' });
  const { status, body } = await invoke({
    prompt: 'Say something.', model: 'qwen2.5:7b', temperature: 0.2, max_tokens: 500,
  });
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.result, 'plain text answer');
  assert.equal(body.meta.model, 'qwen2.5:7b', 'the model chosen in AI setup is the one that runs');
  const sent = lastChatFor('qwen2.5:7b').body;
  assert.equal(sent.format, undefined);
  assert.equal(sent.options.temperature, 0.2);
  assert.equal(sent.options.num_predict, 500);
  assert.equal(sent.options.num_ctx, 32768, 'OLLAMA_NUM_CTX is honoured');
});

await test('chat: a cut-off answer (done_reason length) is reported as finish_reason length', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Long one.', model: 'short-len' });
  assert.equal(status, 200);
  assert.equal(body.meta.finish_reason, 'length');
  assert.match(body.meta.warning, /output cap/);
});

await test('chat: an empty answer is an explicit error, never a blank success', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Empty.', model: 'empty-model' });
  assert.equal(status, 502);
  assert.match(body.error, /empty response/);
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

await test('chat: out-of-memory from Ollama is shown verbatim with its HTTP code', async () => {
  setEnv({ LLM_PROVIDER: 'ollama', OLLAMA_BASE_URL: mockBase });
  const { status, body } = await invoke({ prompt: 'Hello.', model: 'oom-model' });
  assert.equal(status, 500);
  assert.match(body.error, /Ollama returned HTTP 500: model requires more system memory/);
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

// One call to Ollama's native `/api/chat`, streamed.
//
// Why this is not a plain `fetch`:
//   * Node's fetch is undici, and undici aborts a request whose response
//     headers take more than 300 seconds to arrive (`UND_ERR_HEADERS_TIMEOUT`).
//     A deep reasoning run on a laptop CPU can take much longer than that, so a
//     `stream: false` request dies at the five-minute mark no matter what the
//     app is willing to wait for. Streaming fixes the cause, not the symptom:
//     the answer arrives in pieces, so nothing has to wait for the whole
//     generation, and the between-chunk timer restarts on every token.
//   * It also lets Atlas read the reasoning trace (`message.thinking`) as it is
//     produced, instead of only at the end.
//
// The transport is `node:http` so the only deadline in force is the one Atlas
// sets (`OLLAMA_TIMEOUT_MS`); no hidden socket timeout can cut a run short.
//
// This module never decides what an error means — it reports what Ollama said
// and `api/invoke-llm.js` turns that into a message an applicant can act on.

import http from 'node:http';
import https from 'node:https';

export const OLLAMA_CHAT_PATH = '/api/chat';

/** How much of an unparseable body to keep, for an honest error message. */
const RAW_PREVIEW_CHARS = 2000;

/**
 * @typedef {object} OllamaChatResult
 * @property {number} status HTTP status Ollama answered with.
 * @property {string} content the final answer, concatenated over the stream.
 * @property {string} thinking the reasoning trace, concatenated over the stream.
 * @property {string} finishReason `stop`, `length`, …
 * @property {number|undefined} promptEvalCount prompt tokens Ollama counted.
 * @property {number|undefined} evalCount answer tokens Ollama counted.
 * @property {string} model the model Ollama says answered.
 * @property {number} chunks stream chunks parsed.
 * @property {string} error Ollama's own error text, if it sent one.
 * @property {string} rawPreview the first characters of the body, for bodies that were not JSON.
 */

/**
 * POST one chat request and resolve with everything the stream carried.
 *
 * Rejects only for transport failures (Ollama not running, connection reset,
 * the Atlas deadline). An HTTP 404 for a model that was never pulled resolves
 * with `status: 404` and Ollama's message in `error`.
 *
 * @param {string} baseUrl for example http://127.0.0.1:11434
 * @param {object} payload the /api/chat body
 * @param {{ timeoutMs?: number }} [options] wall-clock ceiling; 0 means none
 * @returns {Promise<OllamaChatResult>}
 */
export function ollamaChat(baseUrl, payload, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(OLLAMA_CHAT_PATH, baseUrl);
    } catch (error) {
      reject(error);
      return;
    }

    const transport = url.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    let timer = null;

    const finish = (result) => {
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const fail = (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    };

    const request = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length,
          Accept: 'application/x-ndjson',
        },
        // 0 = no socket timeout. The Atlas deadline below is the only one.
        timeout: 0,
      },
      (response) => {
        /** @type {OllamaChatResult} */
        const out = {
          status: response.statusCode || 0,
          content: '',
          thinking: '',
          finishReason: '',
          promptEvalCount: undefined,
          evalCount: undefined,
          model: '',
          chunks: 0,
          error: '',
          rawPreview: '',
        };
        let pending = '';
        let raw = '';

        // Ollama streams newline-delimited JSON. A non-JSON line is ignored:
        // a proxy in front of Ollama should not turn an answer into a crash.
        const absorb = (line) => {
          const text = String(line).trim();
          if (!text) return;
          let chunk;
          try {
            chunk = JSON.parse(text);
          } catch {
            return;
          }
          if (!chunk || typeof chunk !== 'object') return;
          out.chunks += 1;
          if (chunk.error) out.error = String(chunk.error);
          const message = chunk.message;
          if (message && typeof message === 'object') {
            if (typeof message.content === 'string') out.content += message.content;
            if (typeof message.thinking === 'string') out.thinking += message.thinking;
          }
          if (chunk.done_reason) out.finishReason = String(chunk.done_reason);
          if (Number.isFinite(chunk.prompt_eval_count)) out.promptEvalCount = chunk.prompt_eval_count;
          if (Number.isFinite(chunk.eval_count)) out.evalCount = chunk.eval_count;
          if (chunk.model) out.model = String(chunk.model);
        };

        response.setEncoding('utf8');
        response.on('data', (piece) => {
          if (raw.length < RAW_PREVIEW_CHARS) raw += String(piece).slice(0, RAW_PREVIEW_CHARS - raw.length);
          pending += piece;
          let newline = pending.indexOf('\n');
          while (newline >= 0) {
            absorb(pending.slice(0, newline));
            pending = pending.slice(newline + 1);
            newline = pending.indexOf('\n');
          }
        });
        response.on('end', () => {
          absorb(pending);
          out.rawPreview = raw;
          finish(out);
        });
        response.on('error', fail);
      },
    );

    request.on('error', fail);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        const error = new Error(`Ollama did not answer within ${timeoutMs} ms`);
        error.timedOut = true;
        error.code = 'ATLAS_OLLAMA_TIMEOUT';
        request.destroy(error);
      }, timeoutMs);
      // Never keep the process alive just for this timer.
      timer.unref?.();
    }
    request.end(data);
  });
}

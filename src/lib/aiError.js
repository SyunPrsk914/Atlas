// A small typed factory for the errors this app throws.
//
// The codebase attaches diagnostic fields (`code`, `status`, `raw_preview`,
// `pgCode`) to Error instances so callers can react to a failure instead of
// matching on message text. Building them through one helper keeps that shape
// declared in a single place rather than re-deriving it at every throw site.

/**
 * @typedef {{
 *   code?: string,
 *   status?: number,
 *   raw_preview?: string,
 *   pgCode?: string,
 *   cause?: unknown,
 * }} ErrorDetails
 */

/**
 * Create an Error carrying diagnostic fields.
 * @param {string} message
 * @param {ErrorDetails} [details]
 * @returns {Error & ErrorDetails}
 */
export function makeError(message, details = {}) {
  return Object.assign(new Error(message), details);
}

/**
 * Narrow an unknown catch binding to an Error with diagnostic fields.
 * @param {unknown} err
 * @returns {Error & ErrorDetails}
 */
export function asError(err) {
  if (err instanceof Error) return /** @type {Error & ErrorDetails} */ (err);
  return makeError(typeof err === 'string' ? err : 'Unknown error', { cause: err });
}

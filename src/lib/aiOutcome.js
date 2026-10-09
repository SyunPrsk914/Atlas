// Demo-mode guard. Demo output is labelled placeholder text: it must never be
// saved, cached, or written into the applicant's essay, analysis, or knowledge
// base. Kept free of app-only imports so it can be tested in Node.

import { getAIMode } from '../api/ollamaClient';

/** True when a real model answers: a local Ollama model, or a hosted provider the user selected. */
export function hasLiveModel() {
  return getAIMode() !== 'demo';
}

/**
 * True only for a real answer from a model. Demo output is labelled placeholder
 * text, and it must never be saved, cached, or written into the applicant's
 * essay, analysis, or knowledge base.
 */
export function isLiveOutcome(outcome) {
  return !!outcome
    && outcome.ok === true
    && outcome.result !== undefined
    && outcome.result !== null
    && outcome.meta?.demo !== true
    && outcome.meta?.provider !== 'demo';
}

// Background work for materials: read the uploaded file or the linked page,
// then analyse the whole text. Jobs run one at a time, in the order they were
// added, so a local model is never asked to do two long analyses at once.
//
// The job manager takes its side effects as parameters (read, analyse, save,
// load, notify). The app passes the real ones (see materialService.js); tests
// pass fakes. Only `content` (the read text) and `analysis` are ever written
// here, so an edit to notes, title, or type is never overwritten by a job.

import {
  ANALYSIS_VERSION,
  analysisMatchesSource,
  decodeDocumentText,
  encodeDocumentText,
  legacyTypedText,
  materialDisplayName,
  materialSource,
  materialSourceKind,
  mergeLegacyIntoNotes,
  sourceKey,
} from './materialDocument';

/** Failures that will not change by themselves, so they are not retried on every visit. */
export const NO_AUTO_RETRY_CODES = new Set([
  'document_unsupported',
  'document_no_text',
  'document_login_required',
  'document_too_large',
  'document_unreadable',
]);

/**
 * Whether a presented material (see presentMaterial) still needs reading or
 * analysis. Used when the Materials page opens.
 */
export function needsWork(presented, { modelReady = false } = {}) {
  if (!presented || presented.document_state === 'none') return false;
  const failure = presented.analysis?.status === 'failed' ? presented.analysis : null;
  if (failure && NO_AUTO_RETRY_CODES.has(failure.code)) return false;
  if (presented.document_state !== 'ready') return true;
  if (!presented.analysis) return !!modelReady;
  return !!failure && !!modelReady;
}

/**
 * @param {object} deps
 * @param {(file: File) => Promise<{ text: string, reader: string }>} deps.readFile
 * @param {(url: string) => Promise<{ text: string, reader: string }>} deps.readUrl
 * @param {(url: string, name: string) => Promise<{ text: string, reader: string }>} deps.readStored re-reads an uploaded file that is already stored
 * @param {(args: { title: string, kind: string, text: string, contextNotes: string, onProgress: (progress: { part: number, parts: number }) => void }) => Promise<object>} deps.analyze
 * @param {() => boolean} deps.hasModel true only when a real model is connected
 * @param {(id: string, patch: object) => Promise<object | null>} deps.save
 * @param {(id: string) => Promise<object | null>} deps.load the current row
 * @param {(error: unknown, title: string) => void} [deps.reportError]
 * @param {() => string} [deps.now]
 */
export function createMaterialJobs({ readFile, readUrl, readStored, analyze, hasModel, save, load, reportError, now = () => new Date().toISOString() }) {
  const statuses = new Map();
  const pending = new Map();
  const listeners = new Set();
  let chain = Promise.resolve();

  function publish(id, status) {
    if (status) statuses.set(id, { ...status, updatedAt: Date.now() });
    else statuses.delete(id);
    const next = statuses.get(id) || null;
    for (const listener of listeners) listener(id, next);
  }

  /** Records a failure for this source, unless a ready analysis for the same source already exists. */
  async function recordFailure(row, { stage, error, key, kind, name, reader = null, chars = 0, notify = false, legacyMoved = false }) {
    const message = String(error?.message || error || 'Unknown error');
    if (notify && reportError) reportError(error, row.title || name || 'material');
    const current = row.analysis;
    const keepReady = analysisMatchesSource(current, key) && current.status === 'ready';
    if (!keepReady) {
      try {
        await save(row.id, {
          analysis: {
            version: ANALYSIS_VERSION,
            status: 'failed',
            stage,
            code: error?.code || '',
            message,
            failed_at: now(),
            source: { key, kind, name, reader: reader || null, chars: chars || 0 },
          },
        });
      } catch { /* the status below still tells the user what happened */ }
    }
    publish(row.id, { state: 'failed', stage, message });
    return { ...row, legacyMoved: !!legacyMoved };
  }

  async function run(snapshot, { file, force, notify }) {
    const id = snapshot.id;
    // Start from the newest row: the source or the notes may have changed while this job waited.
    const latest = await current(id, snapshot);
    if (!latest) {
      publish(id, null);
      return null;
    }
    const source = materialSource(latest);
    if (!source) {
      publish(id, null);
      return latest;
    }
    const key = sourceKey(source);
    const kind = materialSourceKind(latest);
    const name = materialDisplayName(latest);

    // 0. Old free text in the Content box is moved to the notes before any new
    //    document text is written there, so it cannot be overwritten.
    let legacyMoved = false;
    let working = latest;
    const legacy = legacyTypedText(latest);
    if (legacy) {
      const notes = mergeLegacyIntoNotes(latest.notes, legacy);
      try {
        await save(id, { notes, content: null });
        working = { ...latest, notes, content: null };
        legacyMoved = true;
      } catch (error) {
        publish(id, { state: 'failed', stage: 'saving', message: String(error?.message || error) });
        if (notify && reportError) reportError(error, latest.title || name);
        return latest;
      }
    }

    // 1. Read the document, unless the stored text already comes from this source.
    const stored = decodeDocumentText(working.content);
    let text;
    let reader;
    if (stored && stored.key === key && !file && !force) {
      text = stored.text;
      reader = stored.reader;
    } else {
      publish(id, { state: 'reading', kind });
      try {
        let result;
        if (file) result = await readFile(file);
        else if (kind === 'file') result = await readStored(source, name);
        else result = await readUrl(source);
        text = result.text;
        reader = result.reader;
      } catch (error) {
        return recordFailure(working, { stage: 'reading', error, key, kind, name, notify, legacyMoved });
      }
      try {
        await save(id, { content: encodeDocumentText({ source, reader, text }) });
      } catch (error) {
        publish(id, { state: 'failed', stage: 'saving', message: String(error?.message || error) });
        if (notify && reportError) reportError(error, working.title || name);
        return working;
      }
    }

    // 2. Re-check the row: the source may have been replaced while the document was read.
    const fresh = await current(id, null);
    if (!fresh) {
      publish(id, null);
      return null;
    }
    if (sourceKey(materialSource(fresh)) !== key) {
      // A newer job for the new source is already queued.
      publish(id, { state: 'queued' });
      return fresh;
    }
    working = { ...working, ...fresh };

    if (!force && working.analysis?.status === 'ready' && analysisMatchesSource(working.analysis, key)) {
      publish(id, { state: 'done' });
      return { ...working, legacyMoved };
    }

    // 3. Analyse the whole text when a real model is connected.
    if (!hasModel()) {
      publish(id, { state: 'waiting' });
      return { ...working, legacyMoved };
    }
    publish(id, { state: 'analyzing', part: 0, parts: 0 });
    try {
      const merged = await analyze({
        title: working.title || '',
        kind: working.type || 'essay',
        text,
        contextNotes: working.notes || '',
        onProgress: ({ part, parts }) => publish(id, { state: 'analyzing', part, parts }),
      });
      const record = {
        ...merged,
        version: ANALYSIS_VERSION,
        status: 'ready',
        source: { key, kind, name, reader, chars: text.length },
        analyzed_at: now(),
      };
      const saved = await save(id, { analysis: record });
      const persisted = !!(saved && saved.analysis);
      publish(id, { state: 'done', persisted });
      if (!persisted && notify && reportError) {
        reportError(new Error('The analysis is shown, but could not be saved. Run supabase/schema.sql once, then analyze again.'), working.title || name);
      }
      return { ...working, analysis: record, legacyMoved };
    } catch (error) {
      return recordFailure(working, { stage: 'analysis', error, key, kind, name, reader, chars: text.length, notify, legacyMoved });
    }
  }

  /** The newest stored row, or the fallback when it cannot be loaded. */
  async function current(id, fallback) {
    try {
      return (await load(id)) || null;
    } catch {
      return fallback;
    }
  }

  /**
   * Adds a job. Jobs for the same material are merged while one is still
   * waiting, unless a file or a forced re-read is given.
   * @param {object} row a raw database row (with id)
   * @param {{ file?: File | null, force?: boolean, notify?: boolean }} [options]
   * @returns {Promise<object>} the row after the job
   */
  function enqueue(row, { file = null, force = false, notify = false } = {}) {
    if (!row || !row.id) return Promise.resolve(row);
    if (!file && !force && pending.has(row.id)) return pending.get(row.id);
    publish(row.id, { state: 'queued' });
    const job = chain
      .then(() => run(row, { file, force, notify }))
      .catch((error) => recordFailure(row, { stage: 'job', error, key: sourceKey(materialSource(row)), kind: materialSourceKind(row), name: materialDisplayName(row), notify }));
    chain = job.then(() => undefined, () => undefined);
    pending.set(row.id, job);
    job.finally(() => {
      if (pending.get(row.id) === job) pending.delete(row.id);
    });
    return job;
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  return {
    enqueue,
    subscribe,
    getStatus: (id) => statuses.get(id) || null,
    isBusy: (id) => pending.has(id),
  };
}

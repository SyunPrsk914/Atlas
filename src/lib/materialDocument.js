// Where a material's document text lives, and how Atlas recognises it.
//
// `materials.content` holds the text Atlas read from the uploaded file or from
// the linked page. The applicant never types into it. Every value the reader
// writes starts with a short header that names the source it was read from, so
// a file that is replaced is detected and read again.
//
// Text in `content` WITHOUT that header is the old free-text box. It is moved
// into the Context / Notes field, so nothing is lost and the AI never treats
// it as the document itself.

export const ANALYSIS_VERSION = 2;

const DOCUMENT_HEADER = /^\[\[atlas-doc:v1 key=([0-9a-f]{8}) reader=([a-z0-9-]+) chars=(\d+)\]\]\n?/;

export const LEGACY_NOTE_HEADING = 'Text that was pasted into the old Content box (moved here, not analysed as the document):';

/** FNV-1a (32-bit) of the source string. Short and stable; it only has to notice a changed file or link. */
export function sourceKey(source) {
  const text = String(source || '');
  if (!text) return '';
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** The uploaded file if there is one, otherwise the website link. */
export function materialSource(row) {
  return String(row?.file_url || row?.link_url || '').trim();
}

export function materialSourceKind(row) {
  if (row?.file_url) return 'file';
  if (row?.link_url) return 'link';
  return '';
}

/** A readable name for the source: the original file name, or the link itself. */
export function materialDisplayName(row) {
  const fileUrl = String(row?.file_url || '');
  if (fileUrl) {
    if (fileUrl.startsWith('data:')) return 'uploaded file';
    let last = fileUrl.split('?')[0].split('/').pop() || '';
    try {
      last = decodeURIComponent(last);
    } catch { /* keep the raw segment */ }
    // Uploads are stored as "<timestamp>-<name>"; show only the name.
    return last.replace(/^\d{10,}-/, '') || 'uploaded file';
  }
  return String(row?.link_url || '').trim();
}

export function encodeDocumentText({ source, reader, text }) {
  const body = String(text || '');
  return `[[atlas-doc:v1 key=${sourceKey(source)} reader=${reader || 'unknown'} chars=${body.length}]]\n${body}`;
}

/** @returns {null | { key: string, reader: string, chars: number, text: string }} */
export function decodeDocumentText(content) {
  const raw = String(content || '');
  const match = raw.match(DOCUMENT_HEADER);
  if (!match) return null;
  return {
    key: match[1],
    reader: match[2],
    chars: Number(match[3]),
    text: raw.slice(match[0].length),
  };
}

/** Free text left in the old Content box: present, and without a document header. */
export function legacyTypedText(row) {
  const raw = String(row?.content || '');
  if (!raw.trim() || decodeDocumentText(raw)) return '';
  return raw.trim();
}

/**
 * Appends old Content text to the Context notes. Idempotent: text that is
 * already in the notes is not added twice.
 */
export function mergeLegacyIntoNotes(notes, legacyText) {
  const base = String(notes || '').trim();
  const legacy = String(legacyText || '').trim();
  if (!legacy) return base;
  if (base.includes(legacy)) return base;
  return base
    ? `${base}\n\n${LEGACY_NOTE_HEADING}\n${legacy}`
    : `${LEGACY_NOTE_HEADING}\n${legacy}`;
}

/** Whether a stored analysis was produced from the source the material has now. */
export function analysisMatchesSource(analysis, currentKey) {
  return !!analysis
    && analysis.version === ANALYSIS_VERSION
    && !!currentKey
    && analysis.source?.key === currentKey;
}

/**
 * The write that moves old free text into Context and drops analyses that were
 * made from it. Returns null when there is nothing to migrate.
 * The patch never touches a current (version 2) analysis.
 */
export function legacyMigrationPatch(row) {
  const legacy = legacyTypedText(row);
  const oldAnalysis = !!row?.analysis && row.analysis.version !== ANALYSIS_VERSION;
  if (!legacy && !oldAnalysis) return null;
  const patch = {};
  if (legacy) {
    // The raw notes are used on purpose: a legacy sample-essay tag must survive.
    patch.notes = mergeLegacyIntoNotes(row.notes, legacy);
    patch.content = null;
  }
  if (oldAnalysis) patch.analysis = null;
  return patch;
}

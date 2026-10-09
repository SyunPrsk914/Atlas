// Reads the text of an applicant's uploaded file or of a public web page, in
// the browser, so Materials can analyse the real document rather than a copy
// pasted into a box.
//
// Supported: PDF (text-based), Word .docx, plain text, Markdown, CSV, RTF, and
// saved or public HTML pages. Old Word .doc files and images are reported as
// unsupported, with the step that makes them readable. Links are fetched from
// the browser without cookies. Atlas never uses a proxy and never gets around
// a site's CORS rule or a login page; it asks for the file instead.

import { unzipSync, strFromU8 } from 'fflate';
import { makeError } from './aiError';
import { normalizePublicPageUrl } from './researchSource';

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Text beyond this is not stored. The stored text says so at its end. */
export const MAX_DOCUMENT_CHARS = 200000;
const MAX_PDF_PAGES = 200;
const MIN_READABLE_CHARS = 20;

// ---------------------------------------------------------------------------
// Kind detection
// ---------------------------------------------------------------------------
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tif', 'tiff'];
const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'text'];

/** @returns {'pdf'|'docx'|'doc'|'rtf'|'html'|'text'|'image'|'unknown'} */
export function fileKind(name = '', mime = '') {
  const ext = String(name).includes('.') ? String(name).split('.').pop().toLowerCase() : '';
  const type = String(mime || '').toLowerCase();
  if (type === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || type.includes('wordprocessingml')) return 'docx';
  if (ext === 'doc' || type === 'application/msword') return 'doc';
  if (ext === 'rtf' || type === 'application/rtf' || type === 'text/rtf') return 'rtf';
  if (['html', 'htm', 'xhtml'].includes(ext) || type === 'text/html' || type === 'application/xhtml+xml') return 'html';
  if (TEXT_EXTENSIONS.includes(ext) || type.startsWith('text/')) return 'text';
  if (IMAGE_EXTENSIONS.includes(ext) || type.startsWith('image/')) return 'image';
  return 'unknown';
}

function kindFromContentType(contentType) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('application/pdf')) return 'pdf';
  if (type.includes('wordprocessingml')) return 'docx';
  if (type.includes('application/msword')) return 'doc';
  if (type.includes('application/rtf') || type.includes('text/rtf')) return 'rtf';
  if (type.includes('text/html') || type.includes('application/xhtml')) return 'html';
  if (type.startsWith('text/')) return 'text';
  if (type.startsWith('image/')) return 'image';
  return '';
}

function sniffKind(bytes) {
  const head = bytes.subarray(0, 1024);
  const ascii = String.fromCharCode(...head.subarray(0, 8));
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (head[0] === 0x50 && head[1] === 0x4b) return 'docx';
  if (head.includes(0)) return 'unknown';
  const start = new TextDecoder('utf-8').decode(head).trimStart();
  if (start.startsWith('<')) return 'html';
  return 'text';
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------
export function normalizeText(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function capText(text) {
  if (text.length <= MAX_DOCUMENT_CHARS) return text;
  return `${text.slice(0, MAX_DOCUMENT_CHARS)}\n\n[Atlas stopped reading after ${MAX_DOCUMENT_CHARS.toLocaleString()} characters. The rest of this document is not included.]`;
}

function decodeBytes(bytes, contentType = '') {
  const match = /charset=["']?([\w-]+)/i.exec(contentType);
  try {
    return new TextDecoder(match ? match[1] : 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

const decodeXmlEntities = (value) => value
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  .replace(/&amp;/g, '&');

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------
/** Readable text of an HTML page: the main content when the page marks one, otherwise the body. */
export function htmlToText(html) {
  const source = String(html || '');
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    doc.querySelectorAll('script, style, noscript, svg, iframe, form, nav, footer, header, aside, [aria-hidden="true"]')
      .forEach((node) => node.remove());
    const main = Array.from(doc.querySelectorAll('main, article, [role="main"]'))
      .sort((a, b) => (b.textContent || '').length - (a.textContent || '').length)[0];
    const root = /** @type {HTMLElement | null} */ (main || doc.body || doc.documentElement);
    return normalizeText(root?.innerText || root?.textContent || '');
  }
  // Non-browser fallback (tests and tools). Good enough for plain pages.
  return normalizeText(source
    .replace(/<head\b[\s\S]*?<\/head>/gi, ' ')
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' '));
}

// ---------------------------------------------------------------------------
// Word (.docx): the text lives in word/document.xml inside the zip package.
// ---------------------------------------------------------------------------
const DOCX_TOKEN = /<w:p(?=[\s/>])[^>]*?(\/)?>|<\/w:p>|<w:tab(?=[\s/>])[^>]*\/>|<w:br(?=[\s/>])[^>]*\/>|<w:cr(?=[\s/>])[^>]*\/>|<w:t(?=[\s>])[^>]*>([^<]*)<\/w:t>|<\/w:tc>|<\/w:tr>/g;

/** Plain text of a Word document.xml part: paragraphs, tabs, and line breaks kept. */
export function docxXmlToText(xml) {
  let out = '';
  let match;
  DOCX_TOKEN.lastIndex = 0;
  while ((match = DOCX_TOKEN.exec(xml))) {
    const token = match[0];
    if (token === '</w:p>') out += '\n';
    else if (token.startsWith('<w:p')) { if (match[1]) out += '\n'; }
    else if (token.startsWith('<w:tab')) out += '\t';
    else if (token.startsWith('<w:br') || token.startsWith('<w:cr')) out += '\n';
    else if (token.startsWith('<w:t')) out += decodeXmlEntities(match[2] || '');
    else if (token === '</w:tc>') out += '\t';
    else if (token === '</w:tr>') out += '\n';
  }
  return normalizeText(out.replace(/\t+\n/g, '\n'));
}

export function extractDocxText(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (file) => file.name === 'word/document.xml' });
  } catch (error) {
    throw makeError('This Word file could not be opened. Save it again from Word, or export it as PDF.', { code: 'document_unreadable', cause: error });
  }
  const xml = files['word/document.xml'];
  if (!xml) {
    throw makeError('This file is not a Word document with readable text. Save it again as .docx, or export it as PDF.', { code: 'document_unreadable' });
  }
  return docxXmlToText(strFromU8(xml));
}

// ---------------------------------------------------------------------------
// RTF (basic): control words removed, paragraphs kept.
// ---------------------------------------------------------------------------
function rtfToText(rtf) {
  return normalizeText(String(rtf)
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\'[0-9a-f]{2}/gi, ' ')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/[{}]/g, ''));
}

// ---------------------------------------------------------------------------
// PDF (text-based). pdf.js is loaded only when a PDF is read. The legacy build
// is used because the main build needs newer JavaScript features than some
// browsers and Node 22 provide.
// ---------------------------------------------------------------------------
let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      if (!pdfjs.GlobalWorkerOptions.workerSrc && typeof window !== 'undefined') {
        const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      }
      return pdfjs;
    })().catch((error) => {
      pdfjsPromise = null;
      throw error;
    });
  }
  return pdfjsPromise;
}

/** Text of one PDF page, with line breaks where the vertical position changes. */
export function pageItemsToText(items) {
  let out = '';
  let lastY = null;
  let lastEnd = null;
  for (const item of items || []) {
    if (!item || typeof item.str !== 'string') continue;
    const transform = Array.isArray(item.transform) ? item.transform : [];
    const x = Number(transform[4]) || 0;
    const y = Number(transform[5]) || 0;
    if (out && lastY !== null && Math.abs(y - lastY) > 2) {
      if (!out.endsWith('\n')) out += '\n';
    } else if (out && lastEnd !== null && x - lastEnd > 1.5 && !/\s$/.test(out) && !/^\s/.test(item.str)) {
      out += ' ';
    }
    out += item.str;
    lastY = y;
    lastEnd = x + (Number(item.width) || 0);
    if (item.hasEOL) {
      out += '\n';
      lastY = null;
      lastEnd = null;
    }
  }
  return out.replace(/[ \t]+\n/g, '\n');
}

export async function extractPdfText(bytes) {
  const pdfjs = await loadPdfJs();
  // pdf.js releases the document through its loading task (task.destroy()).
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    if (error?.name === 'PasswordException') {
      throw makeError('This PDF is password-protected. Remove the password, export it again, and upload that copy.', { code: 'document_unreadable', cause: error });
    }
    throw makeError('This PDF could not be opened. It may be damaged. Export it again, or upload a .docx or .txt version.', { code: 'document_unreadable', cause: error });
  }
  try {
    const pageCount = doc.numPages;
    const readCount = Math.min(pageCount, MAX_PDF_PAGES);
    const pages = [];
    for (let number = 1; number <= readCount; number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      pages.push(pageItemsToText(content.items));
      page.cleanup();
    }
    let text = normalizeText(pages.join('\n\n'));
    if (text.length < MIN_READABLE_CHARS) {
      throw makeError('This PDF has no selectable text. It looks like a scan or a photo of a page. Export it again as a text-based PDF, or upload the .docx or .txt version.', { code: 'document_no_text' });
    }
    if (readCount < pageCount) {
      text = `${text}\n\n[Atlas stopped after ${readCount} of ${pageCount} pages. The rest of this document is not included.]`;
    }
    return text;
  } finally {
    await task.destroy().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
const UNSUPPORTED = {
  doc: 'Old Word files (.doc) cannot be read in the browser. Open the file in Word or Google Docs, save it as .docx or PDF, and upload that copy.',
  image: 'Atlas cannot read text from photos or scanned images yet. Export the document as a PDF with selectable text, or upload a .docx or .txt version.',
};

function unsupportedError(name = '') {
  const label = name ? ` (${name.split('/').pop().split('?')[0] || name})` : '';
  return makeError(`This file type is not supported${label}. Atlas reads PDF, Word (.docx), plain text, Markdown, CSV, RTF and saved web pages. Export the document in one of those formats.`, { code: 'document_unsupported' });
}

function finish(text, reader) {
  const cleaned = capText(normalizeText(text));
  if (cleaned.length < MIN_READABLE_CHARS) {
    throw makeError('No readable text was found in this file. Check that it is not empty, or upload a different version.', { code: 'document_no_text' });
  }
  return { text: cleaned, reader };
}

/**
 * Reads the text of already-loaded bytes.
 * @param {Uint8Array} bytes
 * @param {{ kind: string, name?: string, contentType?: string }} opts
 * @returns {Promise<{ text: string, reader: string }>}
 */
export async function readBytes(bytes, { kind, name = '', contentType = '' }) {
  if (UNSUPPORTED[kind]) throw makeError(UNSUPPORTED[kind], { code: 'document_unsupported' });
  switch (kind) {
    case 'pdf':
      return finish(await extractPdfText(bytes), 'pdf');
    case 'docx':
      return finish(extractDocxText(bytes), 'docx');
    case 'html':
      return finish(htmlToText(decodeBytes(bytes, contentType)), 'html');
    case 'rtf':
      return finish(rtfToText(decodeBytes(bytes)), 'rtf');
    case 'text':
      return finish(decodeBytes(bytes, contentType), 'text');
    default:
      throw unsupportedError(name);
  }
}

/** Reads an applicant's uploaded File object in the browser. */
export async function readFromFile(file) {
  if (!file) throw makeError('Choose a file first.', { code: 'document_missing' });
  if (file.size > MAX_UPLOAD_BYTES) {
    throw makeError(`This file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Atlas reads files up to 30 MB. Export a smaller copy, for example a PDF without large images.`, { code: 'document_too_large' });
  }
  const kind = fileKind(file.name, file.type);
  if (UNSUPPORTED[kind]) throw makeError(UNSUPPORTED[kind], { code: 'document_unsupported' });
  if (kind === 'unknown') throw unsupportedError(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  return readBytes(bytes, { kind, name: file.name });
}

function looksLikeLoginPage(finalUrl, html, text) {
  let path = '';
  try {
    path = new URL(finalUrl).pathname;
  } catch { /* keep empty */ }
  const title = (String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  return /\/(login|log-in|signin|sign-in|authenticate|auth)(\/|$)/i.test(path)
    || (/\b(sign in|log in|login required)\b/i.test(title) && text.length < 12000);
}

/**
 * Fetches a public web page or document from the browser and reads its text.
 * Fails with a plain reason; it does not proxy or get around a block.
 */
export async function readFromUrl(value) {
  const target = normalizePublicPageUrl(value);
  let response;
  try {
    response = await fetch(target, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      redirect: 'follow',
      headers: { Accept: 'application/pdf, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/html, text/plain;q=0.9, */*;q=0.1' },
    });
  } catch (error) {
    throw makeError(
      `Atlas could not read this link from the browser. The site may block cross-origin reading, or it may be offline. Atlas does not use a proxy or get around that block. Save the page, or its PDF, and upload that file instead. Browser detail: ${error?.message || 'network or CORS error'}`,
      { code: 'document_fetch_failed', cause: error },
    );
  }
  if (!response.ok) {
    throw makeError(
      `The link returned HTTP ${response.status}. Atlas does not retry through a proxy. Save the page, or its PDF, and upload that file instead.`,
      { code: 'document_fetch_failed', status: response.status },
    );
  }

  const finalUrl = response.url || target;
  const contentType = response.headers.get('content-type') || '';
  const bytes = new Uint8Array(await response.arrayBuffer());
  const kind = kindFromContentType(contentType) || sniffKind(bytes);

  if (kind === 'html') {
    const html = decodeBytes(bytes, contentType);
    const text = htmlToText(html);
    if (looksLikeLoginPage(finalUrl, html, text)) {
      throw makeError('This link led to a sign-in page. Atlas does not read pages behind a login. Save the document and upload that file instead.', { code: 'document_login_required' });
    }
    return finish(text, 'html');
  }
  return readBytes(bytes, { kind, name: finalUrl, contentType });
}

function base64ToBytes(payload) {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Reads a file Atlas already stored: a public storage URL, or a data URL
 * (Demo mode keeps uploads in the browser). Used to re-read a material without
 * the original File object.
 */
export async function readStoredFile(url, name = '') {
  const source = String(url || '').trim();
  if (!source) throw makeError('This material has no stored file to read.', { code: 'document_missing' });
  let bytes;
  let contentType = '';
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',');
    if (comma < 0) throw makeError('The stored file could not be read.', { code: 'document_unreadable' });
    const meta = source.slice(5, comma);
    contentType = meta.split(';')[0] || '';
    const payload = source.slice(comma + 1);
    bytes = /;base64/i.test(meta)
      ? base64ToBytes(payload)
      : new TextEncoder().encode(decodeURIComponent(payload));
  } else {
    const target = normalizePublicPageUrl(source);
    let response;
    try {
      response = await fetch(target, { method: 'GET', mode: 'cors', credentials: 'omit', redirect: 'follow' });
    } catch (error) {
      throw makeError('Atlas could not download the stored file from the browser. Check your connection, then try again.', { code: 'document_fetch_failed', cause: error });
    }
    if (!response.ok) {
      throw makeError(`The stored file could not be downloaded (HTTP ${response.status}). Upload it again.`, { code: 'document_fetch_failed', status: response.status });
    }
    contentType = response.headers.get('content-type') || '';
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  let kind = fileKind(name, contentType);
  if (kind === 'unknown') kind = kindFromContentType(contentType) || sniffKind(bytes);
  return readBytes(bytes, { kind, name: name || source, contentType });
}

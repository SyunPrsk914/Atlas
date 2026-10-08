// Checks for the Materials pipeline: document readers, the stored-text format,
// the migration of old free text and analyses, the analysis split and merge,
// the job queue, the demo-mode guard, and the Extended Essay subject.
//
// Run with: node --import ./scripts/register-ext.mjs scripts/verify-documents.mjs
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import {
  readBytes, readFromFile, readStoredFile, normalizeText, MAX_DOCUMENT_CHARS,
} from '../src/lib/documentReader.js';
import {
  sourceKey, encodeDocumentText, decodeDocumentText, legacyTypedText,
  mergeLegacyIntoNotes, legacyMigrationPatch, analysisMatchesSource, materialDisplayName,
  ANALYSIS_VERSION, LEGACY_NOTE_HEADING,
} from '../src/lib/materialDocument.js';
import {
  presentMaterial, formatMaterialsForAI, isSampleMaterial,
} from '../src/lib/materialRole.js';
import {
  splitIntoParts, analyzeDocument, buildEssayAnalysisPrompt, normalizeAnalysis, mergeAnalysisParts,
  ANALYSIS_MAX_PARTS, ANALYSIS_PART_CHARS,
} from '../src/lib/materialAnalysis.js';
import { createMaterialJobs, needsWork } from '../src/lib/materialJobs.js';
import { hasLiveModel, isLiveOutcome } from '../src/lib/aiOutcome.js';
import {
  parseIbRecord, serializeIbRecord, courseById, coursesForGroups, emptyIbRecord, ibWarnings,
} from '../src/lib/ibDiploma.js';

let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAILED: ${name}`);
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Test documents
// ---------------------------------------------------------------------------
/** A minimal, valid, text-based PDF with one line of Helvetica text per page entry. */
function makePdf(pages) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add(null);
  const pagesId = add(null);
  const fontId = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageRefs = [];
  for (const lines of pages) {
    const body = lines.map((line, i) => `BT /F1 12 Tf 72 ${740 - i * 18} Td (${line.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`).join('\n');
    const contentId = add(`<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`);
    const pageId = add(null);
    pageRefs.push([pageId, contentId]);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageRefs.map(([p]) => `${p} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`;
  for (const [pageId, contentId] of pageRefs) {
    objects[pageId - 1] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
  }
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

function makeDocx(paragraphs) {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  return zipSync({
    '[Content_Types].xml': strToU8('<Types/>'),
    'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="urn:w"><w:body>${body}</w:body></w:document>`),
  });
}

const dataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

// ---------------------------------------------------------------------------
// 1. Readers
// ---------------------------------------------------------------------------
await check('docx paragraphs, entities and tabs are read', async () => {
  const out = await readBytes(makeDocx(['My &amp; Story', 'I led the club']), { kind: 'docx' });
  assert.equal(out.reader, 'docx');
  assert.equal(out.text, 'My & Story\nI led the club');
});

await check('text files are normalised and read', async () => {
  const out = await readBytes(strToU8('First line.\r\n\r\n\r\n\r\nSecond paragraph, long enough to count.'), { kind: 'text' });
  assert.equal(out.reader, 'text');
  assert.equal(out.text, 'First line.\n\nSecond paragraph, long enough to count.');
});

await check('html pages keep their text', async () => {
  const out = await readBytes(strToU8('<html><head><title>T</title></head><body><main><h1>Title</h1><p>Real paragraph &amp; more.</p></main></body></html>'), { kind: 'html' });
  assert.equal(out.reader, 'html');
  assert.match(out.text, /Real paragraph & more\./);
  assert.doesNotMatch(out.text, /<\w/);
});

await check('text-based PDF gives text from every page', async () => {
  const out = await readBytes(makePdf([
    ['Personal statement', 'I rebuilt the robotics club budget with three sponsors.'],
    ['Second page: I tutored twelve students in maths.'],
  ]), { kind: 'pdf' });
  assert.equal(out.reader, 'pdf');
  assert.match(out.text, /Personal statement/);
  assert.match(out.text, /robotics club budget with three sponsors/);
  assert.match(out.text, /tutored twelve students/);
});

await check('a PDF without selectable text is reported as a scan', async () => {
  await assert.rejects(readBytes(makePdf([[]]), { kind: 'pdf' }), (error) => error.code === 'document_no_text');
});

await check('a damaged PDF is reported as unreadable', async () => {
  await assert.rejects(readBytes(new Uint8Array([37, 80, 68, 70, 45, 0, 1, 2]), { kind: 'pdf' }), (error) => error.code === 'document_unreadable');
});

await check('old Word, images, and unknown types get explicit messages', async () => {
  await assert.rejects(readFromFile({ name: 'old.doc', type: 'application/msword', size: 10, arrayBuffer: async () => new ArrayBuffer(0) }), (e) => e.code === 'document_unsupported' && /\.docx/.test(e.message));
  await assert.rejects(readFromFile({ name: 'scan.png', type: 'image/png', size: 10, arrayBuffer: async () => new ArrayBuffer(0) }), (e) => e.code === 'document_unsupported' && /photos or scanned/.test(e.message));
  await assert.rejects(readFromFile({ name: 'notes.pages', type: '', size: 10, arrayBuffer: async () => new ArrayBuffer(0) }), (e) => e.code === 'document_unsupported');
});

await check('files over 30 MB are refused before reading', async () => {
  await assert.rejects(readFromFile({ name: 'big.pdf', type: 'application/pdf', size: 31 * 1024 * 1024, arrayBuffer: async () => { throw new Error('should not read'); } }), (e) => e.code === 'document_too_large');
});

await check('an uploaded file is read from a File object', async () => {
  const file = new File([strToU8('Plain uploaded text that is long enough to count.')], 'Essay.txt', { type: 'text/plain' });
  const out = await readFromFile(file);
  assert.equal(out.reader, 'text');
  assert.match(out.text, /long enough to count/);
});

await check('a stored file is re-read from its data URL, by content type', async () => {
  const pdf = makePdf([['Stored copy of the statement with enough words to be read.']]);
  const out = await readStoredFile(dataUrl('application/pdf', pdf), 'uploaded file');
  assert.equal(out.reader, 'pdf');
  assert.match(out.text, /Stored copy of the statement/);
});

await check('normalizeText trims lines and collapses blank runs', () => {
  assert.equal(normalizeText('  a  \r\n\r\n\r\n\r\nb \n'), 'a\n\nb');
});

// ---------------------------------------------------------------------------
// 2. Stored text, legacy text, and migration
// ---------------------------------------------------------------------------
const FILE = 'https://example.supabase.co/storage/v1/object/public/uploads/u1/1728000000000-Personal%20Statement.pdf';
const LINK = 'https://college.example.edu/essay-prompts';

await check('source keys are stable, short, and change with the source', () => {
  assert.equal(sourceKey(FILE), sourceKey(FILE));
  assert.notEqual(sourceKey(FILE), sourceKey(LINK));
  assert.match(sourceKey(FILE), /^[0-9a-f]{8}$/);
  assert.equal(sourceKey(''), '');
});

await check('stored text round-trips exactly, including brackets and newlines', () => {
  const body = 'Line with [[brackets]] and \u2014 dash.\n\nSecond paragraph.';
  const decoded = decodeDocumentText(encodeDocumentText({ source: FILE, reader: 'pdf', text: body }));
  assert.equal(decoded.text, body);
  assert.equal(decoded.reader, 'pdf');
  assert.equal(decoded.key, sourceKey(FILE));
  assert.equal(decoded.chars, body.length);
});

await check('the display name drops the upload timestamp', () => {
  assert.equal(materialDisplayName({ file_url: FILE }), 'Personal Statement.pdf');
  assert.equal(materialDisplayName({ file_url: 'data:application/pdf;base64,AAAA' }), 'uploaded file');
  assert.equal(materialDisplayName({ link_url: LINK }), LINK);
});

await check('text in the old Content box is legacy, not document text', () => {
  assert.equal(legacyTypedText({ content: 'I pasted this essay.' }), 'I pasted this essay.');
  assert.equal(legacyTypedText({ content: encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Doc' }) }), '');
  assert.equal(legacyTypedText({ content: '   ' }), '');
});

await check('legacy text is appended to notes, never replacing them, and only once', () => {
  const merged = mergeLegacyIntoNotes('My robotics reflection.', 'Pasted essay body.');
  assert.ok(merged.startsWith('My robotics reflection.'));
  assert.ok(merged.includes(LEGACY_NOTE_HEADING));
  assert.ok(merged.endsWith('Pasted essay body.'));
  assert.equal(mergeLegacyIntoNotes(merged, 'Pasted essay body.'), merged);
  assert.equal(mergeLegacyIntoNotes('', 'Only text.'), `${LEGACY_NOTE_HEADING}\nOnly text.`);
});

await check('presentation: legacy content shows in Context, not as the document', () => {
  const row = { id: 'm1', title: 'Old essay', type: 'essay', content: 'Typed in the old box.', notes: 'Robotics.', file_url: '', link_url: '', analysis: { version: 1, status: 'ready', summary: 'FAKE' } };
  const shown = presentMaterial(row);
  assert.equal(shown.content, '');
  assert.equal(shown.document_state, 'none');
  assert.ok(shown.notes.includes('Typed in the old box.'));
  assert.ok(shown.notes.startsWith('Robotics.'));
  assert.equal(shown.analysis, null);
  assert.equal(shown.analysis_outdated, true);
});

await check('presentation: stored text is used only for the source it was read from', () => {
  const stored = encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Read from the file.' });
  const current = presentMaterial({ id: 'm2', title: 'A', type: 'essay', file_url: FILE, content: stored });
  assert.equal(current.document_state, 'ready');
  assert.equal(current.content, 'Read from the file.');
  const replaced = presentMaterial({ id: 'm2', title: 'A', type: 'essay', file_url: `${FILE}?v=2`, content: stored });
  assert.equal(replaced.document_state, 'outdated');
  assert.equal(replaced.content, '');
});

await check('presentation keeps a current analysis and hides one from another source', () => {
  const key = sourceKey(FILE);
  const current = { version: ANALYSIS_VERSION, status: 'ready', source: { key }, summary: 'ok' };
  assert.equal(analysisMatchesSource(current, key), true);
  const shown = presentMaterial({ id: 'm3', title: 'A', type: 'essay', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: 'x' }), analysis: current });
  assert.equal(shown.analysis.summary, 'ok');
  const other = presentMaterial({ id: 'm3', title: 'A', type: 'essay', file_url: `${FILE}?v=2`, analysis: current });
  assert.equal(other.analysis, null);
  assert.equal(other.analysis_outdated, true);
});

await check('presentMaterial is idempotent and never re-moves text', () => {
  const once = presentMaterial({ id: 'm4', title: 'A', type: 'essay', content: 'Old box text.', notes: '' });
  const twice = presentMaterial(once);
  assert.equal(twice, once);
  assert.equal(once.notes.split('Old box text.').length - 1, 1);
});

await check('migration patch moves legacy text and clears only old analyses', () => {
  const patch = legacyMigrationPatch({ id: 'm5', content: 'Pasted.', notes: 'Note.', analysis: { summary: 'FAKE' } });
  assert.equal(patch.content, null);
  assert.equal(patch.analysis, null);
  assert.ok(patch.notes.startsWith('Note.'));
  assert.ok(patch.notes.includes('Pasted.'));
  assert.equal(legacyMigrationPatch({ id: 'm6', content: encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Doc' }), analysis: { version: ANALYSIS_VERSION, status: 'ready', source: { key: sourceKey(FILE) } } }), null);
  assert.equal(legacyMigrationPatch({ id: 'm7', content: null, notes: 'Only a note.' }), null);
});

await check('sample tags survive the migration of legacy text', () => {
  const sampleTag = '[[atlas-role:sample_essay]]';
  const row = { id: 'm8', type: 'other', content: 'Sample body.', notes: sampleTag };
  const patch = legacyMigrationPatch(row);
  assert.ok(patch.notes.startsWith(sampleTag));
  assert.equal(isSampleMaterial({ type: 'other', notes: patch.notes }), true);
  assert.equal(presentMaterial({ ...row, ...patch }).type, 'sample_essay');
});

// ---------------------------------------------------------------------------
// 3. What the AI is given
// ---------------------------------------------------------------------------
await check('the AI gets the document text under its own heading, with context separate', () => {
  const text = 'I rebuilt the robotics club budget with three sponsors.';
  const out = formatMaterialsForAI([
    { id: 'a', title: 'Statement', type: 'essay', file_url: FILE, notes: 'My junior-year reflection.', content: encodeDocumentText({ source: FILE, reader: 'pdf', text }) },
  ]);
  assert.match(out, /Document text \(read from the uploaded file itself/);
  assert.ok(out.includes(text));
  assert.ok(out.indexOf('Document text') < out.indexOf('Context from the applicant'));
  assert.match(out, /facts stated here are the applicant's own/);
});

await check('the AI is told when a document has not been read', () => {
  const out = formatMaterialsForAI([{ id: 'b', title: 'Link', type: 'link', link_url: LINK, content: '' }]);
  assert.match(out, /Document text: not read yet\. Do not describe what it says\./);
});

await check('a long document is cut for the prompt with an explicit note', () => {
  const long = 'word '.repeat(6000);
  const out = formatMaterialsForAI([{ id: 'c', title: 'Long', type: 'essay', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: long }) }]);
  assert.match(out, /more characters left out here/);
  assert.ok(out.length < long.length);
});

await check('samples keep their craft-only framing and never become the applicant', () => {
  const out = formatMaterialsForAI([
    { id: 'd', title: 'Oxford sample', type: 'sample_essay', file_url: FILE, notes: 'UK sample, opening move.', content: encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Sample text.' }) },
  ], { platform: 'ucas' });
  assert.match(out, /NOT written by the applicant/);
  assert.match(out, /describes the sample's writer, never the applicant/);
});

await check('a current analysis is included with its facts; an old one is not', () => {
  const key = sourceKey(FILE);
  const withAnalysis = (analysis) => formatMaterialsForAI([{
    id: 'e', title: 'Statement', type: 'essay', file_url: FILE,
    content: encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Text.' }),
    analysis,
  }]);
  const good = withAnalysis({ version: ANALYSIS_VERSION, status: 'ready', source: { key }, facts: ['Led a robotics club of 14 students.'], coverage: { complete: true, analyzed_chars: 5, total_chars: 5 } });
  assert.match(good, /Facts about the applicant found in the document/);
  assert.match(good, /Led a robotics club of 14 students/);
  const old = withAnalysis({ summary: 'FAKE OUTPUT' });
  assert.doesNotMatch(old, /FAKE OUTPUT/);
});

// ---------------------------------------------------------------------------
// 4. Analysis: parts, prompt, merge, and refusal of demo output
// ---------------------------------------------------------------------------
const paragraphs = Array.from({ length: 40 }, (_, i) => `Paragraph ${i}. ${'I rebuilt the robotics club budget with three sponsors and tracked every pound. '.repeat(3)}`).join('\n\n');

await check('parts cover the text in order with no gaps or overlap', () => {
  const { parts, total } = splitIntoParts(paragraphs);
  assert.equal(parts.map((p) => p.text).join(''), paragraphs);
  assert.ok(parts.every((p) => p.text.length <= 6000));
  assert.equal(total, parts.length);
});

await check('long text with no breaks is still split, and the cap is reported', () => {
  const words = 'word '.repeat(5000);
  const split = splitIntoParts(words);
  assert.equal(split.parts.map((p) => p.text).join(''), words);
  const huge = splitIntoParts('x'.repeat(200000));
  assert.equal(huge.total, Math.ceil(200000 / ANALYSIS_PART_CHARS));
  assert.equal(huge.parts.length, huge.total, 'the default cap holds every part of the reader limit');
  const capped = splitIntoParts('x'.repeat(200000), { maxParts: 10 });
  assert.equal(capped.parts.length, 10);
  assert.equal(capped.total, 34);
});

// Long paragraphs used to leave parts a little over half full, so one document
// needed 56 parts. Every part but the last must now hold at least 80%.
const longParagraphs = Array.from({ length: 60 }, (_, i) => `Paragraph ${i}. ${'The robotics club budget grew because we tracked every pound. '.repeat(55)}`).join('\n\n');
const shortParagraphs = Array.from({ length: 300 }, (_, i) => `Paragraph ${i}. ${'I rebuilt the robotics club budget with three sponsors. '.repeat(10)}`).join('\n\n');
await check('parts stay at least 80% full, so the reader limit fits the cap', () => {
  for (const text of [longParagraphs, shortParagraphs, paragraphs]) {
    const { parts, total } = splitIntoParts(text, { maxParts: 100000 });
    assert.equal(parts.map((p) => p.text).join(''), text, 'no gaps or overlap');
    const full = parts.slice(0, -1);
    assert.ok(full.every((p) => p.text.length >= Math.floor(ANALYSIS_PART_CHARS * 0.8)), 'a part is under 80% full');
    assert.equal(total, parts.length);
  }
  const limitText = longParagraphs.repeat(10).slice(0, MAX_DOCUMENT_CHARS);
  assert.ok(splitIntoParts(limitText, { maxParts: 100000 }).total <= ANALYSIS_MAX_PARTS);
});

await check('the part cap covers the whole reader limit', () => {
  assert.equal(ANALYSIS_MAX_PARTS, Math.ceil(MAX_DOCUMENT_CHARS / (ANALYSIS_PART_CHARS * 0.8)));
});

await check('a document at the reader limit is analysed in full', async () => {
  const text = longParagraphs.repeat(10).slice(0, MAX_DOCUMENT_CHARS);
  const merged = await analyzeDocument({ title: 'Full', text, runAI: async () => ({ ok: true, result: { overall_score: 6 }, meta: { provider: 'ollama' } }) });
  assert.equal(merged.coverage.complete, true);
  assert.equal(merged.coverage.parts_skipped, 0);
  assert.equal(merged.coverage.parts_attempted, merged.coverage.parts_total);
});

await check('the prompt names the part and keeps context out of the text block', () => {
  const prompt = buildEssayAnalysisPrompt({
    title: 'T', text: 'BODY TEXT ONLY', kind: 'essay', contextNotes: 'SECRET CONTEXT NOTE',
    partIndex: 2, partCount: 3, partStart: 6000, documentChars: 18000,
  });
  assert.match(prompt, /PART 2 of 3/);
  assert.match(prompt, /characters 6001 to 6014 of 18000/);
  const block = prompt.slice(prompt.indexOf('<<<TEXT'), prompt.indexOf('TEXT>>>'));
  assert.ok(block.includes('BODY TEXT ONLY'));
  assert.ok(!block.includes('SECRET CONTEXT NOTE'));
  assert.match(prompt, /"facts"/);
});

await check('sample prompts ask for craft moves, not facts', () => {
  const prompt = buildEssayAnalysisPrompt({ title: 'S', text: 'x', kind: 'sample_essay' });
  assert.match(prompt, /craft_moves/);
  assert.match(prompt, /Leave "facts" empty/);
});

await check('model findings are placed in the whole document, and quotes match', async () => {
  const fakeRunAI = async ({ prompt }) => {
    const block = prompt.slice(prompt.indexOf('<<<TEXT') + 8, prompt.indexOf('TEXT>>>'));
    const quote = block.trim().slice(0, 12);
    return { ok: true, result: { overall_score: 6, findings: [{ kind: 'issue', quote, offset: 0, note: 'n' }], facts: ['Ran a club'] }, meta: { provider: 'ollama', model: 'test' } };
  };
  const seen = [];
  const merged = await analyzeDocument({ title: 'T', kind: 'essay', text: paragraphs, runAI: fakeRunAI, onProgress: (p) => seen.push(p.part) });
  assert.equal(merged.coverage.complete, true);
  assert.equal(merged.coverage.parts_total, merged.coverage.parts_analyzed);
  assert.equal(merged.coverage.parts_skipped, 0);
  assert.ok(seen.length > 1);
  assert.ok(merged.findings.length > 1);
  for (const f of merged.findings) {
    assert.equal(paragraphs.slice(f.offset, f.offset + f.quote.length), f.quote);
  }
  assert.deepEqual(merged.facts, ['Ran a club']);
  assert.equal(merged.word_count, paragraphs.trim().split(/\s+/).length);
});

await check('demo output is refused and never becomes an analysis', async () => {
  const demoRunAI = async () => ({ ok: true, result: { summary: 'DEMO OUTPUT' }, meta: { provider: 'demo', demo: true } });
  await assert.rejects(analyzeDocument({ title: 'T', text: 'Some text here.', runAI: demoRunAI }), /Demo output is placeholder text/);
});

await check('a part that fails twice is recorded, the rest still count', async () => {
  let calls = 0;
  const flaky = async ({ prompt }) => {
    calls += 1;
    if (prompt.includes('PART 2 of')) return { ok: false, error: new Error('model timed out') };
    return { ok: true, result: { overall_score: 7, findings: [] }, meta: { provider: 'ollama' } };
  };
  const merged = await analyzeDocument({ title: 'T', text: paragraphs, runAI: flaky });
  assert.equal(merged.coverage.complete, false);
  assert.equal(merged.coverage.parts_failed, 1);
  assert.equal(merged.coverage.parts_skipped, 0);
  assert.equal(merged.overall_score, 7);
  assert.ok(calls >= merged.coverage.parts_total + 1, 'the failing part was retried once');
});

await check('a document longer than the cap says which part was skipped', async () => {
  const huge = Array.from({ length: 120 }, (_, i) => `Paragraph ${i}. ${'x'.repeat(900)}`).join('\n\n');
  const merged = await analyzeDocument({ title: 'T', text: huge, maxParts: 10, runAI: async () => ({ ok: true, result: { overall_score: 5 }, meta: { provider: 'ollama' } }) });
  assert.equal(merged.coverage.complete, false);
  assert.equal(merged.coverage.parts_attempted, 10);
  assert.ok(merged.coverage.parts_skipped > 0);
  assert.equal(merged.coverage.parts_failed, 0);
  assert.equal(merged.coverage.parts_total, merged.coverage.parts_attempted + merged.coverage.parts_skipped);
});

await check('when every part fails, the analysis fails with the model message', async () => {
  const failing = async () => ({ ok: false, error: new Error('Ollama is not running') });
  await assert.rejects(analyzeDocument({ title: 'T', text: 'Short text for one part.', runAI: failing }), /Ollama is not running/);
});

await check('merging ignores parts without a usable answer', () => {
  const merged = mergeAnalysisParts([
    { index: 0, start: 0, text: 'Alpha beta gamma.', raw: null },
    { index: 1, start: 18, text: 'Delta epsilon.', raw: { overall_score: 8, sounds_like_ai: true, findings: [] } },
  ], { fullText: 'Alpha beta gamma.Delta epsilon.' });
  assert.equal(merged.overall_score, 8);
  assert.equal(merged.coverage.parts_analyzed, 1);
});

await check('a quote the model placed wrongly is found again', () => {
  const normalized = normalizeAnalysis({ findings: [{ kind: 'style', quote: 'budget', offset: 99 }] }, 'We kept a budget.');
  assert.equal(normalized.findings[0].offset, 'We kept a '.length);
});

// ---------------------------------------------------------------------------
// 5. Job queue
// ---------------------------------------------------------------------------
function makeStore(rows) {
  const data = new Map(rows.map((r) => [r.id, { ...r }]));
  const store = {
    data,
    get: async (id) => (data.has(id) ? { ...data.get(id) } : null),
    load: async (id) => (data.has(id) ? { ...data.get(id) } : null),
    save: async (id, patch) => {
      if (!data.has(id)) return null;
      const next = { ...data.get(id), ...patch };
      data.set(id, next);
      return { ...next };
    },
  };
  return store;
}

function fakeModel(options = {}) {
  const prompts = [];
  const runAI = async ({ prompt }) => {
    prompts.push(prompt);
    if (options.fail) return { ok: false, error: new Error(options.fail) };
    const block = prompt.slice(prompt.indexOf('<<<TEXT') + 8, prompt.indexOf('TEXT>>>'));
    return {
      ok: true,
      result: { overall_score: 7, sounds_like_ai: false, findings: [{ kind: 'strength', quote: block.trim().slice(0, 10), offset: 0, note: 'works' }], facts: ['Led a robotics club'] },
      meta: { provider: 'ollama', model: 'test' },
    };
  };
  return { runAI, prompts };
}

function makeJobs(store, { model, reader, readUrlImpl, readStoredImpl, hasModel = true, notes = [] }) {
  return createMaterialJobs({
    readFile: reader?.file || (async () => { throw new Error('no file reader'); }),
    readUrl: readUrlImpl || (async () => { throw new Error('no url reader'); }),
    readStored: readStoredImpl || (async () => { throw new Error('no stored reader'); }),
    analyze: (args) => analyzeDocument({ ...args, runAI: model.runAI }),
    hasModel: () => hasModel,
    save: store.save,
    load: store.load,
    reportError: (error, title) => notes.push({ message: error.message, title }),
    now: () => '2026-10-08T00:00:00.000Z',
  });
}

const BODY = 'I rebuilt the robotics club budget with three sponsors and tracked every pound we spent.';

await check('an uploaded file is read and analysed without any further step', async () => {
  const store = makeStore([{ id: 'j1', title: 'Statement', type: 'essay', notes: 'Junior year.', file_url: FILE, link_url: '', content: null, analysis: null }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model, reader: { file: async () => ({ text: BODY, reader: 'pdf' }) } });
  const file = new File([new Uint8Array(4)], 'Personal Statement.pdf', { type: 'application/pdf' });
  const row = await jobs.enqueue({ ...store.data.get('j1') }, { file, force: true, notify: true });
  const saved = store.data.get('j1');
  const decoded = decodeDocumentText(saved.content);
  assert.equal(decoded.text, BODY);
  assert.equal(decoded.key, sourceKey(FILE));
  assert.equal(saved.analysis.status, 'ready');
  assert.equal(saved.analysis.version, ANALYSIS_VERSION);
  assert.equal(saved.analysis.source.key, sourceKey(FILE));
  assert.equal(saved.analysis.source.reader, 'pdf');
  assert.deepEqual(saved.analysis.facts, ['Led a robotics club']);
  assert.equal(jobs.getStatus('j1').state, 'done');
  assert.equal(jobs.getStatus('j1').persisted, true);
  assert.equal(row.analysis.status, 'ready');
  const textBlock = model.prompts[0].slice(model.prompts[0].indexOf('<<<TEXT'), model.prompts[0].indexOf('TEXT>>>'));
  assert.ok(textBlock.includes(BODY), 'the analysis read the document text');
  assert.ok(!textBlock.includes('Junior year.'), 'context is not sent as the document');
});

await check('without a connected model the document is read and analysis waits', async () => {
  const store = makeStore([{ id: 'j2', title: 'Statement', type: 'essay', notes: '', file_url: FILE, content: null, analysis: null }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model, hasModel: false, reader: { file: async () => ({ text: BODY, reader: 'pdf' }) } });
  await jobs.enqueue({ ...store.data.get('j2') }, { file: new File([new Uint8Array(4)], 'a.pdf'), force: true });
  assert.equal(model.prompts.length, 0, 'no model call in demo mode');
  assert.equal(jobs.getStatus('j2').state, 'waiting');
  assert.ok(decodeDocumentText(store.data.get('j2').content), 'the text is still kept');
  assert.equal(store.data.get('j2').analysis, null);
});

await check('a failed read is recorded and never replaces a ready analysis of the same source', async () => {
  const key = sourceKey(LINK);
  const ready = { version: ANALYSIS_VERSION, status: 'ready', source: { key }, summary: 'Real analysis', coverage: { complete: true } };
  const store = makeStore([{ id: 'j3', title: 'Prompt page', type: 'document', link_url: LINK, file_url: '', content: encodeDocumentText({ source: LINK, reader: 'html', text: BODY }), analysis: ready }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model, readUrlImpl: async () => { throw Object.assign(new Error('blocked'), { code: 'document_fetch_failed' }); } });
  await jobs.enqueue({ ...store.data.get('j3') }, { force: true });
  assert.equal(jobs.getStatus('j3').state, 'failed');
  assert.equal(store.data.get('j3').analysis.summary, 'Real analysis');
});

await check('old free text is moved to the notes before a re-read can overwrite it', async () => {
  const store = makeStore([{ id: 'j11', title: 'Statement', type: 'essay', notes: 'Keep me.', file_url: FILE, content: 'Old pasted essay.', analysis: null }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model, reader: { file: async () => ({ text: BODY, reader: 'pdf' }) } });
  const result = await jobs.enqueue({ ...store.data.get('j11') }, { file: new File([new Uint8Array(4)], 'a.pdf'), force: true });
  const saved = store.data.get('j11');
  assert.ok(saved.notes.startsWith('Keep me.'));
  assert.ok(saved.notes.includes('Old pasted essay.'), 'the old text is kept in the notes');
  assert.equal(decodeDocumentText(saved.content).text, BODY);
  assert.equal(result.legacyMoved, true, 'the page is told the notes changed');
});

await check('a failed read for a new source records the reason and its code', async () => {
  const store = makeStore([{ id: 'j4', title: 'Scan', type: 'document', file_url: FILE, content: null, analysis: null }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model, reader: { file: async () => { throw Object.assign(new Error('This PDF has no selectable text.'), { code: 'document_no_text' }); } } });
  await jobs.enqueue({ ...store.data.get('j4') }, { file: new File([new Uint8Array(4)], 'scan.pdf'), force: true });
  const failure = store.data.get('j4').analysis;
  assert.equal(failure.status, 'failed');
  assert.equal(failure.stage, 'reading');
  assert.equal(failure.code, 'document_no_text');
  assert.equal(needsWork(presentMaterial(store.data.get('j4')), { modelReady: true }), false, 'an unreadable file is not retried on every visit');
});

await check('analysis failure keeps the text and records the failure', async () => {
  const store = makeStore([{ id: 'j5', title: 'Statement', type: 'essay', file_url: FILE, content: null, analysis: null }]);
  const model = fakeModel({ fail: 'Ollama is not running' });
  const jobs = makeJobs(store, { model, reader: { file: async () => ({ text: BODY, reader: 'pdf' }) } });
  await jobs.enqueue({ ...store.data.get('j5') }, { file: new File([new Uint8Array(4)], 'a.pdf'), force: true });
  assert.ok(decodeDocumentText(store.data.get('j5').content).text === BODY);
  assert.equal(store.data.get('j5').analysis.stage, 'analysis');
  assert.match(store.data.get('j5').analysis.message, /Ollama is not running/);
  assert.equal(jobs.getStatus('j5').state, 'failed');
});

await check('edits to notes made while a job waits are used by the analysis', async () => {
  const store = makeStore([{ id: 'j6', title: 'Statement', type: 'essay', notes: 'Old note.', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: BODY }), analysis: null }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model });
  const pending = jobs.enqueue({ ...store.data.get('j6') });
  store.data.set('j6', { ...store.data.get('j6'), notes: 'Newer note about the club.' });
  await pending;
  assert.ok(model.prompts[0].includes('Newer note about the club.'));
});

await check('a file replaced during a read is not analysed under the old source', async () => {
  const LINK_A = 'https://a.example.org/page';
  const LINK_B = 'https://b.example.org/page';
  const store = makeStore([{ id: 'j7', title: 'Page', type: 'document', link_url: LINK_A, file_url: '', content: null, analysis: null }]);
  const model = fakeModel();
  let release;
  let started;
  const gate = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { started = resolve; });
  const jobs = makeJobs(store, {
    model,
    readUrlImpl: async () => { started(); await gate; return { text: BODY, reader: 'html' }; },
  });
  const pending = jobs.enqueue({ ...store.data.get('j7') }, { force: true });
  await reading;
  store.data.set('j7', { ...store.data.get('j7'), link_url: LINK_B });
  release();
  await pending;
  assert.equal(jobs.getStatus('j7').state, 'queued', 'the job hands over to the new source');
  assert.equal(decodeDocumentText(store.data.get('j7').content).key, sourceKey(LINK_A), 'the text read is labelled with the source it came from');
  assert.equal(model.prompts.length, 0, 'no analysis for the replaced source');
  assert.equal(store.data.get('j7').analysis, null);
});

await check('queued jobs for one material are merged until one has started', async () => {
  const store = makeStore([{ id: 'j8', title: 'Statement', type: 'essay', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: BODY }), analysis: null }]);
  const model = fakeModel();
  const jobs = makeJobs(store, { model });
  const first = jobs.enqueue({ ...store.data.get('j8') });
  const second = jobs.enqueue({ ...store.data.get('j8') });
  assert.equal(first, second, 'the same pending job is reused');
  await first;
  assert.equal(jobs.isBusy('j8'), false);
});

await check('when the analysis column is missing, the result is shown but flagged as unsaved', async () => {
  const store = makeStore([{ id: 'j9', title: 'Statement', type: 'essay', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: BODY }), analysis: null }]);
  const notes = [];
  const model = fakeModel();
  const base = store.save;
  store.save = async (id, patch) => {
    if (patch.analysis) {
      const { analysis: _ignored, ...rest } = patch;
      return base(id, rest);
    }
    return base(id, patch);
  };
  const jobs = makeJobs(store, { model, notes });
  await jobs.enqueue({ ...store.data.get('j9') }, { notify: true });
  assert.equal(jobs.getStatus('j9').persisted, false);
  assert.equal(notes.length, 1);
  assert.match(notes[0].message, /supabase\/schema\.sql/);
});

await check('the stored text is re-read when the source changed since it was read', async () => {
  const store = makeStore([{ id: 'j10', title: 'Statement', type: 'essay', file_url: `${FILE}?v=2`, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Old text.' }), analysis: null }]);
  const model = fakeModel();
  let stored = 0;
  const jobs = makeJobs(store, { model, readStoredImpl: async () => { stored += 1; return { text: BODY, reader: 'pdf' }; } });
  await jobs.enqueue({ ...store.data.get('j10') });
  assert.equal(stored, 1);
  assert.equal(decodeDocumentText(store.data.get('j10').content).text, BODY);
});

await check('needsWork decides what opens with the page', () => {
  const ready = presentMaterial({ id: 'n1', title: 'A', type: 'essay', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: BODY }), analysis: { version: ANALYSIS_VERSION, status: 'ready', source: { key: sourceKey(FILE) }, coverage: { complete: true } } });
  assert.equal(needsWork(ready, { modelReady: true }), false);
  const noAnalysis = presentMaterial({ id: 'n2', title: 'A', type: 'essay', file_url: FILE, content: encodeDocumentText({ source: FILE, reader: 'pdf', text: BODY }) });
  assert.equal(needsWork(noAnalysis, { modelReady: true }), true);
  assert.equal(needsWork(noAnalysis, { modelReady: false }), false);
  const legacy = presentMaterial({ id: 'n3', title: 'A', type: 'essay', file_url: FILE, content: 'Pasted text.', analysis: { summary: 'FAKE' } });
  assert.equal(needsWork(legacy, { modelReady: false }), true, 'a legacy material is read from its file');
  const contextOnly = presentMaterial({ id: 'n4', title: 'Tip', type: 'note', notes: 'A tip.' });
  assert.equal(needsWork(contextOnly, { modelReady: true }), false);
});

// ---------------------------------------------------------------------------
// 6. Demo guard
// ---------------------------------------------------------------------------
await check('demo mode is detected and demo output is never a live result', () => {
  assert.equal(hasLiveModel(), false, 'no Ollama model is configured in this test process');
  assert.equal(isLiveOutcome({ ok: true, result: { summary: 'DEMO OUTPUT' }, meta: { provider: 'demo', demo: true } }), false);
  assert.equal(isLiveOutcome({ ok: false, error: new Error('x'), meta: {} }), false);
  assert.equal(isLiveOutcome({ ok: true, result: { summary: 'real' }, meta: { provider: 'ollama' } }), true);
});

// ---------------------------------------------------------------------------
// 7. Extended Essay subject, and typed text is never trimmed
// ---------------------------------------------------------------------------
await check('the Extended Essay subject is a catalogue choice, like the six subjects', () => {
  const parsed = parseIbRecord('Extended Essay predicted B (Physics)');
  assert.equal(parsed.eeSubject, 'Physics');
  assert.equal(parsed.eeCourse.courseId, courseById('physics').id);
  const business = parseIbRecord('Extended Essay predicted C (Business management)');
  assert.equal(business.eeCourse.courseId, 'business');
  assert.equal(business.eeSubject, 'Business management');
});

await check('typed spaces and symbols survive a save and a reload', () => {
  const record = emptyIbRecord();
  record.eeCourse = { courseId: 'custom', language: '', customName: 'Business Management & Arts ' };
  record.subjects[0] = { ...record.subjects[0], courseId: 'custom', customName: 'Global Politics (Higher) ' };
  const reloaded = parseIbRecord(serializeIbRecord(record));
  assert.equal(reloaded.eeCourse.customName, 'Business Management & Arts ');
  assert.equal(reloaded.eeSubject, 'Business Management & Arts');
  assert.equal(reloaded.subjects[0].customName, 'Global Politics (Higher) ');
});

await check('an Extended Essay in a language subject needs its language', () => {
  const record = emptyIbRecord();
  const literature = coursesForGroups([1]).find((c) => c.needsLanguage);
  record.eeCourse = { courseId: literature.id, language: '', customName: '' };
  const warnings = ibWarnings(parseIbRecord(serializeIbRecord(record)));
  assert.ok(warnings.some((w) => /Extended Essay subject .* needs a language/.test(w)));
});

await check('a long analysis keeps facts from every part, not only the first pages', () => {
  const results = Array.from({ length: 4 }, (_, p) => ({
    index: p,
    start: p * 100,
    text: `part ${p}`,
    raw: {
      overall_score: 6,
      facts: Array.from({ length: 30 }, (_, i) => `Part ${p} fact ${i}`),
      findings: [],
      craft_moves: [],
      top_actions: [],
      summary: `Summary of part ${p}.`,
    },
  }));
  const merged = mergeAnalysisParts(results, { fullText: 'x'.repeat(400) });
  assert.equal(merged.facts.length, 80);
  for (let p = 0; p < 4; p += 1) assert.ok(merged.facts.includes(`Part ${p} fact 0`), `part ${p} is represented`);
  assert.ok(merged.summary.includes('Part 4: Summary of part 3.'), 'every part has its own summary line');
});

await check('a sample never contributes facts, and a long list says how much it left out', () => {
  const key = sourceKey(FILE);
  const facts = Array.from({ length: 200 }, (_, i) => `Fact number ${i} about the applicant`);
  const analysis = { version: ANALYSIS_VERSION, status: 'ready', source: { key }, facts, craft_moves: ['Opens with a concrete scene.'], summary: 'Summary.' };
  const content = encodeDocumentText({ source: FILE, reader: 'pdf', text: 'Text.' });
  const own = formatMaterialsForAI([{ id: 'o', title: 'Resume', type: 'resume', file_url: FILE, content, analysis }]);
  assert.match(own, /Facts about the applicant found in the document/);
  assert.match(own, /…and \d+ more in the saved analysis/);
  const sample = formatMaterialsForAI([{ id: 's', title: 'Sample', type: 'sample_essay', file_url: FILE, content, analysis: { ...analysis, facts: ['Lived in a small town in Ohio.'] } }]);
  assert.ok(!sample.includes('Lived in a small town in Ohio'), 'a sample fact reached the prompt');
  assert.ok(sample.includes('Opens with a concrete scene.'));
});

console.log(`verify-documents: ok (${passed} checks)`);

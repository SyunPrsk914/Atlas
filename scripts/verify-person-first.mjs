import assert from 'node:assert/strict';
import { checkDraftAgainstRoot } from '../src/lib/essayRoot.js';
import { dissectMaterialKnowledge, applicantKnowledgeForPrompt, materialDissectionKey } from '../src/lib/applicantKnowledge.js';
import { buildLengthRepairPrompt, buildPolishPrompt } from '../src/lib/essayPrompts.js';

for (const root of ['Be natural', 'Make sure it looks like an actual note']) {
  const check = checkDraftAgainstRoot(root, 'I left my keys by the door and went back for the notebook.');
  assert.equal(check.status, 'uncertain');
  assert.equal(check.correction, '');
}
const material = { id: 'm1', title: 'UCAS draft', type: 'document', analysis_role: 'writing_draft', notes: 'My research changed how I think. '.repeat(40), target_platform: 'ucas', target_university_id: 'u1' };
assert.notEqual(materialDissectionKey(material), materialDissectionKey({ ...material, notes: material.notes.replace('research', 'teaching') }));
const old = { id: 'old', origin: 'ai', kind: 'evidence', text: 'Earlier extraction', source_id: 'm1', data: { dissected: true } };
const manual = { ...old, id: 'manual', origin: 'manual' };
const deleted = [];
let written;
const deps = {
  material, existingRows: [old, manual], isLive: () => true,
  runAI: async () => ({ result: { sections: [{ section: 'UCAS research', audience: 'own', school: 'Harvard', platform: 'ucas', essay_kind: 'why_major', items: [{ category: 'experience', text: 'The applicant built an instrument and checked its measurements against repeated observations.' }] }] } }),
  createRows: async (rows) => { written = rows; return rows; },
  deleteRow: async (id) => { deleted.push(id); },
};
await dissectMaterialKnowledge(deps);
assert.deepEqual(deleted, ['old']);
for (const key of ['target_platform', 'target_university_id', 'target_essay_id', 'target_task']) assert.equal(written[0][key], null);
assert.deepEqual(written[0].data.shape_keys, []);
assert.equal(written[0].data.previous_sections[0].text, old.text);
const legacy = { ...written[0], target_platform: 'ucas', target_university_id: 'u1', data: { ...written[0].data, shape_keys: ['why_major'] } };
assert.match(applicantKnowledgeForPrompt([legacy], { platform: 'common_app', universityId: 'u2' }), /built an instrument/);
deleted.length = 0;
await dissectMaterialKnowledge({ ...deps, runAI: async () => ({ result: { sections: [] } }) });
assert.equal(deleted.length, 0);
await assert.rejects(dissectMaterialKnowledge({ ...deps, createRows: async () => null }), /not fully confirmed/);
assert.equal(deleted.length, 0);
const essay = { draft_anchor: 'Be natural', edit_instructions: 'Keep the last line.', content: 'My notebook.', word_limit: 100 };
assert.match(buildPolishPrompt({ essay, editInstructions: essay.edit_instructions }), /Keep the last line/);
assert.match(buildLengthRepairPrompt({ essay, text: 'My notebook.', assessment: { state: 'short', count: 2, message: 'short', shortfall: 88 } }), /Keep the last line/);
console.log('verify-person-first: ok');

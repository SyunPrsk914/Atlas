import assert from 'node:assert/strict';
import { resolveSupabaseConfig, isPublicSupabaseKey } from '../api/supabaseConfig.js';
import {
  buildSharedEssayPlan, universityNamesMatch, resolvedEssayLimit,
  isAmbiguousCommonAppPrompt, ucasCharacterBudget, COMMON_APP_PROMPTS,
} from '../src/lib/applicationData.js';
import { formatMaterialsForAI, materialWritePayload, isSampleMaterial } from '../src/lib/materialRole.js';
import { parseIbRecord, serializeIbRecord, IB_SLOTS, suggestedDiplomaTotal } from '../src/lib/ibDiploma.js';
import { buildProfileContext } from '../src/lib/profileContext.js';
import { fixedPromptChoices, promptsForUniversity } from '../src/lib/supplementPrompts.js';
import { buildGeneratePrompt } from '../src/lib/essayPrompts.js';

const anon = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.sig`;
const service = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.sig`;

assert.equal(isPublicSupabaseKey(anon), true);
assert.equal(isPublicSupabaseKey(service), false);

const recovered = resolveSupabaseConfig({
  SUPABASE_URL: 'postgresql://postgres.abcdefghijklmnop:secret@db.abcdefghijklmnop.supabase.co:5432/postgres',
  SUPABASE_ANON_KEY: anon,
});
assert.equal(recovered.url, 'https://abcdefghijklmnop.supabase.co');
assert.equal(recovered.configured, true);
assert.equal(recovered.recoveredFromDatabaseUrl, true);

const skipsUnrecoverable = resolveSupabaseConfig({
  SUPABASE_URL: 'postgres://user:pass@localhost:5432/db',
  VITE_SUPABASE_URL: 'https://goodprojectref.supabase.co',
  VITE_SUPABASE_ANON_KEY: anon,
});
assert.equal(skipsUnrecoverable.url, 'https://goodprojectref.supabase.co');
assert.equal(skipsUnrecoverable.configured, true);

const fromNext = resolveSupabaseConfig({
  SUPABASE_URL: 'not a url',
  NEXT_PUBLIC_SUPABASE_URL: 'https://nextprojectref.supabase.co/',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
});
assert.equal(fromNext.url, 'https://nextprojectref.supabase.co');
assert.equal(fromNext.configured, true);

const quoted = resolveSupabaseConfig({
  VITE_SUPABASE_URL: '"https://quotedrefxxxxx.supabase.co"',
  VITE_SUPABASE_ANON_KEY: anon,
});
assert.equal(quoted.url, 'https://quotedrefxxxxx.supabase.co');

const swapped = resolveSupabaseConfig({
  SUPABASE_URL: anon,
  SUPABASE_ANON_KEY: 'https://swappedrefxxxx.supabase.co',
});
assert.equal(swapped.url, 'https://swappedrefxxxx.supabase.co');
assert.equal(swapped.key, anon);

const badOnly = resolveSupabaseConfig({
  SUPABASE_URL: 'postgres://user:pass@localhost:5432/db',
});
assert.equal(badOnly.configured, false);
assert.ok(badOnly.invalidReason);
assert.equal(badOnly.url, '');

const placeholder = resolveSupabaseConfig({
  VITE_SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'your-anon-public-key',
});
assert.equal(placeholder.configured, false);

const ucas = buildSharedEssayPlan('ucas', []);
assert.equal(ucas.length, 3);
assert.deepEqual(ucas.map((item) => item.prompt), ucas.map((item) => item.prompt));
assert.equal(new Set(ucas.map((item) => item.prompt)).size, 3);
assert.ok(ucas.every((item) => item.word_limit === 4000 && item.limit_unit === 'characters'));
assert.equal(resolvedEssayLimit({ application_platform: 'ucas', limit_unit: 'characters' }), 4000);
assert.equal(resolvedEssayLimit({ word_limit: 150 }), 150);

const common = buildSharedEssayPlan('common_app', []);
const personal = common.find((item) => item.type === 'personal_statement');
assert.equal(personal.prompt, '');
assert.equal(isAmbiguousCommonAppPrompt(COMMON_APP_PROMPTS.map((p) => p.text).join('\n\n')), true);
assert.equal(isAmbiguousCommonAppPrompt(COMMON_APP_PROMPTS[0].text), false);

assert.equal(universityNamesMatch('Stanford', 'Stanford University'), true);
assert.equal(universityNamesMatch('York', 'New York University'), false);
assert.equal(universityNamesMatch('MIT', 'Massachusetts Institute of Technology'), false);

const budget = ucasCharacterBudget([
  { title: 'UCAS Q1 — Motivation', content: 'a'.repeat(350) },
  { title: 'UCAS Q2 — Preparation', content: 'b'.repeat(350) },
  { title: 'UCAS Q3 — Beyond education', content: 'c'.repeat(3400) },
]);
assert.equal(budget.over, true);
assert.equal(budget.total, 4100);

const materials = formatMaterialsForAI([
  { title: 'Mine', type: 'essay', content: 'I built a radio.' },
  { title: 'Admitted sample', type: 'sample_essay', content: 'I grew up in Oslo.' },
]);
assert.match(materials, /APPLICANT'S OWN MATERIALS/);
assert.match(materials, /NOT written by the applicant/);
assert.ok(materials.indexOf('I built a radio.') < materials.indexOf('SAMPLE'));
assert.equal(isSampleMaterial(materialWritePayload({ type: 'sample_essay', notes: 'craft' }, { forceLegacy: true })), true);

const record = parseIbRecord('Physics HL (7), English A: Literature SL (6), TOK predicted A, Extended Essay predicted B (Physics)');
assert.equal(record.subjects.length, IB_SLOTS.length);
assert.equal(IB_SLOTS.length, 6);
assert.equal(record.tok, 'A');
assert.equal(record.ee, 'B');
const round = parseIbRecord(serializeIbRecord(record));
assert.equal(round.tok, 'A');
assert.equal(round.eeSubject, 'Physics');
// The Extended Essay subject is a catalogue choice, like the six subjects.
assert.equal(round.eeCourse.courseId, 'physics');
const typedEe = parseIbRecord(serializeIbRecord({
  ...record,
  eeCourse: { courseId: 'custom', language: '', customName: 'Business Management & Arts' },
}));
assert.equal(typedEe.eeCourse.customName, 'Business Management & Arts');
assert.equal(typedEe.eeSubject, 'Business Management & Arts');
assert.equal(parseIbRecord('Extended Essay predicted C (Business management)').eeCourse.courseId, 'business');
assert.equal(suggestedDiplomaTotal({
  ...record,
  subjects: record.subjects.map((s, i) => (i < 6 ? { ...s, grade: s.grade || '6' } : s)),
}) !== undefined, true);

const profile = buildProfileContext({ gpa_value: '5.0', gpa_scale: '5.0' });
assert.match(profile, /on a 5.0 scale/);
assert.doesNotMatch(profile, /scale unspecified/);
const unspecified = buildProfileContext({ gpa_value: '3.9' });
assert.match(unspecified, /scale not specified/);

assert.equal(promptsForUniversity('University of Cambridge').length, 0);
assert.ok(promptsForUniversity('Harvard College').length >= 5);
assert.ok(promptsForUniversity('Massachusetts Institute of Technology').length >= 4);
const harvardChoices = fixedPromptChoices({
  platform: 'common_app',
  universityName: 'Harvard College',
  scope: 'university_specific',
});
assert.ok(harvardChoices.some((c) => /Harvard/.test(c.label)));
assert.equal(harvardChoices.some((c) => /Common App personal/.test(c.group)), false);

const generated = buildGeneratePrompt({
  essay: { title: 'UCAS Q1 — Motivation', prompt: ucas[0].prompt, content: '', application_platform: 'ucas', limit_unit: 'characters', word_limit: 4000, type: 'personal_statement' },
  university: { name: 'Oxford' },
  platform: 'ucas',
  profileText: '',
  knowledgeText: '',
  materialsText: materials,
  allEssays: [
    { title: 'UCAS Q1 — Motivation', prompt: ucas[0].prompt, content: '', application_platform: 'ucas' },
    { title: 'UCAS Q2 — Preparation', prompt: ucas[1].prompt, content: 'x'.repeat(2000), application_platform: 'ucas' },
    { title: 'UCAS Q3 — Beyond education', prompt: ucas[2].prompt, content: 'y'.repeat(1000), application_platform: 'ucas' },
  ],
});
assert.match(generated, /must stay within 1,000 characters/);
assert.match(generated, /NOT written by the applicant/);
assert.doesNotMatch(generated, /I grew up in Oslo[\s\S]*APPLICANT'S OWN/);

console.log('verify-fixes: ok');

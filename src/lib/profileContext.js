// One place that turns a Profile row into the text the AI actually reads.
//
// Before this, the essay generator, the AO review and the Knowledge Base each
// assembled their own string and each one forgot something — the AO review never
// saw the activities or honours, the essay writer never saw the honours, and
// nobody ever saw the IB subject breakdown properly. Every AI feature now
// builds its context from `buildProfileContext()` so they cannot drift apart.

import { serializeIbSubjects, parseIbSubjects } from './profileOptions';

const fmt = (v) => (v === null || v === undefined || v === '' ? null : String(v));

/** IB subjects: prefer the structured picker, fall back to parsing free text. */
export function ibSubjectLines(profile) {
  const raw = profile?.ib_subjects || '';
  if (!raw) return [];
  const parsed = parseIbSubjects(raw);
  return parsed.map((s) => {
    const level = s.level ? ` ${s.level}` : '';
    const grade = s.grade ? ` predicted ${s.grade}` : '';
    return `- ${s.name}${level}${grade}`;
  });
}

export function formatActivities(activities, oldText) {
  if (Array.isArray(activities) && activities.length > 0) {
    return activities
      .map((a, i) => {
        const grades = (a.grade_levels || []).join(', ');
        return `${i + 1}. ${a.position || 'Position not given'} at ${a.organization || 'Organisation not given'} [${a.activity_type || 'Unclassified'}]\n   What you did: ${a.description || 'No description given'}\n   Grades: ${grades || 'n/a'} | Timing: ${a.timing || 'n/a'} | ${a.hours_per_week ?? '?'} hrs/week, ${a.weeks_per_year ?? '?'} weeks/year`;
      })
      .join('\n');
  }
  return oldText || '';
}

export function formatHonors(honors) {
  if (Array.isArray(honors) && honors.length > 0) {
    return honors
      .map((h, i) => `${i + 1}. ${h.name || 'Unnamed'} — grade ${h.grade_level || '?'}, ${h.level || 'School'} level`)
      .join('\n');
  }
  return '';
}

/**
 * @param {object} profile            the Profile entity row
 * @param {object} [opts]
 * @param {boolean} [opts.includeLeadershipBrief] add a short instruction block
 * @returns {string} markdown-ish text for prompts (empty string when blank)
 */
export function buildProfileContext(profile, opts = {}) {
  const p = profile || {};
  const lines = [];

  const push = (label, value) => {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      lines.push(`${label}: ${String(value).trim()}`);
    }
  };

  push('Name or preferred name', p.full_name);
  push('Nationality / citizenship', p.nationality);
  push('Citizenship status', p.citizenship_status);
  push('School system', p.school_system);
  push('Curriculum', p.curriculum);
  push('Graduation year', p.graduation_year);
  push('First-generation university applicant', p.first_generation);

  // Academic record
  const academic = [];
  if (p.ib_predicted_score) academic.push(`IB predicted total: ${p.ib_predicted_score}/45`);
  if (p.gpa_value) academic.push(`GPA: ${p.gpa_value}${p.gpa_scale ? ` on a ${p.gpa_scale} scale` : ''} (scale unspecified)`);
  if (p.rank) academic.push(`Class rank: ${p.rank}`);
  const ibLines = ibSubjectLines(p);
  if (ibLines.length) {
    academic.push(`IB subjects (${ibLines.length} taken):\n${ibLines.join('\n')}`);
    const hl = ibLines.filter((l) => l.includes(' HL')).length;
    academic.push(`Higher Level subjects: ${hl}. This is the rigorous workload a US/UK reader needs to understand.`);
  }
  if (academic.length) lines.push(`ACADEMIC RECORD:\n${academic.join('\n')}`);

  // Tests
  const tests = [];
  if (p.sat_math || p.sat_ebrw) {
    tests.push(`SAT: Math ${p.sat_math ?? '?'}, Evidence-Based Reading & Writing ${p.sat_ebrw ?? '?'}, total ${(Number(p.sat_math) || 0) + (Number(p.sat_ebrw) || 0)}/1600`);
  } else if (p.act_score) {
    tests.push(`ACT: ${p.act_score}`);
  }
  if (p.ielts_listening || p.ielts_reading || p.ielts_writing || p.ielts_speaking) {
    const total = ['ielts_listening', 'ielts_reading', 'ielts_writing', 'ielts_speaking']
      .map((k) => Number(p[k]) || 0)
      .reduce((a, b) => a + b, 0) / 4;
    tests.push(`IELTS Academic: L${p.ielts_listening} R${p.ielts_reading} W${p.ielts_writing} S${p.ielts_speaking} (average ${total.toFixed(1)})`);
  } else if (p.toefl_total) {
    tests.push(`TOEFL iBT: ${p.toefl_total}`);
  }
  if (p.duolingo_english) tests.push(`Duolingo English Test: ${p.duolingo_english}`);
  if (p.test_policy) tests.push(`Test policy the student believes applies: ${p.test_policy}`);
  if (p.additional_test_info) tests.push(`Other test information:\n${p.additional_test_info}`);
  if (tests.length) lines.push(`STANDARDIZED / ENGLISH TESTS:\n${tests.join('\n')}`);

  // Activities + honours
  const activities = formatActivities(p.activities, p.activities_awards);
  if (activities) lines.push(`ACTIVITIES (Common App format):\n${activities}`);
  const honors = formatHonors(p.honors);
  if (honors) lines.push(`HONORS (Common App format):\n${honors}`);

  // Money
  const money = [];
  money.push(
    p.requires_financial_aid
      ? 'Requires need-based financial aid'
      : 'Does NOT require aid — full-pay applicant (this is an admissions ADVANTAGE at need-aware universities and should be reflected in the strategy)',
  );
  if (p.financial_aid_notes) money.push(p.financial_aid_notes);
  if (p.funding_source) money.push(`Funding source: ${p.funding_source}`);
  lines.push(`FINANCIAL AID:\n${money.join('\n')}`);

  // Narrative
  if (fmt(p.background_summary)) lines.push(`BACKGROUND AND IDENTITY:\n${p.background_summary}`);
  if (fmt(p.education_notes)) lines.push(`EDUCATION SYSTEM NOTES (how to read this transcript):\n${p.education_notes}`);
  if (fmt(p.additional_context)) lines.push(`ADDITIONAL CONTEXT:\n${p.additional_context}`);

  if (opts.includeLeadershipBrief) {
    lines.push(
      'NOTE FOR THE WRITER: the applicant is not a generic US student. Where the system they come from differs from US/UK conventions, say so plainly rather than pretending it does not — admissions readers reward a candidate who can explain their own context in one sentence.',
    );
  }

  return lines.join('\n\n');
}

export { serializeIbSubjects, parseIbSubjects };

// The IB Diploma Programme, as published by the IB (curriculum page current as of
// August 2026). Six subjects plus the core — not a free list of ten, and not a
// made-up subject catalogue.
//
// Sources:
//  - https://www.ibo.org/programmes/diploma-programme/curriculum/
//  - Language A: Literature is offered in 55 languages and, by special request,
//    in any language with a sufficient written literature.
//  - Language A: Language and Literature is offered in 17 languages.
//  - Literature and Performance is SL only (English automatically; Spanish and
//    French by request).
//  - Students take 3 or 4 subjects at HL. Four HL is allowed. The rest are SL.
//  - Group 6 may be replaced by an extra subject from groups 1–4.
//  - TOK and the Extended Essay are graded A–E, not 1–7, and together award 0–3
//    bonus points. An E in either is a failing condition for the diploma.
//  - CAS is required and is not graded.

export const IB_JSON_PREFIX = 'IBJSON:';

export const SUBJECT_GRADES = ['7', '6', '5', '4', '3', '2', '1'];
export const CORE_GRADES = ['A', 'B', 'C', 'D', 'E'];

// Official core points matrix. null = failing condition (diploma not awarded).
export const CORE_POINTS = {
  A: { A: 3, B: 3, C: 2, D: 2, E: null },
  B: { A: 3, B: 2, C: 2, D: 1, E: null },
  C: { A: 2, B: 2, C: 1, D: 0, E: null },
  D: { A: 2, B: 1, C: 0, D: 0, E: null },
  E: { A: null, B: null, C: null, D: null, E: null },
};

export const HL_MIN = 3;
export const HL_MAX = 4;

/** Languages Language A: Literature is automatically available in. Plus custom entry. */
export const LANGUAGE_A_LITERATURE = [
  'Albanian', 'Amharic', 'Arabic', 'Belarusian', 'Bengali', 'Bosnian', 'Bulgarian',
  'Catalan', 'Chinese', 'Croatian', 'Czech', 'Danish', 'Dutch', 'English', 'Estonian',
  'Filipino', 'Finnish', 'French', 'German', 'Hebrew', 'Hindi', 'Hungarian', 'Icelandic',
  'Indonesian', 'Italian', 'Japanese', 'Korean', 'Latvian', 'Lithuanian', 'Macedonian',
  'Malay', 'Modern Greek', 'Nepali', 'Norwegian', 'Persian', 'Polish', 'Portuguese',
  'Romanian', 'Russian', 'Serbian', 'Sesotho', 'Sinhala', 'Slovak', 'Slovene',
  'Spanish', 'Swahili', 'Swedish', 'Thai', 'Turkish', 'Ukrainian', 'Urdu',
  'Vietnamese', 'Welsh',
];

/** The 17 languages Language A: Language and Literature is offered in. */
export const LANGUAGE_A_LANG_LIT = [
  'Arabic', 'Chinese', 'Dutch', 'English', 'French', 'German', 'Modern Greek',
  'Indonesian', 'Italian', 'Japanese', 'Korean', 'Norwegian', 'Portuguese',
  'Russian', 'Spanish', 'Swedish', 'Thai',
];

export const LANGUAGE_B = [
  'Arabic', 'Chinese', 'Danish', 'Dutch', 'English', 'Finnish', 'French', 'German',
  'Hebrew', 'Hindi', 'Indonesian', 'Italian', 'Japanese', 'Korean', 'Malay',
  'Norwegian', 'Portuguese', 'Russian', 'Spanish', 'Swahili', 'Swedish', 'Tamil',
];

/** ab initio is SL only. English is not offered. */
export const LANGUAGE_AB_INITIO = [
  'Arabic', 'Danish', 'Dutch', 'French', 'German', 'Hebrew', 'Hindi', 'Italian',
  'Japanese', 'Mandarin', 'Russian', 'Spanish', 'Swahili', 'Swedish',
];

export const LITERATURE_PERFORMANCE_LANGUAGES = ['English', 'Spanish', 'French'];

const lang = (id, label, needsLanguage, levels, groups) => ({
  id, label, needsLanguage, levels, groups,
});

const plain = (id, label, groups, levels = ['HL', 'SL']) => ({
  id, label, needsLanguage: null, levels, groups,
});

export const IB_COURSES = [
  lang('lang_a_lit', 'Language A: Literature', 'lit', ['HL', 'SL'], [1]),
  lang('lang_a_ll', 'Language A: Language and Literature', 'll', ['HL', 'SL'], [1]),
  lang('lit_perf', 'Literature and Performance', 'perf', ['SL'], [1, 6]),
  lang('lang_b', 'Language B', 'b', ['HL', 'SL'], [2]),
  lang('ab_initio', 'Language ab initio', 'ab', ['SL'], [2]),
  plain('latin', 'Latin', [2]),
  plain('classical_greek', 'Classical Greek', [2]),
  plain('business', 'Business management', [3]),
  plain('digital_society', 'Digital society', [3]),
  plain('economics', 'Economics', [3]),
  plain('geography', 'Geography', [3]),
  plain('global_politics', 'Global politics', [3]),
  plain('history', 'History', [3]),
  plain('philosophy', 'Philosophy', [3]),
  plain('psychology', 'Psychology', [3]),
  plain('anthropology', 'Social and cultural anthropology', [3]),
  plain('world_religions', 'World religions', [3]),
  plain('ess', 'Environmental systems and societies', [3, 4]),
  plain('biology', 'Biology', [4]),
  plain('chemistry', 'Chemistry', [4]),
  plain('computer_science', 'Computer science', [4]),
  plain('design_technology', 'Design technology', [4]),
  plain('physics', 'Physics', [4]),
  plain('sehs', 'Sports, exercise and health science', [4]),
  plain('math_aa', 'Mathematics: analysis and approaches', [5]),
  plain('math_ai', 'Mathematics: applications and interpretation', [5]),
  plain('dance', 'Dance', [6]),
  plain('film', 'Film', [6]),
  plain('music', 'Music', [6]),
  plain('theatre', 'Theatre', [6]),
  plain('visual_arts', 'Visual arts', [6]),
  plain('custom', 'Not listed — type the subject my school offers', [1, 2, 3, 4, 5, 6]),
];

export const IB_SLOTS = [
  {
    id: '1',
    label: 'Subject 1',
    hint: 'Group 1 — Studies in language and literature. Required. Choose the course, then the language.',
    groups: [1],
  },
  {
    id: '2',
    label: 'Subject 2',
    hint: 'Group 2 — Language acquisition. A second Language A here is how a bilingual diploma is earned.',
    groups: [2, 1],
  },
  {
    id: '3',
    label: 'Subject 3',
    hint: 'Group 3 — Individuals and societies. Environmental systems and societies can count here or in Group 4.',
    groups: [3],
  },
  {
    id: '4',
    label: 'Subject 4',
    hint: 'Group 4 — Sciences.',
    groups: [4],
  },
  {
    id: '5',
    label: 'Subject 5',
    hint: 'Group 5 — Mathematics. Only Analysis and approaches, or Applications and interpretation.',
    groups: [5],
  },
  {
    id: '6',
    label: 'Subject 6',
    hint: 'Group 6 — The arts, or an extra subject from groups 1–4 instead of an arts subject.',
    groups: [6, 1, 2, 3, 4],
  },
];

export function languagesFor(needsLanguage) {
  if (needsLanguage === 'lit') return LANGUAGE_A_LITERATURE;
  if (needsLanguage === 'll') return LANGUAGE_A_LANG_LIT;
  if (needsLanguage === 'b') return LANGUAGE_B;
  if (needsLanguage === 'ab') return LANGUAGE_AB_INITIO;
  if (needsLanguage === 'perf') return LITERATURE_PERFORMANCE_LANGUAGES;
  return [];
}

export function coursesForGroups(groups) {
  const set = new Set(groups);
  return IB_COURSES.filter((c) => c.groups.some((g) => set.has(g)) && (c.id !== 'custom'));
}

export function courseById(id) {
  return IB_COURSES.find((c) => c.id === id) || null;
}

export function emptySubject(slotId) {
  return {
    slot: slotId,
    courseId: '',
    language: '',
    customName: '',
    level: '',
    grade: '',
  };
}

export function emptyIbRecord() {
  return {
    v: 1,
    diploma: true,
    subjects: IB_SLOTS.map((s) => emptySubject(s.id)),
    tok: '',
    ee: '',
    eeSubject: '',
    unplaced: [],
  };
}

export function subjectDisplayName(subject) {
  if (!subject) return '';
  if (subject.courseId === 'custom') return String(subject.customName || '').trim();
  const course = courseById(subject.courseId);
  if (!course) return String(subject.customName || subject.name || '').trim();
  const language = String(subject.language || '').trim();
  if (course.id === 'lang_a_lit') return language ? `${language} A: Literature` : '';
  if (course.id === 'lang_a_ll') return language ? `${language} A: Language and Literature` : '';
  if (course.id === 'lit_perf') return language ? `Literature and Performance (${language})` : 'Literature and Performance';
  if (course.id === 'lang_b') return language ? `${language} B` : '';
  if (course.id === 'ab_initio') return language ? `${language} ab initio` : '';
  return course.label;
}

export function corePoints(tok, ee) {
  if (!tok || !ee) return { points: null, failing: false, complete: false };
  const row = CORE_POINTS[tok];
  if (!row || !(ee in row)) return { points: null, failing: false, complete: false };
  const points = row[ee];
  return { points, failing: points === null, complete: true };
}

export function subjectPointSum(record) {
  const grades = (record?.subjects || [])
    .map((s) => Number(s.grade))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  if (!grades.length) return null;
  return grades.reduce((a, b) => a + b, 0);
}

/** Suggested /45 from filled subject predictions plus the TOK/EE matrix. */
export function suggestedDiplomaTotal(record) {
  const subjects = (record?.subjects || []).filter((s) => subjectDisplayName(s));
  const grades = subjects.map((s) => s.grade).filter((g) => SUBJECT_GRADES.includes(g));
  if (grades.length !== 6) return null;
  const core = corePoints(record.tok, record.ee);
  if (!core.complete || core.failing) return null;
  return grades.reduce((a, g) => a + Number(g), 0) + core.points;
}

export function hlCount(record) {
  return (record?.subjects || []).filter((s) => s.level === 'HL' && subjectDisplayName(s)).length;
}

export function filledSubjects(record) {
  return (record?.subjects || []).filter((s) => subjectDisplayName(s));
}

function normalizeSubject(raw, slotId) {
  const courseId = String(raw?.courseId || '');
  const course = courseById(courseId);
  let level = String(raw?.level || '').toUpperCase();
  if (level !== 'HL' && level !== 'SL') level = '';
  if (course && !course.levels.includes(level)) level = course.levels.length === 1 ? course.levels[0] : level;
  if (course && !course.levels.includes(level)) level = '';
  const grade = SUBJECT_GRADES.includes(String(raw?.grade || '')) ? String(raw.grade) : '';
  return {
    slot: slotId,
    courseId: course ? courseId : (courseId === 'custom' ? 'custom' : ''),
    language: String(raw?.language || '').trim(),
    customName: String(raw?.customName || '').trim(),
    level,
    grade,
  };
}

function normalizeRecord(raw) {
  const base = emptyIbRecord();
  const bySlot = new Map((raw?.subjects || []).map((s) => [String(s.slot), s]));
  return {
    v: 1,
    diploma: raw?.diploma !== false,
    subjects: IB_SLOTS.map((slot) => normalizeSubject(bySlot.get(slot.id) || {}, slot.id)),
    tok: CORE_GRADES.includes(raw?.tok) ? raw.tok : '',
    ee: CORE_GRADES.includes(raw?.ee) ? raw.ee : '',
    eeSubject: String(raw?.eeSubject || '').trim(),
    unplaced: Array.isArray(raw?.unplaced) ? raw.unplaced.map((s) => String(s)).filter(Boolean) : [],
  };
}

function legacyParts(text) {
  return String(text || '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^TOK\b/i.test(part) || /^EE\b/i.test(part) || /^Extended Essay\b/i.test(part)) return null;
      const gradeMatch = part.match(/\(([^()]*)\)\s*$/);
      const gradeRaw = gradeMatch ? gradeMatch[1].replace(/predicted\s*/i, '').trim() : '';
      const grade = SUBJECT_GRADES.includes(gradeRaw) ? gradeRaw : '';
      const core = (gradeMatch ? part.slice(0, gradeMatch.index) : part).trim();
      const levelMatch = core.match(/\b(HL|SL)\b/i);
      const level = levelMatch ? levelMatch[1].toUpperCase() : '';
      const name = core.replace(/\b(HL|SL)\b/gi, '').replace(/\s+/g, ' ').trim();
      if (!name) return null;
      return { name, level, grade };
    })
    .filter(Boolean);
}

function inferCourse(name) {
  const n = name.toLowerCase();
  const langLit = n.match(/^(.+?)\s+a:\s*language and literature$/i);
  if (langLit) return { courseId: 'lang_a_ll', language: langLit[1] };
  const lit = n.match(/^(.+?)\s+a:\s*literature$/i);
  if (lit) return { courseId: 'lang_a_lit', language: lit[1] };
  if (/literature and performance/.test(n)) {
    const lang = n.match(/\(([^)]+)\)/);
    return { courseId: 'lit_perf', language: lang ? lang[1] : '' };
  }
  const b = n.match(/^(.+?)\s+b$/i);
  if (b) return { courseId: 'lang_b', language: b[1] };
  const ab = n.match(/^(.+?)\s+ab initio$/i);
  if (ab) return { courseId: 'ab_initio', language: ab[1] };
  const known = IB_COURSES.find((c) => c.label.toLowerCase() === n);
  if (known) return { courseId: known.id, language: '' };
  if (/\b(math|mathematics).*(analysis|aa)\b/.test(n)) return { courseId: 'math_aa', language: '' };
  if (/\b(math|mathematics).*(application|ai)\b/.test(n)) return { courseId: 'math_ai', language: '' };
  if (n === 'mathematics' || n === 'math') return { courseId: 'math_aa', language: '' };
  return { courseId: 'custom', language: '', customName: name };
}

function placeLegacy(text) {
  const record = emptyIbRecord();
  const tok = String(text).match(/TOK(?:\s+predicted)?\s+([A-E])/i);
  const ee = String(text).match(/(?:EE|Extended Essay)(?:\s+predicted)?\s+([A-E])(?:\s*\(([^)]+)\))?/i);
  if (tok) record.tok = tok[1].toUpperCase();
  if (ee) {
    record.ee = ee[1].toUpperCase();
    record.eeSubject = ee[2] ? ee[2].trim() : '';
  }
  const used = new Set();
  for (const item of legacyParts(text)) {
    const inferred = inferCourse(item.name);
    const course = courseById(inferred.courseId);
    const groups = course ? course.groups : [1, 2, 3, 4, 5, 6];
    const slot = IB_SLOTS.find((s) => !used.has(s.id) && s.groups.some((g) => groups.includes(g)));
    if (!slot) {
      record.unplaced.push(`${item.name}${item.level ? ` ${item.level}` : ''}${item.grade ? ` (${item.grade})` : ''}`);
      continue;
    }
    used.add(slot.id);
    const idx = record.subjects.findIndex((s) => s.slot === slot.id);
    record.subjects[idx] = normalizeSubject({
      slot: slot.id,
      courseId: inferred.courseId,
      language: inferred.language || '',
      customName: inferred.customName || (inferred.courseId === 'custom' ? item.name : ''),
      level: item.level,
      grade: item.grade,
    }, slot.id);
  }
  return normalizeRecord(record);
}

export function parseIbRecord(text) {
  const raw = String(text || '').trim();
  if (!raw) return emptyIbRecord();
  if (raw.startsWith(IB_JSON_PREFIX)) {
    try {
      return normalizeRecord(JSON.parse(raw.slice(IB_JSON_PREFIX.length)));
    } catch {
      return placeLegacy(raw);
    }
  }
  return placeLegacy(raw);
}

export function serializeIbRecord(record) {
  return `${IB_JSON_PREFIX}${JSON.stringify(normalizeRecord(record))}`;
}

/** Readable lines for the AI. Predicted grades are labelled as predictions. */
export function ibRecordLines(record) {
  const parsed = record?.subjects ? normalizeRecord(record) : parseIbRecord(record);
  const lines = [];
  for (const subject of parsed.subjects) {
    const name = subjectDisplayName(subject);
    if (!name) continue;
    const slot = IB_SLOTS.find((s) => s.id === subject.slot);
    const level = subject.level ? ` ${subject.level}` : ' (level not set)';
    const grade = subject.grade ? `, predicted grade ${subject.grade}/7` : ', predicted grade not entered';
    lines.push(`- ${name}${level}${grade}${slot ? ` — ${slot.hint.split('.')[0]}` : ''}`);
  }
  for (const extra of parsed.unplaced) lines.push(`- ${extra} (imported; not placed in a diploma slot)`);
  if (parsed.tok) lines.push(`- Theory of Knowledge predicted grade ${parsed.tok} (A–E, not a 1–7 subject grade)`);
  else lines.push('- Theory of Knowledge predicted grade not entered');
  if (parsed.ee) {
    lines.push(`- Extended Essay predicted grade ${parsed.ee}${parsed.eeSubject ? ` in ${parsed.eeSubject}` : ''} (A–E)`);
  } else {
    lines.push('- Extended Essay predicted grade not entered');
  }
  const core = corePoints(parsed.tok, parsed.ee);
  if (core.complete) {
    lines.push(core.failing
      ? '- TOK/EE combination is a failing condition for the diploma (an E in either component).'
      : `- TOK/EE bonus points from the official matrix: ${core.points} of 3.`);
  }
  const hl = hlCount(parsed);
  const filled = filledSubjects(parsed).length;
  if (filled) {
    lines.push(`- Higher Level subjects: ${hl}. The diploma allows 3 or 4 HL (4 is permitted; more than 4 is not).`);
  }
  const suggested = suggestedDiplomaTotal(parsed);
  if (suggested != null) {
    lines.push(`- Suggested diploma total from these predictions: ${suggested}/45 (42 from six subjects + up to 3 from TOK/EE).`);
  }
  if (parsed.diploma === false) {
    lines.push('- Student marked this as course certificates, not the full diploma.');
  }
  return lines;
}

export function ibWarnings(record) {
  const parsed = record?.subjects ? normalizeRecord(record) : parseIbRecord(record);
  const warnings = [];
  const filled = filledSubjects(parsed);
  const hl = hlCount(parsed);
  if (hl > HL_MAX) warnings.push(`You have ${hl} Higher Level subjects. The diploma allows at most 4.`);
  if (parsed.diploma && filled.length === 6 && hl > 0 && hl < HL_MIN) {
    warnings.push('A full diploma needs at least 3 Higher Level subjects. 4 HL is allowed; fewer than 3 is not.');
  }
  const names = filled.map(subjectDisplayName);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length) warnings.push(`The same subject is selected twice: ${[...new Set(dupes)].join(', ')}.`);
  const essCount = filled.filter((s) => s.courseId === 'ess').length;
  if (essCount > 1) warnings.push('Environmental systems and societies is one subject. It can meet Group 3 or Group 4, not both slots.');
  for (const subject of filled) {
    const course = courseById(subject.courseId);
    if (course?.needsLanguage && !subject.language) {
      warnings.push(`${course.label} needs a language. Pick one, or type it if it is not in the list.`);
    }
    if (course && subject.level && !course.levels.includes(subject.level)) {
      warnings.push(`${subjectDisplayName(subject)} is only offered at ${course.levels.join('/')}.`);
    }
  }
  return warnings;
}

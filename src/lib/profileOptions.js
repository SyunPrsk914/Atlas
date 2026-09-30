// ---------------------------------------------------------------------------
// Atlas — profile reference data.
//
// The Profile page was almost entirely free text, which is slow to fill in and
// error-prone for the AI (it has to guess "Physics HL" vs "physics higher
// level"). These are the choices that genuinely have a fixed set of valid
// answers, so they become dropdowns / pickers. Free writing is kept only where
// the applicant genuinely has to write something.
//
// Nothing here needs a database migration: the chosen values are serialised
// into the existing `profiles` columns (`ib_subjects`, `gpa_scale`,
// `nationality`), which is what the AI already reads.
// ---------------------------------------------------------------------------

// --- Nationality ------------------------------------------------------------
export const NATIONALITIES = [
  'American', 'Australian', 'Brazilian', 'British', 'Canadian', 'Chinese',
  'Dutch', 'French', 'German', 'Hong Kong', 'Indian', 'Indonesian',
  'Irish', 'Italian', 'Japanese', 'Kenyan', 'Korean', 'Malaysian',
  'Mexican', 'Nigerian', 'New Zealand', 'Pakistani', 'Philippine',
  'Portuguese', 'Russian', 'Saudi', 'Singapore', 'South African', 'Spanish',
  'Swedish', 'Swiss', 'Taiwanese', 'Thai', 'Turkish', 'Ukrainian',
  'Vietnamese', 'Other',
];

// --- School systems ---------------------------------------------------------
// Values match the CHECK constraint on `profiles.school_system` exactly.
export const SCHOOL_SYSTEMS = [
  { value: 'IB World School', label: 'IB World School' },
  { value: 'Japanese Public', label: 'Japan — public school' },
  { value: 'Japanese Private', label: 'Japan — private school' },
  { value: 'US', label: 'United States' },
  { value: 'UK', label: 'United Kingdom' },
  { value: 'Other', label: 'Other / international' },
];

// --- Grading scales ---------------------------------------------------------
// Choosing the scale lets every number in the application be read correctly by
// a US or UK admissions reader, which is a whole class of avoidable mistakes.
export const GPA_SCALES = [
  { value: '4.0', label: '4.0 (US weighted)', max: 4.0 },
  { value: '4.3', label: '4.3 (US weighted, recalculated)', max: 4.3 },
  { value: '5.0', label: '5.0', max: 5.0 },
  { value: '5.3', label: '5.3', max: 5.3 },
  { value: '10', label: '10 (many national systems)', max: 10 },
  { value: '20', label: '20 (IB MYP / some systems)', max: 20 },
  { value: '100', label: '100 (percentage)', max: 100 },
  { value: 'Other', label: 'Other / unweighted', max: null },
];

// --- IB Diploma subjects ----------------------------------------------------
// Grouped per the IB Diploma Programme subject groups. Each entry is
// `[name, group]`. Keeping the official IB wording matters: admissions readers
// and the Common App both expect the subject exactly as the school reports it.
export const IB_SUBJECT_GROUPS = [
  {
    group: 1,
    label: 'Group 1 — Studies in Language & Literature',
    subjects: [
      'Language A: Literature (or Language A: Language and Literature)',
      'Language A: Language and Literature',
      'Languages (Literature) — other',
    ],
  },
  {
    group: 2,
    label: 'Group 2 — Languages',
    subjects: [
      'Language B (any language)',
      'Language B: Business',
      'Ab initio (any language)',
    ],
  },
  {
    group: 3,
    label: 'Group 3 — Individuals and Societies',
    subjects: [
      'Business Management', 'Digital Society', 'Economics', 'Geography',
      'History', 'Human Geography', 'Psychology', 'Social Studies',
      'World History', 'Philosophy', 'Political Science', 'Sociology',
    ],
  },
  {
    group: 4,
    label: 'Group 4 — Sciences',
    subjects: [
      'Biology', 'Chemistry', 'Computer Science', 'Design Technology',
      'Earth and Space Sciences', 'Environmental Systems and Societies',
      'Physics', 'Science (single award)', 'Sports Science',
    ],
  },
  {
    group: 5,
    label: 'Group 5 — Mathematics',
    subjects: ['Mathematics', 'Mathematics: Analysis and Approaches', 'Mathematics: Applications and Interpretation', 'Further Mathematics'],
  },
  {
    group: 6,
    label: 'Group 6 — Arts',
    subjects: [
      'Dance', 'Design', 'Drama', 'Film', 'Music', 'Theatre Arts', 'Visual Arts',
    ],
  },
  {
    group: 7,
    label: 'Group 7 — Interdisciplinary',
    subjects: ['Environmental Systems and Societies', 'World History', 'Social Studies', 'Science (single award)'],
  },
  {
    group: 8,
    label: 'Additional subjects / electives',
    subjects: [
      'Additional Mathematics', 'Psychology (SL only in some regions)',
      'Human Genetics (HL)', 'Marine Science (SL)', 'Astronomy (SL)',
      'Entrepreneurship (SL)', 'Digital Design (SL)', 'God (HL)',
    ],
  },
];

export const ALL_IB_SUBJECTS = IB_SUBJECT_GROUPS.flatMap((g) => g.subjects);

export const IB_LEVELS = ['HL', 'SL'];
export const IB_PREDICTED_GRADES = ['7', '6', '5', '4', '3', '2', '1', 'EE'];

// Common App orders activities by commitment; these labels are what the essay
// writer needs when describing a subject load.
export const SUBJECT_SUMMARY_TEMPLATE = (subjects = []) => subjects
  .map((s) => `${s.name} ${s.level}${s.grade ? ` (predicted ${s.grade})` : ''}`)
  .join(', ');

// --- Serialisation ----------------------------------------------------------
// `profiles.ib_subjects` is a text column. We write a readable, parseable
// string: "Physics HL (7), Chemistry HL (6), Japanese A: Literature SL (6)".
// parseIbSubjects() understands both that format and the free text students
// typed before this picker existed, so nothing is ever lost on upgrade.

export function serializeIbSubjects(subjects = []) {
  return subjects
    .filter((s) => s && s.name)
    .map((s) => {
      const level = s.level ? ` ${s.level}` : '';
      const grade = s.grade ? ` (${s.grade})` : '';
      return `${s.name}${level}${grade}`;
    })
    .join(', ');
}

/**
 * Best-effort parse of a free-text IB subject list.
 * Handles "Physics HL, Math AA HL, Japanese A Lit SL" and "Biology HL (7)".
 */
export function parseIbSubjects(text) {
  if (!text) return [];
  return String(text)
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const gradeMatch = part.match(/\(([^()]*)\)\s*$/);
      const grade = gradeMatch ? gradeMatch[1].trim() : '';
      const core = (gradeMatch ? part.slice(0, gradeMatch.index) : part).trim();
      const levelMatch = core.match(/\b(HL|SL)\b/i);
      const level = levelMatch ? levelMatch[1].toUpperCase() : '';
      const name = core
        .replace(/\b(HL|SL)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!name) return null;
      return { name, level, grade: IB_PREDICTED_GRADES.includes(grade) ? grade : '' };
    })
    .filter(Boolean);
}

export function findSubjectGroup(name) {
  const key = String(name || '').toLowerCase();
  for (const g of IB_SUBJECT_GROUPS) {
    if (g.subjects.some((s) => s.toLowerCase() === key)) return g;
  }
  return null;
}

// --- Test scores ------------------------------------------------------------
export const TEST_POLICIES = [
  'Required',
  'Test optional (may omit scores)',
  'Test optional for applicants who do not need aid',
  'Never required',
  'Not sure yet',
];

// --- International-student context ------------------------------------------
// These are the details a US/UK admissions reader needs but which applicants
// routinely leave out — they change how the whole file is read.
export const CITIZENSHIP_STATUSES = [
  'Citizen / domestic',
  'Permanent resident',
  'Temporary visa (student)',
  'Dependent visa',
  'Asylum seeker / refugee',
  'Undocumented / other',
];

export const CURRICULUM_TYPES = [
  'IB Diploma Programme',
  'IB Middle Years Programme (MYP)',
  'AP / US high school',
  'A-levels',
  'National curriculum (no IB/AP/A-level)',
  'Other international',
];

export const FIRST_GENERATION_OPTIONS = ['Yes', 'No', 'Prefer not to say'];

export const SUPPORT_TYPES = [
  'None',
  'Fee-paying / full-pay (no aid needed)',
  'Need-based aid',
  ' merit scholarships only',
];

// --- International applicant money context ----------------------------------
export const FUNDING_SOURCES = [
  'Family / self funded',
  'Government scholarship',
  'Employer sponsorship',
  'Mixed family + scholarship',
  'Undecided',
];

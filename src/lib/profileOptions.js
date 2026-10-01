import { parseIbRecord, subjectDisplayName } from './ibDiploma';

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

// IB subject data, predicted grades, and serialisation live in ibDiploma.js.
// Re-exported here so older imports keep working.
export {
  IB_COURSES,
  IB_SLOTS,
  SUBJECT_GRADES as IB_PREDICTED_GRADES,
  CORE_GRADES,
  parseIbRecord,
  serializeIbRecord,
  subjectDisplayName,
  ibRecordLines,
  suggestedDiplomaTotal,
  hlCount,
} from './ibDiploma';

export const IB_LEVELS = ['HL', 'SL'];

/** @deprecated Use parseIbRecord. Kept so older callers still receive a list. */
export function parseIbSubjects(text) {
  return parseIbRecord(text).subjects
    .map((subject) => {
      const name = subjectDisplayName(subject);
      if (!name) return null;
      return { name, level: subject.level || '', grade: subject.grade || '' };
    })
    .filter(Boolean);
}

/** @deprecated Use serializeIbRecord. */
export function serializeIbSubjects(subjects = []) {
  // Only used if something still passes the old {name, level, grade} list.
  // The profile page now stores the structured record directly.
  if (!Array.isArray(subjects)) return '';
  return subjects
    .filter((s) => s && (s.name || s.customName))
    .map((s) => {
      const name = s.name || s.customName;
      const level = s.level ? ` ${s.level}` : '';
      const grade = s.grade ? ` (predicted ${s.grade})` : '';
      return `${name}${level}${grade}`;
    })
    .join(', ');
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
  'Merit scholarships only',
];

// --- International applicant money context ----------------------------------
export const FUNDING_SOURCES = [
  'Family / self funded',
  'Government scholarship',
  'Employer sponsorship',
  'Mixed family + scholarship',
  'Undecided',
];

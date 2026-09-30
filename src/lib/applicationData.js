// ---------------------------------------------------------------------------
// Atlas — application-system reference data.
//
// Everything here is researched, sourced, and deliberately kept OUT of the UI
// components so the rules live in exactly one place:
//
//  * Which universities accept which application platform. This drives whether
//    a "shared" essay is shared with that school or not.
//  * What the current cycle's required essays actually are — the 2026-27
//    prompts (for Fall 2027 entry), each with its real word/character limit and
//    the role the prompt plays in the review.
//  * How UK/UCAS applications work: ONE statement, three set questions, 4,000
//    characters shared across all course choices.
//
// SOURCES (verified Sept 2026, for 2026-27 cycle / Fall 2027 entry)
//  - Common App essay prompts: commonapp.org (7 prompts, 250-650 words,
//    unchanged from 2025-26; announced 27 Feb 2026).
//  - UC Personal Insight Questions: admission.universityofcalifornia.edu
//    (8 questions, answer exactly 4, 350 words each, same 4 for all campuses).
//  - UCAS personal statement: ucas.com ("writing your personal statement for
//    2026 entry onwards" — 3 set questions, 4,000 characters total including
//    spaces, 350 characters minimum per answer, one statement for all choices).
//  - UCAS 2027 deadlines: 15 Oct 2026 (Oxbridge + medicine/dentistry/veterinary),
//    13 Jan 2027 (everything else).
//  - Platform membership: UC system and MIT do not use the Common App.
// ---------------------------------------------------------------------------

export const APPLICATION_CYCLES = [
  { value: '2027', label: '2026-27 (Fall 2027 entry)' },
  { value: '2028', label: '2027-28 (Fall 2028 entry)' },
];

export const CURRENT_CYCLE = '2026-27 (Fall 2027 entry)';

// ---------------------------------------------------------------------------
// Platforms
// ---------------------------------------------------------------------------
export const PLATFORMS = {
  common_app: {
    value: 'common_app',
    label: 'Common Application',
    short: 'Common App',
    countries: ['US'],
    sharedEssays: true,
    sharedNote:
      'One personal statement is sent to every Common App school on your list — you never write it twice.',
    groundingNote:
      'Internet grounding is available with Gemini, which is also the only provider that can verify deadlines live.',
  },
  uc: {
    value: 'uc',
    label: 'UC Application',
    short: 'UC',
    countries: ['US'],
    sharedEssays: true,
    sharedNote:
      'One application covers all nine campuses. The same four Personal Insight Questions go to every campus you pick.',
    groundingNote: null,
  },
  ucas: {
    value: 'ucas',
    label: 'UCAS',
    short: 'UCAS',
    countries: ['UK'],
    sharedEssays: true,
    sharedNote:
      'UCAS sends ONE personal statement to all of your course choices. Same wording everywhere — never name a university.',
    groundingNote: null,
  },
  coalition: {
    value: 'coalition',
    label: 'Coalition Application',
    short: 'Coalition',
    countries: ['US'],
    sharedEssays: true,
    sharedNote: 'One Coalition profile is shared across Coalition member schools.',
    groundingNote: null,
  },
  direct: {
    value: 'direct',
    label: "University's own application",
    short: 'Direct',
    countries: ['US', 'UK'],
    sharedEssays: false,
    sharedNote:
      'This university runs its own portal, so every essay is written specifically for it.',
    groundingNote: null,
  },
  other: {
    value: 'other',
    label: 'Other / state system',
    short: 'Other',
    countries: ['US', 'UK'],
    sharedEssays: false,
    sharedNote: 'No shared application — each school is handled individually.',
    groundingNote: null,
  },
};

export const PLATFORM_LABELS = Object.fromEntries(
  Object.entries(PLATFORMS).map(([k, v]) => [k, v.label]),
);

export const PLATFORM_VALUES = Object.keys(PLATFORMS);

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

// Universities known NOT to accept the Common App (as of the 2026-27 cycle).
const DIRECT_PATTERNS = [
  /\bmit\b|mit\s+institute|massachusetts institute/i,
  /\buc\s|b\.?a\.?r\.?k\.?e\.?l|berkeley|ucla|ucsd|uc davis|uci\b|uc riverside|uc santa/i,
  /university of california/i,
  /\but\s?austin|texas a&m|applytexas/i,
  /west point|naval academy|air force academy|service academy/i,
  /\bbyu\b|brigham young/i,
  /\bcaltech\b|california institute of technology/i,
  /questbridge/i,
];

const COALITION_PATTERNS = [/\bcoalition\b/i];

/**
 * Resolve the application platform for a university.
 * An explicit `application_platform` always wins; otherwise we fall back to
 * name matching, then to the country default. Never returns undefined.
 */
export function getUniversityPlatform(university) {
  if (!university) return 'common_app';
  const explicit = university.application_platform;
  if (explicit && PLATFORMS[explicit]) return explicit;

  if (university.country === 'UK') return 'ucas';

  const name = String(university.name || '');
  if (DIRECT_PATTERNS.some((re) => re.test(name))) return 'direct';
  if (COALITION_PATTERNS.some((re) => re.test(name))) return 'coalition';
  return 'common_app';
}

export function doesPlatformShareEssays(platform) {
  return !!PLATFORMS[platform]?.sharedEssays;
}

// ---------------------------------------------------------------------------
// The 2026-27 Common Application prompts (unchanged from 2025-26)
// ---------------------------------------------------------------------------
export const COMMON_APP_PROMPTS = [
  {
    key: 'ca1',
    number: 1,
    label: 'Background, identity, interest, or talent',
    share: 18,
    text: 'Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story.',
    role: 'Reveals the one thing about you the rest of the application cannot show. Use it when your defining quality is invisible elsewhere — a language you grew up in, a role in the family business, a cultural practice nobody outside your home would guess.',
    watchOut: 'Only use this if the rest of your application genuinely does not show it. Admissions readers compare your essay with your activity list, and a mismatch reads as a stretch.',
  },
  {
    key: 'ca2',
    number: 2,
    label: 'Facing adversity',
    share: 23,
    text: 'The lessons we take from obstacles we encounter can be fundamental to later success. Recount a time when you faced a challenge, setback, or failure. How did it affect you, and what did you learn from the experience?',
    role: 'Shows how you respond when things go wrong. The obstacle matters far less than the change in you afterwards — spend most of your words on the after, not the event.',
    watchOut: 'Do not turn it into a résumé of suffering. The story is the shift in how you think, not the difficulty itself.',
  },
  {
    key: 'ca3',
    number: 3,
    label: 'Questioning a belief',
    share: 3,
    text: 'Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking? What was the outcome?',
    role: 'Tests whether you think for yourself. Very few applicants use it, so a strong answer here stands out from thousands of similar ones.',
    watchOut: 'Pick a belief you actually hold or genuinely tested. Debating a position for a class does not count as questioning it.',
  },
  {
    key: 'ca4',
    number: 4,
    label: 'Gratitude',
    share: 3,
    text: 'Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. How has this gratitude affected or motivated you?',
    role: 'Asks who shaped you and what you did with what they gave you. Least-used prompt in the cycle, so it is unusually hard to write like everyone else.',
    watchOut: 'Avoid gratitude as a wrapper for the same adversity story you would tell for prompt 2. Pick a different relationship entirely.',
  },
  {
    key: 'ca5',
    number: 5,
    label: 'Personal growth',
    share: 20,
    text: 'Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.',
    role: 'The moment something clicked and what shifted afterwards. Half the words should be on the realization, not the achievement.',
    watchOut: 'The humble-brag failure mode: an award with no genuine pivot. Admissions readers can tell when the accomplishment is the point rather than the doorway.',
  },
  {
    key: 'ca6',
    number: 6,
    label: 'Intellectual curiosity',
    share: 5,
    text: 'Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time. Why does it captivate you? What or who do you turn to when you want to learn more?',
    role: 'Names the thing you nerd out about and proves it with depth. Strong fit for a specific technical or academic obsession, even if that is not your declared major.',
    watchOut: 'Breadth is not depth. One obsession explored concretely beats a paragraph listing five unrelated interests.',
  },
  {
    key: 'ca7',
    number: 7,
    label: 'Topic of your choice',
    share: 28,
    text: 'Share an essay on any topic of your choice. It can be one you have already written, one that responds to a different prompt, or one of your own design.',
    role: 'The most-chosen prompt in the cycle (28%). It exists so a strong story is never squeezed into a prompt that does not fit it.',
    watchOut: 'It is not the escape hatch for indecision. Choose it when your story is strong and specific but does not fit prompts 1-6 — not because you could not decide.',
  },
];

export const COMMON_APP_PERSONAL_STATEMENT = {
  title: 'Common App Personal Statement',
  minWords: 250,
  maxWords: 650,
  unit: 'words',
  platform: 'common_app',
  scope: 'common',
  type: 'personal_statement',
  role:
    'The single most-read essay in a US application. It is sent identically to every Common App school on your list, so it must stand on its own with no school-specific content — no names, no "why your campus", no callbacks to supplements.',
};

export const COMMON_APP_AUXILIARY = [
  {
    key: 'ca_additional_info',
    title: 'Additional Information',
    unit: 'words',
    limit: 300,
    type: 'other',
    prompt:
      'In addition to the personal essay, use this space for anything else that is important: a gap year, a change of name, a health or family circumstance, a project you would like to explain. Shared with every Common App school.',
    role: 'Context, not storytelling. Anything you add here is read after the personal statement and only matters if it changes how the rest of the file is read.',
  },
  {
    key: 'ca_challenges',
    title: 'Challenges and Circumstances',
    unit: 'words',
    limit: 250,
    type: 'other',
    prompt:
      'If there has been a significant personal, academic, or work challenge that has affected your work or activities, you may discuss it here. Shared with every Common App school.',
    role: 'Reserved for exceptional circumstances. Most applicants should leave this empty — using it without a genuine reason can read as an appeal for sympathy.',
  },
];

// ---------------------------------------------------------------------------
// The University of California Personal Insight Questions (8, answer 4)
// ---------------------------------------------------------------------------
export const UC_PIQS = [
  {
    key: 'uc1',
    number: 1,
    theme: 'Leadership',
    limit: 350,
    prompt:
      'Describe an example of your leadership experience in which you have positively influenced others, helped resolve disputes, or contributed to group efforts over time.',
    role: 'Leadership without a title. Mentoring, settling a dispute, or taking charge at home all count. UC wants the influence you had on other people, not the title you held.',
  },
  {
    key: 'uc2',
    number: 2,
    theme: 'Creativity',
    limit: 350,
    prompt:
      'Every person has a creative side, and it can be expressed in many ways: problem solving, original and innovative thinking, and artistically, to name a few. How does your creativity influence your decisions inside or outside the classroom?',
    role: 'UC explicitly puts problem solving first — this is not an art essay. Show the creative process, then connect it to how you actually make decisions.',
  },
  {
    key: 'uc3',
    number: 3,
    theme: 'Talent or skill',
    limit: 350,
    prompt:
      'What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?',
    role: 'Two questions in one: name the skill, then prove development and demonstration. Awards are optional — why it matters to you is not.',
  },
  {
    key: 'uc4',
    number: 4,
    theme: 'Educational opportunity or barrier',
    limit: 350,
    prompt:
      'Describe how you have taken advantage of a significant educational opportunity or worked to overcome an educational barrier you have faced.',
    role: 'Opportunities count as well as barriers: a special programme, a research placement, a self-designed course. This is where an international or non-traditional applicant explains context.',
  },
  {
    key: 'uc5',
    number: 5,
    theme: 'Challenge',
    limit: 350,
    prompt:
      'Describe the most significant challenge you have faced and the steps you have taken to overcome this challenge. How has this challenge affected your academic achievement?',
    role: 'The challenge has to be connected to your ACADEMICS. The second half of the question — how it affected your academic achievement — is what UC is grading, and answers that skip it score poorly.',
  },
  {
    key: 'uc6',
    number: 6,
    theme: 'Inspiring academic subject',
    limit: 350,
    prompt:
      'Think about an academic subject that inspires you. Describe how you have furthered this interest inside and/or outside of the classroom.',
    role: 'The subject does not have to be your proposed major. "Inside and/or outside" means either setting can carry the evidence — reading, a competition, a project, a teacher.',
  },
  {
    key: 'uc7',
    number: 7,
    theme: 'Community',
    limit: 350,
    prompt:
      'What have you done to make your school or your community a better place?',
    role: 'UC wants the change, not the attendance. "Community" is yours to define — school, faith group, sport, neighbourhood, online space — as long as your role in it is clear.',
  },
  {
    key: 'uc8',
    number: 8,
    theme: 'Strong candidate',
    limit: 350,
    prompt:
      'Beyond what has already been shared in your application, what do you believe makes you a strong candidate for admissions to the University of California?',
    role: 'The wildcard. Best used for the thing that genuinely has nowhere else to go. Resist the urge to use it as a second "what makes you special" answer.',
  },
];

export const UC_RULES = {
  pick: 4,
  of: 8,
  limit: 350,
  unit: 'words',
  note:
    'The same four answers go to every UC campus you select. Berkeley does not get a rewrite — UC reviews one application with campus choices inside it.',
};

// ---------------------------------------------------------------------------
// UCAS — 2026 entry onwards (so: 2027 entry too)
// ---------------------------------------------------------------------------
export const UCAS_QUESTIONS = [
  {
    key: 'ucas1',
    number: 1,
    label: 'Why this course?',
    minChars: 350,
    suggestedShare: '40-50% of the statement',
    prompt: 'Why do you want to study this course or subject?',
    role: 'Informed motivation, not a recap of what you already study. A specific book, question, problem, or moment that created the interest — and what you now want to interrogate about it.',
  },
  {
    key: 'ucas2',
    number: 2,
    label: 'Academic preparation',
    minChars: 350,
    suggestedShare: '20-35% of the statement',
    prompt: 'How have your qualifications and studies helped you to prepare for this course or subject?',
    role: 'Academic readiness. Tie your IB / A-level / other qualifications and any independent study directly to first-year work at this specific subject. Name the concrete skill, not just the subject.',
  },
  {
    key: 'ucas3',
    number: 3,
    label: 'Beyond education',
    minChars: 350,
    suggestedShare: '25-35% of the statement',
    prompt: 'What else have you done to prepare outside of education, and why are these experiences helpful?',
    role: 'Experience explained, not listed. Work, volunteering, caring responsibilities, sport, music, independent projects — show what you took from it and how it serves your study.',
  },
];

export const UCAS_RULES = {
  totalChars: 4000,
  perAnswerMinChars: 350,
  unit: 'characters',
  questions: UCAS_QUESTIONS,
  note:
    'Since 2026 entry UCAS replaced the single free essay with three fixed questions. You still write ONE statement and UCAS sends it to every course on your application — so never name a university or refer to a specific campus.',
  academicBias:
    'Oxford asks for roughly 80% academic content (about 800 of the 4,000 characters). Cambridge caps non-academic material at 20% of whichever answer it appears in, and allows a further 1,200-character Cambridge-specific statement in My Cambridge Application. Draft to the tighter of the two.',
};

export const UCAS_PROMPT_TEXT = UCAS_QUESTIONS
  .map((q) => `${q.number}. ${q.prompt}\n   (minimum ${q.minChars} characters — aim for ${q.suggestedShare})`)
  .join('\n\n');

// ---------------------------------------------------------------------------
// The shared-essay plan: what "shared" actually means per platform
// ---------------------------------------------------------------------------
/**
 * Returns the essay records that should exist for a platform's SHARED
 * writing. Creating them once makes the essay apply to every university on that
 * platform — which is exactly how the real application works.
 *
 * `existing` is the current list so already-created entries are not duplicated.
 */
export function buildSharedEssayPlan(platform, existing = []) {
  const have = new Set(existing.map((e) => `${e.scope}|${e.application_platform}|${e.title}`));

  const plans = {
    common_app: [
      {
        title: COMMON_APP_PERSONAL_STATEMENT.title,
        type: 'personal_statement',
        scope: 'common',
        application_platform: 'common_app',
        prompt: 'Choose ONE of the seven Common App prompts below, then write 250-650 words.\n\n' + COMMON_APP_PROMPTS.map((p) => `PROMPT ${p.number} (${p.share}% of last cycle chose this):\n${p.text}`).join('\n\n'),
        word_limit: COMMON_APP_PERSONAL_STATEMENT.maxWords,
        limit_unit: 'words',
        shared_reason: 'Sent identically to every Common App school on your list.',
      },
      ...COMMON_APP_AUXILIARY.map((a) => ({
        title: `Common App — ${a.title}`,
        type: a.type,
        scope: 'common',
        application_platform: 'common_app',
        prompt: a.prompt,
        word_limit: a.limit,
        limit_unit: a.unit,
        shared_reason: 'Shared across every Common App school. Most applicants only need the personal statement.',
      })),
    ],
    uc: UC_PIQS.map((q) => ({
      title: `UC PIQ ${q.number} — ${q.theme}`,
      type: 'supplemental',
      scope: 'common',
      application_platform: 'uc',
      prompt: q.prompt,
      word_limit: q.limit,
      limit_unit: 'words',
      shared_reason: `The same four answers go to every UC campus. UC requires exactly ${UC_RULES.pick} of ${UC_RULES.of}.`,
    })),
    ucas: [
      {
        title: 'UCAS Personal Statement (shared)',
        type: 'personal_statement',
        scope: 'common',
        application_platform: 'ucas',
        prompt: UCAS_PROMPT_TEXT,
        word_limit: UCAS_RULES.totalChars,
        limit_unit: 'characters',
        shared_reason: 'ONE statement for all of your UCAS course choices — same wording everywhere.',
      },
    ],
    coalition: [
      {
        title: 'Coalition Personal Essay',
        type: 'personal_statement',
        scope: 'common',
        application_platform: 'coalition',
        prompt: 'Write the Coalition Application personal essay. The Coalition uses a single personal essay (commonly 500-650 words) that is sent to every Coalition member school on your list — keep it free of school-specific references.',
        word_limit: 650,
        limit_unit: 'words',
        shared_reason: 'One Coalition profile, shared across all Coalition member schools.',
      },
    ],
    direct: [],
    other: [],
  };

  return (plans[platform] || []).filter((p) => !have.has(`${p.scope}|${p.application_platform}|${p.title}`));
}

// ---------------------------------------------------------------------------
// Application rounds / deadlines
// ---------------------------------------------------------------------------
export const US_ROUNDS = [
  'Re-Early Decision (RED)',
  'Restrictive Early Action (REA)',
  'Early Decision (ED)',
  'Early Decision II (ED2)',
  'Early Action (EA)',
  'Regular Decision (RD)',
  'Rolling',
];

export const UK_ROUNDS = [
  { value: 'UCAS — 15 Oct (Oxbridge, medicine, dentistry, veterinary)', deadline: '2026-10-15' },
  { value: 'UCAS — 13 Jan (all other courses)', deadline: '2027-01-13' },
];

// University-specific UK details. Used to prefill the Add University dialog and
// to warn when a deadline is missing.
export const UK_UNIVERSITY_NOTES = {
  oxford: {
    rounds: ['UCAS — 15 Oct (Oxbridge, medicine, dentistry, veterinary)'],
    deadline: '2026-10-15',
    note:
      'Oxford: aim for roughly 80% academic content in the statement. Most applicants also sit written admissions tests and are interviewed.',
  },
  cambridge: {
    rounds: ['UCAS — 15 Oct (Oxbridge, medicine, dentistry, veterinary)'],
    deadline: '2026-10-15',
    note:
      'Cambridge: submit UCAS by 15 Oct, then My Cambridge Application by 22 Oct — it includes an optional 1,200-character Cambridge-specific statement. Non-academic content should not exceed 20% of the answer it sits in.',
  },
  imperial: {
    rounds: ['UCAS — 13 Jan (all other courses)'],
    deadline: '2027-01-13',
    note: 'Imperial has its own Personal Statement Adjustment Form for applicants with a relevant background.',
  },
  ucl: {
    rounds: ['UCAS — 13 Jan (all other courses)'],
    deadline: '2027-01-13',
    note: 'UCL uses UCAS plus its own applicant questionnaire and, for some applicants, an admissions test.',
  },
  lse: {
    rounds: ['UCAS — 13 Jan (all other courses)'],
    deadline: '2027-01-13',
    note: 'LSE selects on courses rather than universities, and has its own contextual data questionnaire.',
  },
};

export function findUKUniversityNote(name = '') {
  const n = String(name).toLowerCase();
  for (const [key, info] of Object.entries(UK_UNIVERSITY_NOTES)) {
    if (n.includes(key)) return info;
  }
  return null;
}

/**
 * University names are matched by string in several places (research reports
 * are keyed by name, not id), and a user who types "stanford" one day and picks
 * "Stanford University" from their list the next must not end up with two
 * reports for one school.
 */
export function normalizeUniversityName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Shared-essay applicability
// ---------------------------------------------------------------------------
/**
 * Which saved essays apply to a university:
 *  - shared essays whose platform matches this university's platform, and
 *  - essays written specifically for this university.
 */
export function essaysApplicableToUniversity(allEssays, university) {
  const platform = getUniversityPlatform(university);
  return (allEssays || []).filter((essay) => {
    if (essay.scope === 'common') {
      const essayPlatform = essay.application_platform || 'common_app';
      return essayPlatform === platform;
    }
    return essay.university_id === university?.id;
  });
}

export function isSharedEssay(essay) {
  return essay?.scope === 'common';
}

/** Original name kept so existing imports keep working. */
export function isCommonEssay(essay) {
  return isSharedEssay(essay);
}

export function isUniversitySpecific(essay) {
  return essay?.scope !== 'common';
}

// ---------------------------------------------------------------------------
// Length limits — UCAS counts characters, everything else counts words.
// ---------------------------------------------------------------------------
export function limitUnitFor(essay) {
  if (essay?.limit_unit) return essay.limit_unit;
  // Fallback so UCAS essays stay character-counted even before the optional
  // `limit_unit` column exists in the database.
  return essay?.application_platform === 'ucas' ? 'characters' : 'words';
}

export function measureEssay(text, unit) {
  const value = text || '';
  if (unit === 'characters') return value.length;
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

export function formatLimit(unit) {
  return unit === 'characters' ? 'characters' : 'words';
}

// ---------------------------------------------------------------------------
// Essay types
// ---------------------------------------------------------------------------
// NOTE: these values must stay in sync with the CHECK constraint on
// `essays.type` in supabase/schema.sql — Postgres rejects unknown values, so a
// new entry here also needs a migration before it can be used.
export const ESSAY_TYPES = [
  { value: 'personal_statement', label: 'Personal Statement' },
  { value: 'supplemental', label: 'Supplemental Essay' },
  { value: 'why_this_school', label: 'Why This School' },
  { value: 'activity', label: 'Activity Essay' },
  { value: 'scholarship', label: 'Scholarship / Aid Essay' },
  { value: 'other', label: 'Other' },
];

export const ESSAY_STATUSES = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'drafting', label: 'Drafting' },
  { value: 'in_review', label: 'In Review' },
  { value: 'polishing', label: 'Polishing' },
  { value: 'final', label: 'Final' },
];

// ---------------------------------------------------------------------------
// What a platform expects, summarised for the UI
// ---------------------------------------------------------------------------
export const PLATFORM_REQUIREMENTS = {
  common_app: {
    summary:
      'One 650-word personal statement shared by every Common App school, plus 3-5 school-specific supplements.',
    steps: [
      'Write the shared personal statement once (250-650 words)',
      'Research each school individually in the Knowledge Base',
      'Write school-specific supplements — these must NOT overlap the personal statement',
    ],
    reviewFocus:
      'Common App readers look for voice, context, and reflection. Each supplement should show something the personal statement did not.',
  },
  uc: {
    summary: `One UC application, ${UC_RULES.of} Personal Insight Questions, answer exactly ${UC_RULES.pick} at ${UC_RULES.limit} words each.`,
    steps: [
      `Choose ${UC_RULES.pick} of ${UC_RULES.of} questions — pick by what you can prove, not by what sounds best`,
      'Write 350 words each, all four sent to every campus',
      'Check the major-specific guide for each campus (different campuses weight PIQs differently)',
    ],
    reviewFocus:
      'UC evaluates 13 factors and the PIQs are not one of them — they are how the other factors become legible. Avoid overlap between your four answers.',
  },
  ucas: {
    summary: `One statement, three fixed questions, ${UCAS_RULES.totalChars.toLocaleString()} characters total (min ${UCAS_RULES.perAnswerMinChars} per answer), shared by all course choices.`,
    steps: [
      'Choose up to five UCAS course choices — they all read the same statement',
      `Draft within one ${UCAS_RULES.totalChars.toLocaleString()}-character budget across three answers`,
      'Oxford, Cambridge, medicine, dentistry and veterinary: UCAS deadline 15 October 2026',
      'Everything else: UCAS deadline 13 January 2027',
    ],
    reviewFocus:
      'Tutors want academic motivation and evidence. Keep non-academic material inside the caps (about 20%) and never name a university.',
  },
  coalition: {
    summary: 'One Coalition profile and personal essay, shared across Coalition member schools.',
    steps: [
      'Complete the Coalition profile once',
      'Write the shared personal essay',
      'Add school-specific supplements for each Coalition school',
    ],
    reviewFocus: 'Same holistic logic as the Common App, with the Coalition accessibility emphasis.',
  },
  direct: {
    summary: 'This university runs its own portal. Everything is written for it alone.',
    steps: [
      'Research the school in the Knowledge Base first',
      'Work through its own questionnaire — short answers are common',
      'Nothing is shared with any other university',
    ],
    reviewFocus: 'Tighter prompts, often with hard word caps and a distinctive voice requirement.',
  },
  other: {
    summary: 'No central application — handle each university separately.',
    steps: ['Research each school individually', 'Write a bespoke essay set for each'],
    reviewFocus: 'Check the school\'s own admissions page for the current requirements.',
  },
};

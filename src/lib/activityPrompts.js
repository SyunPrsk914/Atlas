// The Common App activities list: its real constraints, how an admissions
// reader actually reads it, and the prompts behind Atlas's suggestions for it.
//
// The field limits here are the published Common App ones and are shared by the
// editor UI and the AI prompts, so a suggestion can never be longer than the
// box it is offered for. Previously the editor enforced only the 150-character
// description, so a 90-character position title could be saved and then
// silently truncated by the real application.
//
// Pure module: no React, no browser APIs.

export const ACTIVITY_LIMITS = {
  maxActivities: 10,
  position: 50,
  organization: 100,
  description: 150,
};

/**
 * The Common App activity-type dropdown, verbatim. The model is told to choose
 * from this list so a suggestion can be applied without the user fixing a
 * category that the form does not offer.
 */
export const ACTIVITY_TYPES = [
  'Academic', 'Art', 'Athletics: Club', 'Athletics: JV', 'Athletics: Varsity',
  'Career-Oriented', 'Community Service (Volunteer)', 'Computer/Technology',
  'Dance', 'Debate/Speech', 'Environmental', 'Family Responsibilities',
  'Foreign Exchange', 'Journalism/Publication', 'Junior ROTC', 'LGBT',
  'Music: Instrumental', 'Music: Vocal', 'Religious', 'Research', 'Robotics',
  'School Spirit', 'Social Justice', 'Student Govt./Politics', 'Theater',
  'Tutoring', 'Work (Paid)', 'Other Club/Activity',
];

export const TIMING_OPTIONS = ['School year', 'School break', 'Summer', 'All year'];
export const GRADE_LEVELS = ['9', '10', '11', '12', 'PG'];

export const HOURS_PER_WEEK_MAX = 168;
export const WEEKS_PER_YEAR_MAX = 52;

/**
 * What an admissions reader does with this list, and what the 150 characters
 * are for. Researched from counselling guidance on the Common App activities
 * section (10 slots; 50 / 100 / 150 character fields; ordered by importance,
 * not chronology).
 */
export const ACTIVITY_SECTION_BRIEF = `HOW THE ACTIVITIES LIST IS READ:
- Ten slots, in the order you choose. The reader reads the first two or three properly and skims the rest, so the order is an argument about what matters most to you — it is never chronological.
- Each entry has three text fields: Position/Leadership (50 characters), Organization (100 characters), Description (150 characters). The reader already has the type, the grades, the hours and the weeks from the structured fields.
- 150 characters is about a sentence and a half. It is not room for a story. The strongest descriptions give up on storytelling and lead with a verb and a number.
- The description must not repeat the position or the organization. "President of Key Club" in a description under a position that already says "President" and an organization that already says "Key Club" wastes the only field where you can show impact.
- Depth beats breadth. Seven substantive entries read better than ten with three filler slots, and a reader can tell which entries are padding.
- What the reader is looking for, in order: initiative (did you start, build, or change something?), impact (how many people, how much money, how far did it travel?), commitment (years, hours, progression of responsibility), and skill (what are you now able to do that you could not before?).
- Family responsibilities and paid work are read with respect, not as lesser activities. A student who closes a shop every night or cares for a sibling is showing something a club presidency does not.

WRITING RULES FOR A DESCRIPTION:
- Start with a strong past-tense verb: led, founded, built, raised, designed, taught, wrote, coded, organised, coached, grew, launched, repaired, translated.
- Never start with "I", "Responsible for", "Helped with", "Participated in", "Member of", "Involved in".
- Quantify anything countable: people served, hours logged, dollars raised, members recruited, events run, places reached, percentage growth, rank out of how many.
- Show change over time where it exists: "grew from 8 to 45 members", "first regional final in 9 years".
- Write in fragments. Drop articles and pronouns. Use "&" and standard abbreviations when space is tight, but keep it readable — an unreadable abbreviation costs more than the characters it saves.
- Spend the characters on what CHANGED because you were there, not on what the organization is or what the role normally involves.
- If an activity is too big for 150 characters, end with "(see Add'l Info)" and explain it in the Additional Information section.

TONE: factual, unboastful, concrete. No exclamation marks, no "passionate", no "dedicated", no "hardworking" — those are conclusions the reader should draw from the numbers, not adjectives you supply.`;

const FIELD_RULES = `HARD FIELD LIMITS (the Common App form itself enforces these — anything longer is truncated, so it is wasted):
- Position/Leadership: ${ACTIVITY_LIMITS.position} characters. Your role and nothing else. If there is no title, name the function ("Founder", "Sole maintainer", "Team captain", "Night-shift cook").
- Organization: ${ACTIVITY_LIMITS.organization} characters. The body, team, school, employer, or "Independent" / "Self-directed" when there is none.
- Description: ${ACTIVITY_LIMITS.description} characters. This is the field that carries the impact.
Count the characters in every field you return, including spaces, and stay inside them.`;

// ---------------------------------------------------------------------------
// 1. Sharpen one entry
// ---------------------------------------------------------------------------
export function buildActivityPolishPrompt({
  activity, index = 0, activities = [], profileText = '', materialsText = '',
  applicantText = '', universityName = '',
}) {
  const current = activity || {};
  const others = (activities || [])
    .map((item, i) => (i === index ? null : `${i + 1}. ${item.position || '?'} — ${item.organization || '?'}: ${item.description || '(no description)'}`))
    .filter(Boolean)
    .join('\n');

  return `You are a college admissions counsellor who has read tens of thousands of Common App activity lists and knows exactly what survives a first read. You are improving ONE entry.

${ACTIVITY_SECTION_BRIEF}

${FIELD_RULES}

THE ENTRY TO IMPROVE (entry ${index + 1} of ${(activities || []).length || 1}):
- Activity type: ${current.activity_type || '(not chosen)'}
- Position/Leadership: ${current.position || '(empty)'}
- Organization: ${current.organization || '(empty)'}
- Description: ${current.description || '(empty)'}
- Grades: ${(current.grade_levels || []).join(', ') || '(none)'} | Timing: ${current.timing || '(none)'} | ${current.hours_per_week ?? '?'} hrs/week, ${current.weeks_per_year ?? '?'} weeks/year
${others ? `\nTHE REST OF THE LIST (do not repeat what another entry already says):\n${others}\n` : ''}${universityName ? `\nThis list is being read by ${universityName} among others.\n` : ''}
${profileText ? `APPLICANT PROFILE (context only — never add a fact that is not already in this entry, the profile, or the materials):\n${profileText}\n` : ''}
${materialsText ? `SUPPORTING MATERIALS (use only to recover a number, a scope, or a detail this student really has; a sample essay's life is never this student's):\n${materialsText}\n` : ''}
${applicantText ? `WHAT ATLAS KNOWS ABOUT THIS APPLICANT:\n${applicantText}\n` : ''}
Do this:
1. Read the entry as an admissions officer skimming at speed. What does it currently prove? Usually less than the student thinks.
2. Rewrite the three text fields so they carry the maximum evidence per character: verb first, numbers where they are real, no repetition of the other fields, no duty-listing.
3. Keep every fact exactly as given. You may reword, compress, reorder, and choose a stronger verb. You may NOT invent a number, a scope, an award, a title, or an outcome. If the entry is missing the number that would make it land, ask for it in "missing_facts" instead of writing one.
4. Do not return hours_per_week, weeks_per_year, or grade_levels — those are facts only the applicant knows, and changing them would falsify the application.
5. Check each field's character count before you answer.

Return JSON only:
- "position", "organization", "description": the improved text, each inside its limit.
- "activity_type": one of the exact Common App categories listed below, only if the current one is wrong; otherwise repeat it.
- "timing": one of ${TIMING_OPTIONS.map((t) => `"${t}"`).join(', ')} — only if the current one is wrong; otherwise repeat it.
- "changes": one entry per field you changed, { "field", "original", "revised", "reason" }.
- "missing_facts": the specific numbers or details the applicant should add, and where each would go.
- "verdict": one sentence saying what this entry now proves to a reader.

Allowed activity types: ${ACTIVITY_TYPES.join(', ')}.`;
}

export const ACTIVITY_POLISH_SCHEMA = {
  type: 'object',
  properties: {
    position: { type: 'string' },
    organization: { type: 'string' },
    description: { type: 'string' },
    activity_type: { type: 'string' },
    timing: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          original: { type: 'string' },
          revised: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    missing_facts: { type: 'array', items: { type: 'string' } },
    verdict: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// 2. Suggest entries from the applicant's own materials
// ---------------------------------------------------------------------------
export function buildActivitySuggestPrompt({
  activities = [], profileText = '', materialsText = '', applicantText = '',
  slots = ACTIVITY_LIMITS.maxActivities,
}) {
  const used = (activities || []).length;
  const current = (activities || [])
    .map((item, i) => `${i + 1}. [${item.activity_type || '?'}] ${item.position || '?'} at ${item.organization || '?'} — ${item.description || '(no description)'}`)
    .join('\n');

  return `You are a college admissions counsellor building a Common App activities list from this applicant's own evidence. Everything you suggest must be traceable to something Atlas has actually read about them.

${ACTIVITY_SECTION_BRIEF}

${FIELD_RULES}

WHAT IS ALREADY ON THE LIST (${used} of ${slots} slots used):
${current || '(nothing yet — the list is empty)'}

APPLICANT PROFILE:
${profileText || '(no profile saved)'}

SUPPORTING MATERIALS — this is where the evidence comes from:
${materialsText || '(no materials added)'}

${applicantText ? `WHAT ATLAS KNOWS ABOUT THIS APPLICANT:\n${applicantText}\n` : ''}
Do this:
1. Read the profile and the materials for anything that is an activity: paid work, family responsibilities, caring, a project, research, sport, music, art, volunteering, a club, an independent study, something built, something organised, something taught, something maintained over time.
2. Extract up to ${Math.max(1, slots - used)} entries that are NOT already on the list, ranked by what they prove to a reader — initiative, impact, commitment, skill.
3. For each one, quote the evidence in "evidence": which material or profile field it came from, and the words in it that support the entry. An entry with no evidence in the applicant's own material must not be suggested.
4. Write the description to the rules above: verb first, numbers where the source states them, no repetition of the position or organization fields.
5. NEVER invent. No numbers, no awards, no titles, no outcomes, no organizations that are not in the source. Where a number would make the entry land and the source does not have it, leave it out and put it in "missing_facts".
6. hours_per_week, weeks_per_year, grade_levels, and timing: fill them ONLY when the source states them. Otherwise return null / an empty list and name what to confirm in "missing_facts". These are the fields an admissions office can check.
7. Say in "ordering_rationale" how the whole list (existing entries plus your suggestions) should be ordered by importance, and why.
8. Before you return anything, read every entry again as the admissions officer who will see it inside a fifteen-minute skim of the whole file. For each one ask: does this prove initiative, impact, commitment, or skill — or does it only name a club? Would I believe it? Is any word doing work that a number should do? Does it say something the position and organization fields already said? Cut or rewrite whatever fails that test, and drop an entry entirely rather than suggest a weak one. Do not return an entry you would not put in front of a reader.

Return JSON only:
- "activities": array of { "activity_type", "position", "organization", "description", "timing", "grade_levels", "hours_per_week", "weeks_per_year", "evidence", "why_it_matters", "confidence" } where confidence is "certain" (the source states it plainly), "likely" (the source strongly implies it), or "check" (the applicant must confirm it before it goes anywhere near an application).
- "ordering_rationale": one paragraph on the order of the finished list.
- "missing_facts": the specific facts to confirm or add, each naming the entry it belongs to.
- "missing_themes": what this list still does not show about the applicant, if anything.

Allowed activity types: ${ACTIVITY_TYPES.join(', ')}.
Allowed timing values: ${TIMING_OPTIONS.join(', ')}. Allowed grade levels: ${GRADE_LEVELS.join(', ')}.`;
}

export const ACTIVITY_SUGGEST_SCHEMA = {
  type: 'object',
  properties: {
    activities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          activity_type: { type: 'string' },
          position: { type: 'string' },
          organization: { type: 'string' },
          description: { type: 'string' },
          timing: { type: 'string' },
          grade_levels: { type: 'array', items: { type: 'string' } },
          hours_per_week: { type: 'number' },
          weeks_per_year: { type: 'number' },
          evidence: { type: 'string' },
          why_it_matters: { type: 'string' },
          confidence: { type: 'string', enum: ['certain', 'likely', 'check'] },
        },
      },
    },
    ordering_rationale: { type: 'string' },
    missing_facts: { type: 'array', items: { type: 'string' } },
    missing_themes: { type: 'array', items: { type: 'string' } },
  },
};

// ---------------------------------------------------------------------------
// 3. Review the list as a whole
// ---------------------------------------------------------------------------
export function buildActivityListReviewPrompt({
  activities = [], profileText = '', universityName = '', materialsText = '',
}) {
  const list = (activities || [])
    .map((item, i) => `${i + 1}. [${item.activity_type || '?'}] ${item.position || '(no position)'} — ${item.organization || '(no organization)'}\n   Description (${String(item.description || '').length}/${ACTIVITY_LIMITS.description} chars): ${item.description || '(EMPTY)'}\n   Grades: ${(item.grade_levels || []).join(', ') || '(none)'} | Timing: ${item.timing || '(none)'} | ${item.hours_per_week ?? '?'} hrs/week, ${item.weeks_per_year ?? '?'} weeks/year`)
    .join('\n');

  return `You are the admissions officer reading this activities list inside a full application${universityName ? ` at ${universityName}` : ''}. Judge the list as a list, not entry by entry.

${ACTIVITY_SECTION_BRIEF}

${FIELD_RULES}

THE LIST AS IT WOULD BE SUBMITTED:
${list || '(empty)'}

${profileText ? `APPLICANT PROFILE (use it to spot activities the student never listed, and descriptions that undersell what the profile says):\n${profileText}\n` : ''}${materialsText ? `SUPPORTING MATERIALS:\n${materialsText}\n` : ''}
Judge:
1. ORDER. The first three slots carry the list. Is the most impressive, most characteristic work first, or is the list chronological / alphabetical / padded? Return "ordering" as the 1-based positions of the current list in the order you would submit them.
2. REDUNDANCY. Do two entries prove the same thing? Is a description repeating its own position or organization field, or another entry?
3. WEAKNESS. Which entries list duties instead of impact? Which are missing the number that would make them land? Which read as filler?
4. FIELDS. Anything over a character limit, empty that should not be, or a timing/hours/weeks entry that looks inconsistent with the description.
5. GAPS. What does this list fail to show that the profile or materials suggest is true?

Be specific and quote the entry you are talking about. Return JSON only:
- "ordering": array of the 1-based current positions in your recommended order.
- "findings": array of { "entry" (1-based), "issue", "fix", "severity" ("high" | "medium" | "low") }.
- "redundant_pairs": array of strings naming entries that overlap.
- "missing_themes": array of strings.
- "field_problems": array of strings naming any field that is empty, over its limit, or inconsistent.
- "overall": three sentences on what this list currently says about the applicant, and the single change that would improve it most.`;
}

export const ACTIVITY_LIST_SCHEMA = {
  type: 'object',
  properties: {
    ordering: { type: 'array', items: { type: 'number' } },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          entry: { type: 'number' },
          issue: { type: 'string' },
          fix: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    redundant_pairs: { type: 'array', items: { type: 'string' } },
    missing_themes: { type: 'array', items: { type: 'string' } },
    field_problems: { type: 'array', items: { type: 'string' } },
    overall: { type: 'string' },
  },
};

// ---------------------------------------------------------------------------
// Validation: a suggestion is only usable if it fits the real form
// ---------------------------------------------------------------------------
const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * Truncates a field to the Common App limit, preferring to cut at a word
 * boundary, and reports that it had to. A model that returns 170 characters for
 * a 150-character box must not put the applicant over the limit.
 */
export function fitActivityField(value, limit) {
  const text = cleanText(value);
  if (text.length <= limit) return { text, truncated: false };
  const slice = text.slice(0, limit);
  const lastBreak = Math.max(slice.lastIndexOf(' '), slice.lastIndexOf(';'), slice.lastIndexOf(','));
  const cut = lastBreak > limit * 0.6 ? slice.slice(0, lastBreak) : slice;
  return { text: cut.replace(/[\s;,&-]+$/, ''), truncated: true };
}

/**
 * Turns a model's suggestion into something the editor can hold: valid types,
 * valid timing, valid grades, numbers inside their real ranges, and every text
 * field inside its character limit. `truncations` tells the UI which fields the
 * model overshot so the applicant is not shown a silently shortened entry.
 */
export function sanitizeActivitySuggestion(raw, { allowNumbers = true } = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const truncations = [];
  const fit = (field, value, limit) => {
    const result = fitActivityField(value, limit);
    if (result.truncated) truncations.push(field);
    return result.text;
  };

  const type = cleanText(source.activity_type);
  const activityType = ACTIVITY_TYPES.find((t) => t.toLowerCase() === type.toLowerCase())
    || ACTIVITY_TYPES.find((t) => type && (t.toLowerCase().includes(type.toLowerCase()) || type.toLowerCase().includes(t.toLowerCase())))
    || '';
  // Models answer "summers" or "school year and summer"; the Common App offers
  // four exact options, so match tolerantly rather than dropping the field.
  const rawTiming = cleanText(source.timing).toLowerCase().replace(/s$/, '');
  const timing = TIMING_OPTIONS.find((t) => t.toLowerCase() === rawTiming)
    || TIMING_OPTIONS.find((t) => rawTiming.includes(t.toLowerCase()) || t.toLowerCase().includes(rawTiming))
    || '';
  const grades = Array.isArray(source.grade_levels)
    ? source.grade_levels.map((g) => cleanText(g)).filter((g) => GRADE_LEVELS.includes(g))
    : [];

  const numberOr = (value, max, whole) => {
    if (!allowNumbers) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.min(whole ? Math.trunc(n) : n, max);
  };

  return {
    activity: {
      activity_type: activityType,
      position: fit('position', source.position, ACTIVITY_LIMITS.position),
      organization: fit('organization', source.organization, ACTIVITY_LIMITS.organization),
      description: fit('description', source.description, ACTIVITY_LIMITS.description),
      grade_levels: grades,
      timing,
      hours_per_week: numberOr(source.hours_per_week, HOURS_PER_WEEK_MAX, false),
      weeks_per_year: numberOr(source.weeks_per_year, WEEKS_PER_YEAR_MAX, true),
    },
    evidence: cleanText(source.evidence),
    why_it_matters: cleanText(source.why_it_matters),
    confidence: ['certain', 'likely', 'check'].includes(cleanText(source.confidence)) ? cleanText(source.confidence) : 'check',
    truncations,
  };
}

/**
 * A suggestion is worth showing only if it has something in it. An entry with
 * no description and no position is noise, and Atlas would rather show seven
 * real suggestions than ten half-formed ones.
 */
export function isUsableSuggestion(suggestion) {
  const activity = suggestion?.activity;
  if (!activity) return false;
  return Boolean(activity.description || activity.position || activity.organization);
}

/** Character counts for one entry, so the UI can show what would be cut. */
export function activityFieldCounts(activity = {}) {
  return {
    position: cleanText(activity.position).length,
    organization: cleanText(activity.organization).length,
    description: String(activity.description || '').length,
  };
}

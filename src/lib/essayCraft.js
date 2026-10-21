// What each kind of essay is FOR, and how to write one well.
//
// Atlas already knew each essay's official role in one sentence. That is enough
// to avoid writing a resume in prose, but it is not enough to write a 10/10
// draft: a personal statement, a 50-word quirky question, a Why-Us supplement,
// and a UCAS answer each need a different structure, a different tone, and a
// different version of the applicant on the page. This module holds that
// knowledge in one place so the generate, review, and edit prompts all teach
// the model the same craft instead of hoping it remembers.
//
// Pure module: no browser, no app imports. `npm run verify` exercises it.

import { getUniversityPlatform } from './applicationData';

// ---------------------------------------------------------------------------
// Craft by essay type
// ---------------------------------------------------------------------------
export const ESSAY_CRAFT_BY_TYPE = {
  personal_statement: {
    label: 'Personal statement',
    job: 'Answer one question the rest of the file cannot: what is it like to think like you? The reader is not verifying an achievement, they are deciding whether you would be interesting to have in a seminar room.',
    structure: [
      'ONE story. One place, one stretch of time, one thing that changed. Not two stories, not a montage of achievements, no side quests.',
      'Open inside a moment that only you could describe — a specific room, object, sound, or line of dialogue. Never open with a thesis about yourself.',
      'Move forward through time. Each paragraph is later than the last and shows the change accumulating, not repeated evidence of the same trait.',
      'Spend at least a third of the words on the turn: what you did differently afterwards, and the cost of it.',
      'End on an image or a decision, not a lesson. If the last sentence could be pasted onto anyone else\'s essay, it is the wrong last sentence.',
    ],
    tone: 'Intimate, concrete, unhurried. First person, past tense for the story, present for the consequence. Funny only where the joke is on you.',
    mindset: 'You are not selling. You are letting a stranger watch you think for four minutes. Vulnerability with a spine: show the difficulty, then show what you did about it.',
    traps: [
      'The resume in prose: naming more than two activities or achievements.',
      'The trip/voluntourism arc where someone else\'s poverty teaches you gratitude.',
      'The tragedy essay that stops at the tragedy and never reaches the change.',
      'The "and then I realized" sentence that explains the meaning the scene already carried.',
      'Side quests: a second hobby, a mention of a sibling, a paragraph about a different year. Every one of them halves the depth of the main story.',
    ],
    ten_out_of_ten: 'A reader who has just read 40 files remembers one image from this essay an hour later, can say what kind of person wrote it, and no sentence in it could have been written by a different applicant.',
  },
  supplemental: {
    label: 'Supplemental essay',
    job: 'Do the one job this prompt has, and do not repeat another essay in the set. Supplements are read as a group; a repeated story reads as an applicant with only one story.',
    structure: [
      'Answer the literal question in the first two sentences. The reader should not have to hunt for it.',
      'Prove it with one concrete piece of evidence — a scene, a number, a named thing you made or did.',
      'Connect it forward: what you would do with this at that school, or who you became because of it.',
      'Use every word of the space. A 150-word answer at 90 words is a 90-word answer to a 150-word question.',
    ],
    tone: 'Direct and specific. Less literary than the personal statement, more compressed. No scene-setting longer than one clause.',
    mindset: 'You are adding a new facet, not reinforcing an old one. Ask: "what does this show that no other part of my application shows?"',
    traps: [
      'Restating an activity that is already in the activity list, in the same words.',
      'Answering a neighbouring prompt because it is easier.',
      'Flattering the school with adjectives instead of naming things.',
      'Stopping at 60% of the word limit.',
    ],
    ten_out_of_ten: 'The answer is unmistakably about THIS prompt, contains at least one detail nobody else would write, and would still make sense if the reader had seen nothing else in the file.',
  },
  why_this_school: {
    label: 'Why this school',
    job: 'Prove a two-way match with named, checkable specifics: courses, professors and what they actually work on, programmes, structures, traditions, problems the school is trying to solve.',
    structure: [
      'Start with what you want to DO or figure out — the interest is the subject of the essay, the school is the instrument.',
      'Name two to four specifics and connect each one to something you have already done or already know. A named course with no link to you is a brochure quote.',
      'Add one thing you would contribute that the school could not get from another applicant.',
      'Close on the fit in one sentence, without the word "vibrant".',
    ],
    tone: 'Confident, researched, warm but not gushing. You are a peer describing a plan, not a fan describing a dream.',
    mindset: 'You have read the course catalogue and one professor\'s recent work. You can name the specific thing you would do in year one and what it leads to in year three.',
    traps: [
      'Anything that could be pasted into another school\'s supplement with the name swapped — including rankings, "collaborative community", "beautiful campus", "world-class faculty".',
      'Naming a professor whose work you have not connected to your own question.',
      'Listing five things shallowly instead of two things deeply.',
      'Praising the school for its selectivity.',
    ],
    ten_out_of_ten: 'Swap the school name for a rival and the essay breaks. Every specific is real, and each one is tied to something the applicant has already done or genuinely wants to do.',
  },
  activity: {
    label: 'Activity essay',
    job: 'Show what an involvement did to your thinking, not what your duties were. The reader has already seen the activity list; this is the part the list cannot hold.',
    structure: [
      'Pick ONE activity, usually not the most impressive one — the one with the most texture.',
      'One scene inside it, told concretely: what you were doing with your hands, who was there, what went wrong.',
      'The intellectual or personal shift it caused, evidenced by what you did next.',
    ],
    tone: 'Plainer than the personal statement. Verbs over adjectives. The competence shows; you do not announce it.',
    mindset: 'You are explaining why this mattered, not that it was impressive.',
    traps: ['A list of responsibilities.', 'Repeating the 150-character description in longer words.', 'Claiming an impact you cannot show.'],
    ten_out_of_ten: 'The reader understands what you actually did on a Tuesday, and why the way you think is different because of it.',
  },
  scholarship: {
    label: 'Scholarship / aid essay',
    job: 'Make the case for an investment: what you have already contributed, what the money changes, and what you will do with the credential. Committees score alignment with the fund\'s stated mission.',
    structure: [
      'Name the fit with the fund\'s mission in the first paragraph, in the fund\'s own language where it is honest to do so.',
      'Evidence of the pattern they are funding — sustained, not one-off.',
      'What the award concretely makes possible (a year of study, an unpaid placement, a project), and what you do after.',
    ],
    tone: 'Formal enough for a committee, still in your own voice. Gratitude without grovelling; need without shame.',
    mindset: 'You are a good bet. The essay is the argument for why the money compounds.',
    traps: ['A sob story with no plan.', 'Generic "I want to help people".', 'Repeating the personal statement.'],
    ten_out_of_ten: 'A committee member could read it aloud and say what the fund buys and why this applicant will not waste it.',
  },
  other: {
    label: 'Other writing',
    job: 'Whatever the box says. Additional-information sections explain context; short quirky answers show personality and wit under compression.',
    structure: [
      'Read the instruction literally and obey it, including any format ("three things", "one sentence", a list).',
      'Compress: in a short box every word must be doing two jobs.',
    ],
    tone: 'Match the register the prompt implies. A 50-word question is not a small essay; it is a punchline with evidence.',
    mindset: 'You are answering exactly what was asked, in the shape it was asked for.',
    traps: ['Writing an essay in a box that wanted a list.', 'Explaining the joke.', 'Using the whole box to set up a point you never make.'],
    ten_out_of_ten: 'The format is respected exactly and the content is specific enough to be memorable.',
  },
};

// ---------------------------------------------------------------------------
// Craft by the shape of the question, for supplements Atlas has not catalogued
// ---------------------------------------------------------------------------
export const SUPPLEMENT_SHAPES = [
  {
    key: 'micro',
    test: ({ limit, unit }) => unit === 'words' && limit > 0 && limit <= 100,
    label: 'Very short answer (100 words or fewer)',
    craft: `Compressed form. There is no room for a scene AND a lesson, so choose one and go all the way in. Structure: a specific thing (1-2 sentences), the sharpest detail about it (1 sentence), what it says about you without saying what it says about you (1 sentence). Cut every article, every "that", every qualifier. Read it aloud: if a word does not earn its place, delete it. Get to at least 90% of the limit — a 40-word answer to a 50-word question looks like you stopped thinking.`,
  },
  {
    key: 'why_major',
    test: ({ prompt }) => /why .{0,25}(major|field|discipline|subject|course|programme|program of study)|describe your (intended|chosen|prospective) (major|field)|academic interest|why do you want to study|why this (subject|course|discipline|field)/i.test(prompt),
    label: 'Why this subject',
    craft: `An origin and a trajectory. Where the interest actually started (a specific object, question, book, problem, person — not "since I was young"), what you have already done about it beyond coursework, and the specific questions you want to work on next. Show the shape of your thinking in this subject, not your grades in it.`,
  },
  {
    key: 'why_us',
    test: ({ prompt }) => {
      const text = String(prompt || '');
      if (!/\bwhy\b|\bwhat\b|\bhow\b|interested|appeals?|attracts?|draws?/i.test(text)) return false;
      // Any short "Why X?" that is not about a subject is a Why-us question.
      if (/^\s*why\b[^.?!]{0,80}\??\s*$/i.test(text)) return true;
      return /why (us|this|our|here|.+? (university|college|school|program|programme|institute))|what (about .+ )?(appeals|attracts|interests|draws)|how will you (use|pursue|apply).{0,30}(education|degree|time here)|what draws you|why are you interested in (studying|attending|joining)|reasons? for (applying|choosing)/i.test(text);
    },
    label: 'Why this school',
    craft: `Two-way match. Lead with the interest or problem you are chasing, then name 2-4 real specifics of this school (a course number or title, a professor and what they actually study, a programme, a lab, a structure like an open curriculum or a required thesis) and tie each one to something you have already done. End with one contribution only you could make. Delete any sentence that would still work at a different school.`,
  },
  {
    key: 'community',
    test: ({ prompt }) => /community|belong|roommate|contribute to (our|the|.+ )?(campus|community|class)|neighbo(u)?r|how do you (engage|participate)|what do you bring/i.test(prompt),
    label: 'Community and contribution',
    craft: `Define the community precisely (size, who is in it, what it needs), show your actual role in it with one scene, then show the transferable habit you would bring here. "Community" can be a lab, a bus route, a Discord server, a family table — the specificity is what makes it credible. Avoid the saviour frame: you are a member who did something, not a benefactor.`,
  },
  {
    key: 'challenge',
    test: ({ prompt }) => /challenge|setback|failure|obstacle|adversity|difficult(y|ies)|disagree|conflict|mistake/i.test(prompt),
    label: 'Challenge, failure, or disagreement',
    craft: `Spend at most a third of the words on the event and two thirds on the response and the change. For a disagreement prompt, the interesting part is how you stayed in the conversation with someone you thought was wrong — show the actual exchange, and what you updated. Never end with "and that made me stronger" without naming the behaviour that changed.`,
  },
  {
    key: 'activity',
    test: ({ prompt }) => /extracurricular|activit(y|ies)|leadership|employment|work experience|family responsibilit|describe an experience|involvement/i.test(prompt),
    label: 'Activity deep-dive',
    craft: `One activity, one scene inside it, one shift in how you think. Do not summarise the list the reader already has. The strongest version picks the activity with the most texture rather than the most prestige, and shows a Tuesday, not an award ceremony.`,
  },
  {
    key: 'identity',
    test: ({ prompt }) => /background|identity|heritage|culture|diversity|perspective|life experience|shaped who you are|where you are from/i.test(prompt),
    label: 'Background, identity, or perspective',
    craft: `Ground identity in behaviour, not labels. One practice, place, language, or relationship, shown concretely, then what it makes you notice or do that other people in the room would not. Avoid the "bridge between two worlds" formulation unless you can show the actual crossing.`,
  },
  {
    key: 'intellectual',
    test: ({ prompt }) => /curious|curiosity|intellectual|topic,? idea,? or concept|lose (all )?track of time|learn for the sake|nerd|question you (would|want)|idea that (excites|fascinates)|engaging/i.test(prompt),
    label: 'Intellectual curiosity',
    craft: `Name the obsession, then prove depth: what you have read or built, what you now know well enough to disagree with, and the open question you are still circling. Depth beats breadth — one subject explored to the point where you can name its unresolved arguments is worth more than five interests listed.`,
  },
  {
    key: 'talent',
    test: ({ prompt }) => /talent|skill|greatest (strength|ability)|what are you (good at|best at)|special talent|developed and demonstrated/i.test(prompt),
    label: 'Talent or skill',
    craft: `Two jobs in one question: name the skill plainly, then prove it developed over time. Structure: what the skill is and how you know you have it (one concrete demonstration, with a number or a result), the earliest version of you doing it badly, and what you do with it now that you could not have done two years ago. Awards are optional evidence; the arc is the answer.`,
  },
  {
    key: 'goals',
    test: ({ prompt }) => /future|career|after (graduation|college|you graduate)|aspir|plan to|long-term|where do you see/i.test(prompt),
    label: 'Future plans and ambitions',
    craft: `A plan with a first step already taken. Name the work concretely (the kind of problem, the kind of room you want to be in), the evidence you are already moving that way, and how this school is the specific instrument. Avoid "I want to make a difference" and any job title used as a costume.`,
  },
  {
    key: 'contribution',
    test: ({ prompt }) => /strong candidate|what (will|would|can) you (contribute|add|bring)|how will you contribute|make you unique|what will you (bring|add)|beyond what has already been shared|why should (we|the university) (admit|choose|accept) you/i.test(prompt),
    label: 'What you add to this campus',
    craft: `This is the wildcard question, so it must carry something the rest of the file does not already say. Pick ONE contribution and argue it: the pattern behind what you have already done (not the achievements themselves), the specific thing you would start, join, argue for, or fix on that campus, and who would notice. Do not list three virtues; do not repeat your activity list; do not claim you will "enrich the community" without naming how.`,
  },
  {
    key: 'explain',
    test: ({ prompt }) => /additional information|is there anything else|anything else|explain (a|the|any)|use this space|circumstance|gap (year|in)|context that|extenuating/i.test(prompt),
    label: 'Additional information / explain a circumstance',
    craft: `Plain, factual, unapologetic. State what happened, what it affected, what you did about it, and what is true now. No storytelling, no appeal for sympathy, no metaphors. This box is read for information; clarity is the whole craft. If nothing needs explaining, leave it empty — a filled box implies something to explain.`,
  },
  {
    key: 'gratitude',
    test: ({ prompt }) => /grateful|gratitude|thankful|someone (has )?done|kindness|generous/i.test(prompt),
    label: 'Gratitude or a person who shaped you',
    craft: `Name the person and the specific thing they did, then what you did with it. The essay fails when the gratitude is a wrapper for an achievement story; it works when the reader meets the other person clearly and sees the change in your behaviour.`,
  },
];

/**
 * Every shape a supplemental prompt has, in declaration order. A 50-word
 * "roommate" question is BOTH a very short answer and a community question, and
 * the craft for each is useful, so callers get all of them rather than one.
 * Falls back to an empty list when nothing matches, because Atlas must not
 * invent a shape it cannot recognise.
 */
export function detectSupplementShapes({ prompt = '', limit = 0, unit = 'words' } = {}) {
  const text = String(prompt || '');
  const args = { prompt: text, limit: Number(limit) || 0, unit };
  return SUPPLEMENT_SHAPES.filter((shape) => {
    try {
      return !!shape.test(args);
    } catch {
      return false;
    }
  });
}

/** The dominant shape of a supplemental prompt, or null. */
export function detectSupplementShape(args = {}) {
  return detectSupplementShapes(args)[0] || null;
}

/**
 * The shapes whose craft is a story with a turn rather than an argument, a list,
 * or a piece of plain information.
 *
 * This distinction is what keeps a personal statement's rubric off a supplemental
 * essay. "One story, forward in time, ending on a change" is the shape of a
 * narrative question; a 40-word box, a why-us argument, and an
 * additional-information explanation each have a different standard of good, and
 * scoring them by the arc test reads as an arbitrary penalty to the applicant.
 */
export const NARRATIVE_SHAPE_KEYS = new Set([
  'personal_statement', 'challenge', 'identity', 'talent', 'gratitude', 'activity',
]);

/**
 * @param {{ type?: string, prompt?: string, limit?: number, unit?: string }} essay
 * @returns {boolean} true when the arc test (through-line, movement, a turn) is the
 *   right test for this piece of writing
 */
export function isNarrativeEssay({ type = '', prompt = '', limit = 0, unit = 'words' } = {}) {
  const kind = String(type || '');
  if (kind === 'personal_statement' || kind === 'activity') return true;
  if (kind === 'why_this_school' || kind === 'scholarship') return false;
  return detectSupplementShapes({ prompt, limit: Number(limit) || 0, unit })
    .some((shape) => NARRATIVE_SHAPE_KEYS.has(shape.key));
}

// ---------------------------------------------------------------------------
// Voice by institution type: tone, structure, and the mindset on show
// ---------------------------------------------------------------------------
export const SCHOOL_VOICES = {
  oxbridge: {
    label: 'Oxford / Cambridge',
    brief: 'Academic first, and unapologetically so. Roughly 80% of the statement must be about the subject: what you have read beyond the syllabus, what you argued with, what you want to interrogate in a supervision. Extra-curricular material is allowed only where it demonstrates a transferable intellectual skill, and Cambridge caps non-academic content at about 20% of the answer it sits in. Do not sell yourself as a well-rounded person; sell yourself as someone who already reads like a first-year undergraduate in this subject. Tone: precise, modest about yourself and confident about the ideas. Never name the university.',
  },
  uk: {
    label: 'UK university',
    brief: 'Subject-led. The reader is a departmental academic deciding whether you can handle the course, not a holistic committee deciding whether they like you. Lead with motivation for the subject, then preparation (coursework, independent reading, competitions, relevant work), then anything else briefly. Tone: formal, evidence-based, no American-style personal storytelling, no hooks. Never name a university — one statement goes to every course choice.',
  },
  uc: {
    label: 'University of California',
    brief: 'The UC reader scores 13 holistic factors and reads four 350-word answers, quickly. Clarity beats craft: state the situation, what you did, what changed, in plain language, with numbers where they exist. The PIQs are not a personal statement and must not read like one — no lyrical openings, no extended metaphor. Each answer should make one factor legible (leadership, creativity, talent, opportunity, challenge, subject, community, or you as a candidate) without overlapping the others. Campus-agnostic: the same four answers go to every campus.',
  },
  elite_private: {
    label: 'Highly selective private research university',
    brief: 'Reads for intellectual vitality and distinction: what you do with your mind when nobody is grading you, and the one thing you are unusually good at or unusually obsessed by. The personal statement should be a single deep story with a real turn; supplements should each show a different facet, never the same one twice. Tone: confident but self-aware, concrete, willing to be odd. Generic ambition ("I want to help people") is fatal here because everyone in the pile has it; a specific, slightly strange, deeply pursued interest is what survives committee.',
  },
  public_flagship: {
    label: 'Large public university',
    brief: 'Reads at volume, often with an index and a short-answer set. Be direct, be concrete, and answer the question asked in the first sentence — the reader may give you two minutes. Leadership, initiative, and impact with numbers land best. Tone: plain-spoken and substantive, no literary warm-up.',
  },
  liberal_arts: {
    label: 'Liberal arts college',
    brief: 'Reads for fit with a small, discussion-based community: curiosity across subjects, willingness to be changed by an argument, and what you would add to a seminar and a dorm. Tone: warm, reflective, intellectually omnivorous but still specific. Named specifics about the college\'s particular structure (tutorials, a required thesis, a house system, a specific programme) matter more than prestige.',
  },
  general: {
    label: 'This university',
    brief: 'No cached reader profile for this school. Write for a trained admissions reader with a large pile and little time: answer the prompt directly, be concrete, and let one specific detail carry the personality. If University Research has a profile for this school, that overrides this default.',
  },
};

const OXBRIDGE = /oxford|cambridge|oxbridge/i;
const UK_OTHER = /imperial college|\bucl\b|university college london|\blse\b|london school of economics|edinburgh|manchester|bristol|warwick|durham|st andrews|glasgow|leeds|sheffield|nottingham|birmingham|exeter|york|lancaster|bath|cardiff|queen mary|kcl|king's college london|southampton|newcastle|liverpool|sussex|essex|kent|leicester|aberdeen|dundee|stirling|strathclyde|royal holloway|goldsmiths|city university|loughborough/i;
const ELITE_PRIVATE = /\bharvard\b|\byale\b|\bprinceton\b|\bstanford\b|\bmit\b|massachusetts institute|\bcaltech\b|california institute of technology|(?<!british\s)(?<!district\sof\s)\bcolumbia\b|\bupenn\b|university of pennsylvania|\bbrown university\b|\bdartmouth\b|\bcornell\b|\bduke\b|northwestern|johns hopkins|\brice\b|\bvanderbilt\b|university of chicago|\bu chicago\b|\bemory\b|carnegie mellon|\bgeorgetown\b|\btufts\b|\bnyu\b|new york university|\busc\b|university of southern california|\bboston college\b|\bnotre dame\b|wake forest|\brochester\b|case western|\bbrandeis\b/i;
const LIBERAL_ARTS = /williams college|\bamherst\b|swarthmore|\bpomona\b|wellesley|\bbowdoin\b|carleton|\bdavidson\b|middlebury|\bclaremont mckenna\b|\bhaverford\b|\bbryn mawr\b|\bcolby\b|\bcolgate\b|\bkenyon\b|\boberlin\b|\breed college\b|\bgrinnell\b|\bwhitman\b|\bskidmore\b|\bvassar\b|\bsmith college\b|\bmount holyoke\b|\bmacalester\b|\bdenison\b|\bunion college\b|\bbates\b|\bbucknell\b|\blafayette\b|\bpitzer\b|\bscripps college|\bharvey mudd\b|\boccidental\b|\btrinity college\b|\bwashington and lee\b|\bfurman\b|\brhodes college\b|\bsewanee\b|\bhamilton college\b|\bhobart\b|\bst olaf\b|depauw|gettysburg|\bdickinson college\b|\bfranklin and marshall\b|\bmuhlenberg\b|\bwheaton college|\bkalamazoo\b|\blewis and clark\b|\bbeloit\b|\bcolorado college\b/i;
const PUBLIC_FLAGSHIP = /university of michigan|\bumich\b|\bunc\b|university of north carolina|university of virginia|\buva\b|university of florida|\bgators\b|university of texas|\but austin\b|texas a&m|university of wisconsin|\bmadison\b|purdue|university of georgia|\buga\b|penn state|\bpsu\b|ohio state|university of illinois|\buiuc\b|university of washington|\buw\b|university of maryland|\bumd\b|university of pittsburgh|\bpitt\b|rutgers|indiana university|university of connecticut|\buconn\b|michigan state|university of minnesota|\biowa state\b|university of iowa|university of colorado|\bcolorado state\b|university of oregon|oregon state|arizona state|\bucla\b|university of arizona|temple university|university of kansas|kansas state|university of missouri|\bmizzou\b|university of tennessee|\bnebraska\b|clemson|auburn|university of south carolina|university of alabama|\blsu\b|louisiana state|university of oklahoma|oklahoma state|university of utah|utah state|university of new mexico|university of nevada|university of delaware|university of kentucky|university of louisville|university of massachusetts|\bumass\b|state university/i;

/**
 * The reader profile for a school. Platform rules (UCAS/UC) win over name
 * matching, because a UK applicant is read by a department regardless of how
 * the university brands itself.
 */
export function schoolVoiceFor(university, platform) {
  const resolvedPlatform = platform || getUniversityPlatform(university);
  const name = String(university?.name || '');
  if (resolvedPlatform === 'ucas') {
    return OXBRIDGE.test(name) ? SCHOOL_VOICES.oxbridge : SCHOOL_VOICES.uk;
  }
  if (resolvedPlatform === 'uc') return SCHOOL_VOICES.uc;
  if (!name) return SCHOOL_VOICES.general;
  if (OXBRIDGE.test(name)) return SCHOOL_VOICES.oxbridge;
  if (UK_OTHER.test(name)) return SCHOOL_VOICES.uk;
  if (ELITE_PRIVATE.test(name)) return SCHOOL_VOICES.elite_private;
  if (LIBERAL_ARTS.test(name)) return SCHOOL_VOICES.liberal_arts;
  if (PUBLIC_FLAGSHIP.test(name)) return SCHOOL_VOICES.public_flagship;
  return SCHOOL_VOICES.general;
}

// ---------------------------------------------------------------------------
// The score anchors: what 10/10 actually means on each dimension
// ---------------------------------------------------------------------------
/**
 * A shared scale, so a 7 in one review means the same as a 7 in the next.
 * Without anchors the model re-derives the scale every call, which is why the
 * same essay could score 6 and then 8 with nothing changed in between.
 */
export const SCORE_ANCHORS = {
  overall: {
    10: 'Ready to submit as-is. Nothing in it would cost the applicant anything, and a reader would remember it.',
    9: 'Excellent. One small thing separates it from a 10 and it is named in the weaknesses.',
    7: 'Competitive at this school. Doing its job, with a couple of fixable soft spots.',
    5: 'Average for this pile. Well-written, forgettable, interchangeable with a thousand others.',
    3: 'Actively working against the applicant: off-prompt, generic, or dishonest-sounding.',
    1: 'Cannot be submitted in this state.',
  },
  dimension: {
    10: 'Could not be meaningfully better at this level of the application.',
    8: 'Strong, with one identifiable improvement left.',
    6: 'Adequate but unremarkable — the default for competent, generic writing.',
    4: 'A real problem a reader would notice.',
    2: 'A serious flaw that could cost the application.',
  },
};

/**
 * The seven dimensions of an essay review, in the order the panel renders them.
 * REVIEW_SCHEMA and EssayReviewPanel both read this list, so the prompt, the
 * response contract, and the UI cannot drift apart again. (`risk` and `length`
 * used to be asked for in the prompt and then thrown away because the schema
 * had no field for them.)
 */
export const ESSAY_REVIEW_DIMENSIONS = [
  { key: 'prompt_alignment', label: 'Prompt alignment', field: 'prompt_alignment_score', question: 'Does it answer THIS prompt and serve its job, without stealing another essay\'s material?' },
  { key: 'authenticity', label: 'Authenticity', field: 'authenticity_score', question: 'Could only this person have written it? Does it match the profile and their own materials?' },
  { key: 'specificity', label: 'Specificity', field: 'specificity_score', question: 'Names, numbers, objects, and actions — or abstraction and summary?' },
  { key: 'structure', label: 'Structure', field: 'structure_score', question: 'Does it move? One story, forward in time, every paragraph earning the next?' },
  { key: 'voice', label: 'Voice', field: 'voice_score', question: 'Natural, precise, age-appropriate, free of AI tells and essay-ese?' },
  { key: 'risk', label: 'Risk', field: 'risk_score', question: 'What would an adversarial reader object to? Overclaiming, humblebragging, an unearned lesson, a detail that smells borrowed?' },
  { key: 'length', label: 'Length', field: 'length_score', question: 'Does it use the space it was given and stay inside the ceiling? Every word earning its place?' },
];

// ---------------------------------------------------------------------------
// Composing the craft brief for one essay
// ---------------------------------------------------------------------------
function bulletList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

/**
 * Everything the model needs to know about HOW to write this particular essay:
 * its type, the shape of the question, and the reader it is written for.
 *
 * @param {object} args { essay, university, platform, limit, unit }
 * @returns {string}
 */
export function craftBrief({ essay, university, platform, limit = 0, unit = 'words' } = {}) {
  const type = essay?.type || 'supplemental';
  const craft = ESSAY_CRAFT_BY_TYPE[type] || ESSAY_CRAFT_BY_TYPE.supplemental;
  const voice = schoolVoiceFor(university, platform);
  const prompt = String(essay?.prompt || '');
  const shapes = type === 'supplemental' || type === 'other'
    ? detectSupplementShapes({ prompt, limit, unit })
    : [];

  const parts = [
    `HOW TO WRITE THIS KIND OF ESSAY (${craft.label}) — follow this, it is the difference between a 6 and a 9:`,
    `Its job: ${craft.job}`,
    `Structure:\n${bulletList(craft.structure)}`,
    `Tone: ${craft.tone}`,
    `Mindset you must be in while writing: ${craft.mindset}`,
    `Failure modes to avoid:\n${bulletList(craft.traps)}`,
    `What 10/10 looks like here: ${craft.ten_out_of_ten}`,
  ];

  for (const shape of shapes) {
    parts.push(`\nSHAPE OF THIS SPECIFIC QUESTION — ${shape.label}:\n${shape.craft}`);
  }

  parts.push(`\nWHO IS READING IT (${voice.label}):\n${voice.brief}`);

  // Named specifics from cached research beat generic advice, so tell the model
  // to prefer them whenever the university profile supplies them.
  parts.push('If the university research below names an ideal student, a mission, or specific programmes, those override the general reader profile above.');

  return parts.join('\n');
}

/** One-line reminder of the ambition Atlas expects, used by every writing prompt. */
export const AMBITION_RULES = `STANDARD YOU ARE WORKING TO:
- You are not producing "a draft". You are producing the version of this essay that gets read aloud in committee. Assume the applicant will submit exactly what you return, with no further editing.
- Aim at 10/10 on every dimension at once: prompt alignment, authenticity, specificity, structure, voice, risk, and length. An essay that is brilliant and 60% of its length is a 6, not a 9.
- Before you return, read your own answer once as a hostile reader and once as a tired reader. Fix what either of them would notice. Then return it.`;

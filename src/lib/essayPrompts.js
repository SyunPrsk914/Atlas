// Prompt construction for the three AI actions in the Essay Builder.
// Kept out of the component so the generate / review / polish instructions can
// be reviewed (and fixed) in one place.

import { buildProfileContext } from './profileContext';
import {
  measureEssay, limitUnitFor, formatLimit, isUcasQuestion, ucasQuestionFor,
  ucasCharacterBudget, isAmbiguousCommonAppPrompt,
} from './applicationData';

/** Shared writing = one answer that is identical at every school on a platform. */
function platformBrief(university, platform) {
  if (platform === 'common_app') {
    return `This essay is the SHARED Common Application personal statement. It is sent word-for-word identical to every Common App school on your list. Therefore it must contain NO school-specific content at all: no university names, no "your campus", no programme references, no callbacks to a supplement. If it names a school, it is wrong.`;
  }
  if (platform === 'uc') {
    return `This is a UC Personal Insight Question answer. The same answer goes to every UC campus you select, so keep it campus-agnostic. UC answers 350 words exactly, and the admissions reader is scoring 13 holistic factors — your job is to make your evidence legible, not to be brilliant.`;
  }
  if (platform === 'ucas') {
    return `This is ONE answer in the UCAS personal statement, not all three questions. Characters are counted including spaces: 4,000 shared across the three answers, 350 minimum in each box. The same wording goes to every course choice, so never name a university or a specific campus. Oxford expects roughly 80% academic content, and Cambridge caps non-academic material at 20% of the answer it sits in — draft to the tighter of those.`;
  }
  if (platform === 'coalition') {
    return `This is the SHARED Coalition Application personal essay, sent identically to every Coalition member school. No school-specific content.`;
  }
  return `This essay is written only for ${university?.name || 'this university'}. Specificity is the whole point — researched programmes, people, and traditions, not generic praise.`;
}

function essayRoleBrief(essay) {
  const type = essay?.type;
  const table = {
    personal_statement: 'Reveal who the applicant is: values, identity, context, and what changed in them. This is not a resume written in prose.',
    supplemental: 'Answer THIS prompt and nothing else. Supplemental essays are read as a set, so repeating what another essay already said is the most common way to lose an admission.',
    why_this_school: 'Prove you did the research. Specific programmes, named people, real traditions or specific problems the school is working on. Generic praise is worse than saying nothing.',
    activity: 'Show what you LEARNED and how it changed your thinking. A list of duties is a failure here.',
    scholarship: 'Make the case for support: what you have contributed, what you will contribute, and why this specific fund.',
    other: 'Answer the prompt as written. Treat it as its own job, not as an extra essay.',
  };
  return table[type] || table.supplemental;
}

const HUMAN_VOICE_RULES = `VOICE RULES — this is the single most important section:
- Write like a thoughtful 17-18 year old who is genuinely good at thinking, not like an adult writing about a teenager, and certainly not like a language model.
- BANNED constructions (do not use these, in any form): "In conclusion", "This experience taught me", "Through this journey", "I realized that", "It was then that I understood", "Looking back", "furthermore", "moreover", "in today's world", "it is important to note", "delve", "tapestry", "a testament to", "embark", "underscore", "navigate the complexities".
- No rhetorical questions to the reader. No summarizing your own lesson at the end. No "only time I…" construction.
- Avoid three-part lists everywhere — real thinking is lumpy. Vary sentence length hard: let some sentences run long and then hit the reader with a short one.
- Use plain, precise words. "Used" beats "utilized". "Showed" beats "showcased". "Wanted to" beats "aspired to".
- Concrete over abstract, always: a name, a number, a time, a place, a specific object, a specific thing someone said.
- Do NOT invent experiences. If the profile does not contain a detail you need, write around it and let the applicant fill it in afterwards.`;

/** The applicant's own knowledge base (About you, personal points, patterns), when there is one. */
function applicantSection(applicantText) {
  const text = String(applicantText || '').trim();
  if (!text) return '';
  return `APPLICANT KNOWLEDGE BASE (AI-built and applicant-edited. Keep the writing consistent with who this applicant is. Do not add facts beyond it and the materials):\n${text}\n\n`;
}

function rootBrief(essay) {
  const root = String(essay?.draft_anchor || '').trim();
  if (!root) {
    return `APPLICANT'S REQUIRED ROOT / DIRECTION:\nNo root has been entered yet. Do not silently select a random activity just because it appears in the materials. Use only details that clearly serve this prompt, and put any missing personal decision or detail in gaps_for_applicant.`;
  }
  return `APPLICANT'S REQUIRED ROOT / DIRECTION (hard constraint):
${root}

Start from this direction. Do not swap in a different activity, hobby, or achievement merely because it is more convenient in the materials. Use the profile, deep material readings, guidance, and craft patterns to expand, verify, complicate, and structure this root. If a necessary concrete detail is not available, leave a clear gap for the applicant rather than inventing one.`;
}

function lengthBrief(essay, allEssays) {
  if (isUcasQuestion(essay)) {
    const budget = ucasCharacterBudget(allEssays?.length ? allEssays : [essay]);
    const mine = String(essay.content || '').length;
    const others = Math.max(0, budget.total - mine);
    const room = Math.max(0, budget.limit - others);
    const question = ucasQuestionFor(essay);
    return `LENGTH: this is UCAS question ${question?.number || ''} of 3 only. Minimum ${question?.minChars || 350} characters in this box. The three answers SHARE ${budget.limit.toLocaleString()} characters including spaces. The other answers currently use ${others.toLocaleString()}, so this answer must stay within ${room.toLocaleString()} characters. Do not write ${budget.limit.toLocaleString()} characters in this box.`;
  }
  const unit = limitUnitFor(essay);
  const limit = Number(essay.word_limit) || (unit === 'characters' ? 4000 : 650);
  const current = measureEssay(essay.content || '', unit);
  const remaining = limit - current;
  const sign = remaining >= 0 ? '' : '-';
  return `LENGTH: the limit is ${limit.toLocaleString()} ${formatLimit(unit)}. The current draft is ${current.toLocaleString()} ${formatLimit(unit)} — ${sign}${Math.abs(remaining).toLocaleString()} ${formatLimit(unit)} ${remaining >= 0 ? 'remaining' : 'over'}. Respect the limit.`;
}

// ---------------------------------------------------------------------------
export function buildGeneratePrompt({ essay, university, platform, profileText, knowledgeText, materialsText, applicantText = '', allEssays }) {
  const unit = limitUnitFor(essay);
  const limit = Number(essay.word_limit) || (unit === 'characters' ? 4000 : 650);
  const promptWarning = isAmbiguousCommonAppPrompt(essay?.prompt)
    ? 'The prompt field currently contains more than one official prompt. Do not write a draft. Say in essay_analysis that the applicant must choose exactly one prompt first, and leave essay empty.'
    : '';

  return `You are an elite college admissions essay consultant who has read thousands of admitted students' essays. You understand holistic admissions and, above all, THE SPECIFIC ROLE each essay plays.
${promptWarning}

THE ROLE OF THIS PARTICULAR ESSAY:
${essayRoleBrief(essay)}

${platformBrief(university, platform)}

STUDENT PROFILE (use every relevant detail; do not ignore any of it. This is the foundation — every essay must sound like THIS person):
${profileText || 'No profile has been saved yet. Write something structurally excellent and leave clear gaps for the applicant to fill with their own details — never invent a life for them.'}

SUPPORTING MATERIALS — READ CAREFULLY (this is the core knowledge base you must use):
${materialsText}

${applicantSection(applicantText)}
CRITICAL RULES FOR USING MATERIALS:
- APPLICANT-OWNED MATERIALS are evidence, but each has an analysis lens. Use a writing draft, personal reflection, resume, or applicant note for concrete experiences only when its text supports them. An academic assessment can reveal intellectual questions, methods, standards, and habits without becoming a college-essay score; do not invent biography from it. Keep direct facts separate from cautious interpretation.
- TIPS, GUIDES, AND APPLICATION REFERENCES are rules and constraints, not the applicant's experiences or personality. Apply their useful guidance without turning examples, statistics, or advice into life facts.
- SAMPLE / SUCCESSFUL ESSAYS are NOT this student's life. Study them for CRAFT ONLY: how they open, how they structure evidence, how they reflect, what tone they use, and how they show emotion with specific words. NEVER copy a person, place, event, or achievement from a sample into this draft.
- PLATFORM DISTINCTION: Some samples are US (Common App 650w, UC PIQ 350w) and some are UK (UCAS 4000 chars across 3 Qs). When writing for ${platform === 'ucas' ? 'UCAS (UK)' : 'US platforms (Common App, UC, Coalition, Direct)'}, prioritize samples from the SAME system for structural guidance. You may learn voice/tone from any sample, but NEVER apply UK UCAS structure (3 questions sharing 4000 chars, 80% academic) to a US essay, and NEVER apply US Common App structure to a UCAS answer. This is obvious and you must distinguish.
- If a material has an attached deep analysis, use the section appropriate to its lens: facts/evidence for applicant-owned sources, intellectual signals for academic work, guidance for references, and craft moves for samples. Do not treat every analysis as a writing score.

UNIVERSITY RESEARCH (from University Research; if empty, use well-established knowledge and say nothing specific you are unsure of):
${knowledgeText}

THE ESSAY TO WRITE:
- University: ${university?.name || 'Unspecified'}
- Programme / major: ${university?.major || 'Not specified'}
- Essay type: ${essay?.type}
- Prompt: ${essay?.prompt || 'No prompt supplied — write a personal statement that reveals who the applicant is.'}
- ${isUcasQuestion(essay) ? lengthBrief(essay, allEssays) : `Limit: ${limit.toLocaleString()} ${formatLimit(unit)}${unit === 'characters' ? ' (counted in characters INCLUDING spaces)' : ''}`}

${rootBrief(essay)}

${HUMAN_VOICE_RULES}

HOW TO WORK:
1. Decide what this prompt is really asking before writing a word, and make a specific choice about how the required root serves it.
2. Treat the required root as the starting point, not an optional suggestion. Find two or three concrete details in the profile and materials that deepen that root; do not replace it with a different activity. If a needed detail is missing, leave a clearly named gap.
3. Apply guidance and craft patterns as methods, not as content. Never turn a tips document or sample biography into the applicant's life.
4. Write the draft. Then read it back as an admissions officer and cut anything that is doing decorative rather than evidential work.
5. Do not open with a general statement about yourself. Do not close with a moral.

Return the essay text only in "essay", and a short explanation in "essay_analysis" of the role this essay plays in the holistic application and how this draft serves that role.`;
}

export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    essay: { type: 'string' },
    essay_analysis: { type: 'string' },
    used_profile_details: { type: 'array', items: { type: 'string' } },
    gaps_for_applicant: { type: 'array', items: { type: 'string' } },
  },
};

export function buildReviewPrompt({ essay, university, platform, knowledgeText, reviewNotes, allEssays, materialsText = '', profileText = '', applicantText = '' }) {
  return `You are a senior admissions officer at ${university?.name || 'this university'} reading a stack of real files. Be strict. Most applicants here are qualified and still rejected.

${lengthBrief(essay, allEssays)}

JUDGE ONLY AGAINST WHAT THIS PROMPT ACTUALLY ASKS:
${essayRoleBrief(essay)}

${platformBrief(university, platform)}

${rootBrief(essay)}

THE PROMPT: ${essay?.prompt || 'Personal statement'}
THE ESSAY:
<<<ESSAY
${essay?.content || ''}
ESSAY>>>

${lengthBrief(essay, allEssays)}

UNIVERSITY RESEARCH AND IDEAL STUDENT:
${knowledgeText || 'No research cached. Judge on the quality of the writing itself.'}

${profileText ? `APPLICANT PROFILE (use to check if essay uses their real context):\n${profileText}\n` : ''}${materialsText ? `SUPPORTING MATERIALS (use each source according to its analysis lens: applicant-owned evidence is not all essay prose; academic work informs intellectual habits; guidance is not biography; samples are craft only. Distinguish US vs UK samples: do not apply UK UCAS conventions to US essays or vice versa):\n${materialsText}\n` : ''}${applicantSection(applicantText)}${reviewNotes ? `PREVIOUS REVIEW FINDINGS TO RE-CHECK (did this draft actually fix them?):\n${reviewNotes}\n` : ''}
Evaluate on exactly these dimensions, each scored 1-10 where 5 is average for this admissions pool:
1. prompt_alignment — does it answer THIS prompt, serving ITS role, without stealing another essay's material?
2. authenticity — could a specific person have written this, or is it generically well-written? Check against profile and own materials — does it sound like THIS applicant?
3. specificity — names, numbers, concrete actions, or abstraction? Does it use the concrete details from their own materials?
4. structure — does the reader get to a point, or wander?
5. voice — natural, precise, age-appropriate, free of AI tells?
6. risk — what would an adversarial reader object to? Overclaiming, humblebragging, a lesson that is not earned, a detail that seems borrowed from a sample.
7. length — does it respect its limit, and does it earn every word it spends?

Be concrete: quote the exact phrases you are objecting to. "Feels AI-generated" is not a finding; "\"In the end, this experience taught me that…" appears in the third paragraph" is.

If the essay fails to honor the applicant's required root, call that out as a weakness even if the prose is polished. If no root was supplied, say that the drafting direction is underspecified rather than penalizing the essay for not guessing it.
If the essay fails to use available personal context from materials, call that out as a weakness.

Return JSON only.`;
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    overall_score: { type: 'number' },
    prompt_alignment_score: { type: 'number' },
    authenticity_score: { type: 'number' },
    specificity_score: { type: 'number' },
    structure_score: { type: 'number' },
    voice_score: { type: 'number' },
    sounds_like_ai: { type: 'boolean' },
    word_count: { type: 'number' },
    limit: { type: 'number' },
    over_limit: { type: 'boolean' },
    ai_patterns_detected: { type: 'array', items: { type: 'string' } },
    quoted_evidence: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    priority_improvements: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

export function buildPolishPrompt({ essay, university, platform, reviewResult, knowledgeText, allEssays, materialsText = '', profileText = '', applicantText = '' }) {
  return `You are a master essay editor. Your job is to make this essay more human, more specific, and better aligned to its prompt — without inventing anything.

${essayRoleBrief(essay)}

${platformBrief(university, platform)}

${rootBrief(essay)}

${HUMAN_VOICE_RULES}

${reviewResult ? `FINDINGS YOU MUST ACTUALLY FIX (the applicant will check):
- Weaknesses: ${(reviewResult.weaknesses || []).join(' | ') || 'none reported'}
- Priority improvements: ${(reviewResult.priority_improvements || []).join(' | ') || 'none reported'}
- AI tells flagged: ${(reviewResult.ai_patterns_detected || []).join(' | ') || 'none reported'}
- Exact phrases flagged: ${(reviewResult.quoted_evidence || []).join(' | ') || 'none reported'}
` : ''}

${lengthBrief(essay, allEssays)}

UNIVERSITY RESEARCH:
${knowledgeText || 'None cached.'}

${profileText ? `APPLICANT PROFILE (use concrete details from here when possible):\n${profileText}\n` : ''}${materialsText ? `SUPPORTING MATERIALS (use applicant-owned evidence according to its lens; academic work informs thinking, guidance supplies rules, samples supply craft only and never borrowed life. Distinguish US vs UK):\n${materialsText}\n` : ''}${applicantSection(applicantText)}CURRENT DRAFT:
<<<ESSAY
${essay?.content || ''}
ESSAY>>>

Rules:
- Do not invent experiences, names, numbers, or outcomes. If a change needs a fact you do not have, leave the sentence out rather than guessing.
- Preserve and strengthen the applicant's required root. Never replace it with a more convenient activity or a sample writer's story.
- Use concrete evidence from the appropriate applicant-owned sources — names, numbers, roles, outcomes, or intellectual questions — when the draft needs it. Do not turn an academic assessment, guidance source, or cautious interpretation into a claimed personal experience.
- For craft, you may borrow technique from samples that match this platform (US samples for US essays, UK samples for UCAS), but never borrow a life event.
- Cut, do not pad. If the draft is at its limit, every addition must be paid for by a deletion.
${limitUnitFor(essay) === 'characters' ? '- This limit is in CHARACTERS including spaces. Check your output length before returning it.' : '- Stay inside the word limit.'}

Return only the revised essay text. No headers, no commentary, no explanation, no markdown fences.`;
}

export { buildProfileContext };

// ---------------------------------------------------------------------------
// Full application review
//
// This is a different contract from REVIEW_SCHEMA above. REVIEW_SCHEMA scores a
// single essay; the application review scores a whole file against one
// university's holistic rubric, so it needs the seven named dimensions, an
// estimated acceptance probability, and a verdict. The page renders exactly
// these field names — keep the two in step.
// ---------------------------------------------------------------------------

/** The seven dimensions the review prompt asks for, in order. */
export const APPLICATION_REVIEW_DIMENSIONS = [
  'Academic Excellence',
  'Extracurricular Distinction',
  'Essay Quality',
  'Personal Character',
  'Institutional Fit',
  'Contextual Factors',
  'Overall Cohesion',
];

export const APPLICATION_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    acceptance_probability: { type: 'number' },
    verdict: { type: 'string', enum: ['Hard Reach', 'Reach', 'Target', 'Likely', 'Safety'] },
    dimensions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', enum: APPLICATION_REVIEW_DIMENSIONS },
          score: { type: 'number' },
          assessment: { type: 'string' },
        },
        required: ['name', 'score', 'assessment'],
      },
    },
    key_strengths: { type: 'array', items: { type: 'string' } },
    key_weaknesses: { type: 'array', items: { type: 'string' } },
    what_would_help: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: [
    'acceptance_probability', 'verdict', 'dimensions',
    'key_strengths', 'key_weaknesses', 'what_would_help', 'gaps', 'summary',
  ],
};

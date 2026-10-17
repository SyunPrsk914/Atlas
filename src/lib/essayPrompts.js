// Prompt construction for the AI actions in the Essay Builder.
// Kept out of the component so the generate / review / edit / repair
// instructions can be reviewed (and fixed) in one place.
//
// Three contracts live here and must not drift apart:
//   * GENERATE_SCHEMA  — a new draft, its rationale, and the gaps it left.
//   * REVIEW_SCHEMA    — one essay scored on seven named dimensions.
//   * POLISH_SCHEMA    — a surgical revision plus an itemised change log, which
//                        is what makes the highlighted comparison possible.
// The craft knowledge (how each kind of essay is written, and who reads it) is
// in ./essayCraft; the length rules are in ./essayLength.

import { buildProfileContext } from './profileContext';
import {
  limitUnitFor, formatLimit, isUcasQuestion, isAmbiguousCommonAppPrompt,
  isSharedEssay, doesPlatformShareEssays,
} from './applicationData';
import {
  LENGTH_CRAFT_RULES, assessLength, buildLengthContractText, lengthContract,
} from './essayLength';
import {
  AMBITION_RULES, ESSAY_REVIEW_DIMENSIONS, SCORE_ANCHORS, craftBrief, schoolVoiceFor,
} from './essayCraft';
import { buildFitBrief } from './schoolFit';
import { interpretRoot } from './essayRoot';
import { extractFlaggedPhrases } from './essayEditCheck';

/**
 * Sampling temperature per action.
 *
 * A review is a measurement: run twice over the same text it should give the
 * same numbers, so it runs cold. Drafting needs some range. Editing must stay
 * close to the original, so it runs cool but not frozen. Length repair has to
 * write new prose inside a fixed shape.
 */
export const AI_TEMPERATURES = {
  generate: 0.75,
  polish: 0.35,
  repair: 0.6,
  review: 0.15,
};

/**
 * What the platform's sharing rules mean for THIS essay.
 *
 * A Common App school-specific supplement sits on a platform whose personal
 * statement is shared, and telling it "no school-specific content" makes the
 * model write a "Why us" essay that refuses to mention the school. Only an
 * essay that is actually sent identically to every school on the platform has
 * to stay name-free.
 */
function platformBrief(essay, university, platform) {
  const sentToEverySchool = isSharedEssay(essay)
    || (!essay?.university_id && essay?.type === 'personal_statement' && doesPlatformShareEssays(platform));
  if (!sentToEverySchool && (essay?.university_id || essay?.scope)) {
    return `This essay is written only for ${university?.name || 'this university'}, even though that school's other essays may be shared. Specificity is the whole point: name the school where it earns its place, and use researched programmes, people, and traditions rather than generic praise. It must not repeat what the shared personal statement already says.`;
  }
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

/** The one-line job of this essay type. The full craft is in ./essayCraft. */
export function essayRoleBrief(essay) {
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
- BANNED constructions (do not use these, in any form): "In conclusion", "This experience taught me", "Through this journey", "I realized that", "It was then that I understood", "Looking back", "furthermore", "moreover", "in today's world", "it is important to note", "delve", "tapestry", "a testament to", "embark", "underscore", "navigate the complexities", "a journey of self-discovery", "sparked a passion".
- No rhetorical questions to the reader. No summarizing your own lesson at the end. No "only time I…" construction.
- Avoid three-part lists everywhere — real thinking is lumpy. Vary sentence length hard: let some sentences run long and then hit the reader with a short one.
- Use plain, precise words. "Used" beats "utilized". "Showed" beats "showcased". "Wanted to" beats "aspired to".
- Concrete over abstract, always: a name, a number, a time, a place, a specific object, a specific thing someone said.
- Do NOT invent experiences. If the profile does not contain a detail you need, write around it and let the applicant fill it in afterwards. A named gap is honest; an invented detail is a lie that can be caught in an interview.`;

/** The applicant's own knowledge base (About you, personal points, patterns), when there is one. */
function applicantSection(applicantText) {
  const text = String(applicantText || '').trim();
  if (!text) return '';
  return `APPLICANT KNOWLEDGE BASE (AI-built and applicant-edited. Keep the writing consistent with who this applicant is. Do not add facts beyond it and the materials):\n${text}\n\n`;
}

export function rootBrief(essay) {
  const root = String(essay?.draft_anchor || '').trim();
  if (!root) {
    return `APPLICANT'S REQUIRED ROOT / DIRECTION:\nNo root has been entered yet. Do not silently select a random activity just because it appears in the materials. Use only details that clearly serve this prompt, and put any missing personal decision or detail in gaps_for_applicant.`;
  }
  // Atlas reads the direction as an instruction first, so the model is told what
  // Atlas will hold it to, rather than discovering it in the feedback afterwards.
  const reading = interpretRoot(root);
  const shape = reading.chooseOne
    ? `Atlas has classified this direction as CHOOSE-ONE: ${reading.alternatives.length || 'several'} options are listed and exactly ONE of them may carry the essay.`
    : reading.includeAll
      ? `Atlas has classified this direction as INCLUDE-ALL: every listed option is a requirement.`
      : reading.alternatives.length >= 2
        ? `Atlas reads ${reading.alternatives.length} options here with no instruction to include all of them, so ONE must be chosen as the through-line.`
        : `Atlas reads this as a single direction with no list of alternatives.`;
  const options = reading.alternatives.length
    ? `\nOptions found in the direction: ${reading.alternatives.map((item) => `"${item.label}"`).join(', ')}.`
    : '';
  const rules = reading.constraints.length
    ? `\nStated rules you must satisfy${reading.chooseOne ? ' while narrowing to one option' : ''}: ${reading.constraints.map((item) => `"${item.text}" (${item.polarity})`).join('; ')}.`
    : '';
  return `APPLICANT'S REQUIRED ROOT / DIRECTION (hard constraint):
${root}

Start from this direction. Do not swap in a different activity, hobby, or achievement merely because it is more convenient in the materials. Use the profile, deep material readings, guidance, and craft patterns to expand, verify, complicate, and structure this root. If a necessary concrete detail is not available, leave a clear gap for the applicant rather than inventing one.

HOW ATLAS READS THIS DIRECTION — and what it will check your draft against:
${shape}${options}${rules}
- Read the meaning of the direction, not its word count. Separate hard constraints ("must", "only", "never", "choose one") from examples, brainstormed options, and possible angles.
- A numbered or bulleted list inside the direction is a menu of possible subjects, not an outline to fill in. If the applicant says to choose one, choose ONE; one paragraph per option is the single most common way an essay like this fails, and it is why the draft will be rejected and sent back.
- Include multiple items only when the applicant explicitly makes each one a requirement and they genuinely fit the prompt. If the direction is contradictory or impossible to honor, do not guess: explain the conflict and leave a question in gaps_for_applicant.
- Say in essay_analysis which option you built on and why the others were dropped. Atlas checks that claim against the draft word by word.`;
}

/**
 * Splits the applicant's edit instructions into the sentences Atlas will hold
 * the model to. One instruction per line or per sentence; bullets and numbers
 * are stripped. Shared by the prompt (which numbers them) and the check in
 * ./essayEditCheck (which verifies them), so both see the same list.
 */
export function splitEditInstructions(text) {
  const value = String(text || '').replace(/\r\n?/g, '\n');
  if (!value.trim()) return [];
  const out = [];
  for (const line of value.split('\n')) {
    const bare = line.replace(/^\s*(?:[-*•]|\d+[.)]|[a-z][.)])\s+/i, '').trim();
    if (!bare) continue;
    for (const piece of splitSentencesOutsideQuotes(bare)) {
      const sentence = piece.trim();
      if (sentence.replace(/[.!?]+$/, '').length >= 3) out.push(sentence);
    }
  }
  return out;
}

const ABBREVIATION_END = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|mr|mrs|ms|dr|prof|st|no|para|p|pp|approx)\.?$/i;
const isBoundaryChar = (ch) => !ch || /[\s([{,:;—–-]/.test(ch);
const isCloseChar = (ch) => !ch || /[\s)\]}.,:;!?—–-]/.test(ch);

/**
 * Splits at sentence ends that are not inside quotation marks, so
 * "replace 'x. y' with 'z'" stays one instruction. An apostrophe inside a word
 * (don't, teacher's) is never a quote.
 */
function splitSentencesOutsideQuotes(text) {
  const pieces = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if ((quote === '"' && ch === '"') || (quote === '“' && ch === '”') || (quote === '`' && ch === '`')
        || (quote === "'" && ch === "'" && isCloseChar(text[i + 1]))) quote = null;
      continue;
    }
    if (ch === '"' || ch === '“' || ch === '`') { quote = ch; continue; }
    if (ch === "'" && isBoundaryChar(text[i - 1])) { quote = "'"; continue; }
    if (/[.!?]/.test(ch)) {
      let end = i;
      while (/[.!?]/.test(text[end + 1] || '')) end += 1;
      const next = text[end + 1];
      // Only a stop followed by a space (or the end) closes a sentence, and
      // "e.g.", "i.e.", "etc.", "vs.", "Dr." never do.
      const abbreviation = ABBREVIATION_END.test(text.slice(Math.max(0, start), i));
      if ((!next || /\s/.test(next)) && !abbreviation) {
        pieces.push(text.slice(start, end + 1));
        start = end + 1;
      }
      i = end;
    }
  }
  if (start < text.length) pieces.push(text.slice(start));
  return pieces;
}

/**
 * The applicant's own change list, as a binding block. Comes AFTER the root
 * (which it may narrow but never contradict) and BEFORE the review findings
 * (which it outranks: a finding the applicant did not ask for is advice, an
 * instruction is an order).
 *
 * @param {string} editInstructions
 * @param {{ mode?: 'draft'|'edit' }} [options]
 */
export function editInstructionsBrief(editInstructions, { mode = 'edit' } = {}) {
  const items = splitEditInstructions(editInstructions);
  if (!items.length) return '';
  const numbered = items.map((item, index) => `${index + 1}. ${item}`).join('\n');
  return `APPLICANT'S EDIT INSTRUCTIONS (binding — every numbered sentence must be carried out):
${numbered}

PRIORITY ORDER, highest first: (1) the required root above, (2) these instructions, (3) the length contract, (4) ${mode === 'edit' ? 'the review findings and optional ideas below' : 'the craft rules and the general guidance'}. Where an instruction and ${mode === 'edit' ? 'a review finding' : 'a craft rule'} pull in different directions, the instruction wins and you say so in your report. Where an instruction and the root conflict, keep the root, do NOT carry out that instruction, and report the conflict under "instructions_not_followed" — never resolve it by guessing.
- Carry out each instruction literally and completely: an instruction to cut a sentence means the sentence is gone; an instruction to add a detail means the detail appears where it was asked for; an instruction to keep a phrase means the phrase survives word for word.
- Do not "interpret" an instruction into something easier. If one cannot be carried out without inventing a fact, do not invent it: report it under "instructions_not_followed" with the fact you would need.
- For every instruction return one entry under "instructions_followed" ({"instruction", "how"}: which words changed), or under "instructions_not_followed" ({"instruction", "why"}). Atlas checks the draft against each instruction and shows the applicant the ones you missed.`;
}

/**
 * The send-back text used when a finished draft ignored or overstuffed the root.
 * It is a correction, not a fresh brief: everything else the model was told
 * (craft, voice, length) still applies.
 */
export function buildRootCorrection(check) {
  if (!check || !check.correction) return '';
  return `ROOT CHECK — ATLAS REJECTED YOUR LAST ANSWER BEFORE SENDING IT BACK:
${check.message}
${check.correction}

Keep everything that already worked: the voice, the evidence, the structure, and the length contract. Change the relationship between the essay and the applicant's direction, and nothing else about the job you were given.`;
}

/**
 * The length facts, measured by Atlas rather than guessed at by the model.
 * Used in the review prompt so `length_score` is scored against reality, and
 * in the UI so a model's own word count can never disagree with the editor.
 */
export function lengthFacts(essay, allEssays, draftText) {
  const assessment = assessLength(draftText === undefined ? essay?.content : draftText, essay, allEssays);
  const words = formatLimit(assessment.unit);
  return {
    assessment,
    text: `MEASURED LENGTH (counted by Atlas, not estimated): ${assessment.message}\nTarget band for a finished draft: ${assessment.targetLow.toLocaleString()}–${assessment.targetHigh.toLocaleString()} ${words}. Ceiling: ${assessment.limit.toLocaleString()} ${words}.`,
  };
}

/** Kept for the UCAS box, where the shared budget is the story. */
export function lengthBrief(essay, allEssays) {
  const contract = lengthContract(essay, allEssays);
  if (isUcasQuestion(essay) && contract.shared) {
    return `LENGTH: this is UCAS question ${contract.questionNumber || ''} of 3 only. Minimum ${contract.platformMin} characters in this box. The three answers SHARE ${contract.shared.limit.toLocaleString()} characters including spaces. The other answers currently use ${contract.shared.usedByOthers.toLocaleString()}, so this answer must stay within ${contract.shared.room.toLocaleString()} characters. Do not write ${contract.shared.limit.toLocaleString()} characters in this box.`;
  }
  const unit = contract.unit;
  return `LENGTH: the limit is ${contract.limit.toLocaleString()} ${formatLimit(unit)}. The current draft is ${contract.count.toLocaleString()} ${formatLimit(unit)}. Aim for ${contract.targetLow.toLocaleString()}–${contract.targetHigh.toLocaleString()} ${formatLimit(unit)}. Respect the ceiling.`;
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------
/**
 * @param {object} args
 * @param {object} args.essay the draft row, including its `draft_anchor` root
 * @param {object} [args.university]
 * @param {string} [args.platform]
 * @param {string} [args.profileText]
 * @param {string} [args.knowledgeText]
 * @param {string} [args.materialsText]
 * @param {string} [args.applicantText]
 * @param {Array} [args.allEssays]
 * @param {string} [args.rootCorrection] the failed root check from ./essayRoot, when
 *   this call is the send-back pass rather than the first attempt
 * @param {string} [args.editInstructions] the applicant's own change list; binding,
 *   below the root and above every suggestion
 */
export function buildGeneratePrompt({ essay, university, platform, profileText, knowledgeText, materialsText, applicantText = '', allEssays, rootCorrection = '', editInstructions = '' }) {
  const unit = limitUnitFor(essay);
  const limit = Number(essay.word_limit) || (unit === 'characters' ? 4000 : 650);
  const promptWarning = isAmbiguousCommonAppPrompt(essay?.prompt)
    ? 'The prompt field currently contains more than one official prompt. Do not write a draft. Say in essay_analysis that the applicant must choose exactly one prompt first, and leave essay empty.'
    : '';

  return `You are an elite college admissions essay consultant who has read thousands of admitted students' essays. You understand holistic admissions and, above all, THE SPECIFIC ROLE each essay plays. You are writing the version of this essay the applicant will submit.
${promptWarning}

THE ROLE OF THIS PARTICULAR ESSAY:
${essayRoleBrief(essay)}

${platformBrief(essay, university, platform)}

${craftBrief({ essay, university, platform, limit, unit })}

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
- THE DEEP ANALYSIS IS THE ABSORBED READING: when a material carries a deep analysis, its concrete items — facts, what it suggests about the applicant, guidance, craft moves — are the distilled understanding of that source. Use the section appropriate to its lens: facts/evidence for applicant-owned sources, intellectual signals for academic work, guidance for references, and craft moves for samples. Do not treat every analysis as a writing score.
- SPECIFICS OVER PARAPHRASE: prefer the names, numbers, dates, places, and exact wording carried in the profile, the materials, and their deep analyses over a vague summary of the documents. Every concrete detail in the draft must trace back to one of those sources or the university research. If the root needs a detail none of them holds, name the gap in "gaps_for_applicant" instead of inventing one.

${buildFitBrief(knowledgeText, { kind: 'draft', essay }) || `UNIVERSITY RESEARCH: none cached for this school. Write from the applicant's own material only — do not invent anything about this university's programmes, buildings, clubs or traditions, and do not assert what it "values". Nothing in the essay may rest on a fact about the school that Atlas does not have.`}

THE ESSAY TO WRITE:
- University: ${university?.name || 'Unspecified'}
- Programme / major: ${university?.major || 'Not specified'}
- Essay type: ${essay?.type}
- Prompt: ${essay?.prompt || 'No prompt supplied — write a personal statement that reveals who the applicant is.'}

${rootBrief(essay)}

${(() => { const block = editInstructionsBrief(editInstructions, { mode: 'draft' }); return block ? `${block}\n\n` : ''; })()}${rootCorrection ? `${rootCorrection}\n\n` : ''}${buildLengthContractText(essay, allEssays)}

${LENGTH_CRAFT_RULES}

${HUMAN_VOICE_RULES}

${AMBITION_RULES}

HOW TO WORK:
1. Decide what this prompt is really asking before writing a word, and make a specific choice about how the required root serves it.
2. Treat the required root as the starting point, not an optional suggestion. Find two or three concrete details in the profile and materials that deepen that root; do not replace it with a different activity. If a needed detail is missing, leave a clearly named gap.
3. Apply guidance and craft patterns as methods, not as content. Never turn a tips document or sample biography into the applicant's life.
4. Plan the shape before the sentences: the opening image, the turn, and the closing image. For a personal statement that is ONE story moving forward in time — no side quests, no second hobby, no montage.
5. Write the full draft at the top of the length band. Then read it back as an admissions officer and replace anything decorative with something evidential — do not simply cut it shorter.
6. Count the ${formatLimit(unit)} in your own answer. If you are below the target band, you are not finished: go back into the scenes and deepen them until you are.
7. Do not open with a general statement about yourself. Do not close with a moral.

Return the COMPLETE essay text in "essay" — every paragraph, from the first word to the last — and an explanation in "essay_analysis" of the role this essay plays in the holistic application, how this draft serves that role, and how it reaches the length band without padding. List in "gaps_for_applicant" every place you needed a fact you did not have.${splitEditInstructions(editInstructions).length ? ' Report every edit instruction under "instructions_followed" or "instructions_not_followed".' : ''}`;
}

export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    essay: { type: 'string' },
    essay_analysis: { type: 'string' },
    used_profile_details: { type: 'array', items: { type: 'string' } },
    gaps_for_applicant: { type: 'array', items: { type: 'string' } },
    instructions_followed: {
      type: 'array',
      items: { type: 'object', properties: { instruction: { type: 'string' }, how: { type: 'string' } } },
    },
    instructions_not_followed: {
      type: 'array',
      items: { type: 'object', properties: { instruction: { type: 'string' }, why: { type: 'string' } } },
    },
  },
};

// ---------------------------------------------------------------------------
// Review — one essay, seven dimensions, on a fixed scale
// ---------------------------------------------------------------------------

/** The dimension list as the model is asked for it, in panel order. */
function dimensionInstructions() {
  return ESSAY_REVIEW_DIMENSIONS
    .map((d, i) => `${i + 1}. ${d.key} — ${d.question}`)
    .join('\n');
}

function scaleInstructions() {
  const overall = Object.entries(SCORE_ANCHORS.overall).map(([score, text]) => `   ${score}/10: ${text}`).join('\n');
  const dimension = Object.entries(SCORE_ANCHORS.dimension).map(([score, text]) => `   ${score}/10: ${text}`).join('\n');
  return `THE SCALE — use it identically every time, because the applicant compares reviews of the same essay:
overall_score anchors:
${overall}
Each dimension anchors:
${dimension}

SCORING DISCIPLINE:
- Score every dimension separately against its own question. Beautiful prose does not raise prompt_alignment, and a strong story does not raise length.
- Be strict about evidence, not strict about style. A 5 means "average for this pile"; it is not the ceiling you must retreat to.
- Do not cap your scores out of habit. If a dimension genuinely performs at a 9 or 10 level, award it — under-scoring a strong draft misleads the applicant exactly as much as inflating a weak one.
- A 10 must be defensible in one sentence of quoted evidence. If you cannot quote the evidence, it is a 9 at most.
- Every score you give must come with the concrete thing that would raise it. If nothing would raise it, say "nothing material" and award 10.`;
}

/**
 * @param {object} args
 * @param {object} args.essay the essay row being reviewed
 * @param {object} [args.university] the university row, for the reader's voice
 * @param {string} [args.platform] application platform key
 * @param {string} [args.knowledgeText] cached university research
 * @param {string} [args.reviewNotes] notes already stored on the essay
 * @param {object[]} [args.allEssays] every essay, for scope and the UCAS budget
 * @param {string} [args.materialsText] formatted materials
 * @param {string} [args.profileText] formatted profile
 * @param {string} [args.applicantText] AI Knowledge Base text
 * @param {object} [args.previousReview] the last saved review of this essay, so a
 *   re-review is a comparison on a fixed scale instead of a fresh coin toss.
 */
export function buildReviewPrompt({
  essay, university, platform, knowledgeText, reviewNotes, allEssays,
  materialsText = '', profileText = '', applicantText = '', previousReview = null,
}) {
  const unit = limitUnitFor(essay);
  const limit = Number(essay.word_limit) || (unit === 'characters' ? 4000 : 650);
  const facts = lengthFacts(essay, allEssays);
  const voice = schoolVoiceFor(university, platform);

  const previousScores = previousReview
    ? [
      `PREVIOUS REVIEW OF THIS ESSAY (same rubric, same scale — you are comparing, not starting over):`,
      `- overall ${previousReview.overall_score ?? '?'}/10, and per dimension: ${ESSAY_REVIEW_DIMENSIONS.map((d) => `${d.key} ${previousReview[d.field] ?? '?'}`).join(', ')}`,
      previousReview.weaknesses?.length ? `- weaknesses reported: ${previousReview.weaknesses.join(' | ')}` : '',
      previousReview.priority_improvements?.length ? `- priority fixes asked for: ${previousReview.priority_improvements.join(' | ')}` : '',
      `Judge the draft in front of you now. Where a reported weakness is genuinely fixed in the text, raise that dimension and quote the fix. Where it is not fixed, hold the score and say it is still open. Do not move a score you cannot justify from the text: an unexplained rise is noise, and noise is useless to the applicant.`,
    ].filter(Boolean).join('\n')
    : '';

  return `You are a senior admissions officer at ${university?.name || 'this university'} reading a stack of real files. Be strict about evidence and generous where the evidence is actually there.

WHO IS READING THIS (${voice.label}):
${voice.brief}

${scaleInstructions()}

${facts.text}

JUDGE ONLY AGAINST WHAT THIS PROMPT ACTUALLY ASKS:
${essayRoleBrief(essay)}

${platformBrief(essay, university, platform)}

${craftBrief({ essay, university, platform, limit, unit })}

${rootBrief(essay)}

THE PROMPT: ${essay?.prompt || 'Personal statement'}
THE ESSAY:
<<<ESSAY
${essay?.content || ''}
ESSAY>>>

${lengthBrief(essay, allEssays)}

${buildFitBrief(knowledgeText, { kind: 'review', essay }) || 'UNIVERSITY RESEARCH: none cached for this school. Judge on the quality of the writing itself and on what this prompt asks — do not invent what this university "values", and do not deduct for it.'}

${profileText ? `APPLICANT PROFILE — BACKGROUND YOU MAY NOT SCORE AGAINST. Use it only to spot an invented or inflated claim, and to form optional ideas. Never to list what the essay "should" have mentioned:\n${profileText}\n` : ''}${materialsText ? `SUPPORTING MATERIALS — BACKGROUND YOU MAY NOT SCORE AGAINST (use each source according to its analysis lens: applicant-owned evidence is not all essay prose; academic work informs intellectual habits; guidance is not biography; samples are craft only. Distinguish US vs UK samples: do not apply UK UCAS conventions to US essays or vice versa. Where a source carries a deep analysis, its concrete items — facts, personal signals, guidance, craft moves — are the absorbed reading of that source: use them to judge whether a claim on the page is verifiable and to form optional ideas, never as content the essay owed the reader):\n${materialsText}\n` : ''}${applicantSection(applicantText)}${previousScores ? `${previousScores}\n` : ''}${reviewNotes ? `EARLIER FINDINGS SAVED WITH THIS ESSAY (re-check whether this draft fixed them):\n${reviewNotes}\n` : ''}
Score these dimensions 1-10 and answer each one's question:
${dimensionInstructions()}

For EVERY dimension, also say in one sentence exactly what would raise it to a 10, quoting the text where you can. "Make it better" is not an answer; "replace \\"we worked hard together\\" in paragraph 3 with what the two of you actually did on the night the rig failed" is.

Be concrete everywhere: quote the exact phrases you are objecting to. "Feels AI-generated" is not a finding; "\\"In the end, this experience taught me that…\\" appears in the third paragraph" is.

${ADMISSIONS_OFFICER_RULE}

If the draft has no coherent through-line of its own — no single story or argument that the sentences keep serving — that IS a flaw visible on the page, and the applicant's stated root tells you what the through-line was meant to be. If no root was supplied, judge the through-line from the text and say the direction is underspecified rather than penalizing the essay for not guessing it.
Judge length from the MEASURED LENGTH above, not from your own count.

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
    risk_score: { type: 'number' },
    length_score: { type: 'number' },
    sounds_like_ai: { type: 'boolean' },
    ai_patterns_detected: { type: 'array', items: { type: 'string' } },
    quoted_evidence: { type: 'array', items: { type: 'string' } },
    strengths: { type: 'array', items: { type: 'string' } },
    weaknesses: { type: 'array', items: { type: 'string' } },
    priority_improvements: { type: 'array', items: { type: 'string' } },
    optional_additions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          suggestion: { type: 'string' },
          where: { type: 'string' },
          why_it_might_help: { type: 'string' },
        },
      },
    },
    per_dimension: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dimension: { type: 'string' },
          score: { type: 'number' },
          evidence: { type: 'string' },
          how_to_reach_ten: { type: 'string' },
        },
      },
    },
    summary: { type: 'string' },
  },
};

/** The dimension keys a review must carry for Atlas to treat it as complete. */
export const REVIEW_SCORE_FIELDS = ESSAY_REVIEW_DIMENSIONS.map((d) => d.field);

/**
 * Reviews used to carry the model's own word count, which was sometimes wrong.
 * Atlas measures the draft itself and stamps the real numbers onto the result,
 * so the panel can never contradict the editor.
 */
export function withMeasuredLength(review, essay, allEssays) {
  if (!review || typeof review !== 'object') return review;
  const assessment = assessLength(essay?.content || '', essay, allEssays);
  return {
    ...review,
    word_count: assessment.count,
    limit: assessment.limit,
    unit: assessment.unit,
    over_limit: assessment.state === 'over',
    under_target: ['short', 'severe', 'empty'].includes(assessment.state),
    length_message: assessment.message,
  };
}

/** One number for "how good is this essay", averaged over the dimensions present. */
export function reviewAverage(review) {
  if (!review) return null;
  const scores = REVIEW_SCORE_FIELDS.map((field) => Number(review[field])).filter((n) => Number.isFinite(n) && n > 0);
  if (!scores.length) return Number.isFinite(Number(review.overall_score)) ? Number(review.overall_score) : null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ---------------------------------------------------------------------------
// Edit — surgical, conserved, itemised
// ---------------------------------------------------------------------------

/**
 * The rule that keeps a review honest.
 *
 * An admissions officer never sees the applicant's profile notes, uploaded
 * documents, or Atlas's knowledge base — they see the essay and the rest of the
 * submitted file. A review that says "you have a robotics team in your profile
 * but you did not mention it" is scoring against information the reader does not
 * have, which both misrepresents the essay and pushes the applicant to bolt on
 * content and lose the draft they wrote. Context is for catching invention and
 * for optional ideas, never for deductions.
 */
export const ADMISSIONS_OFFICER_RULE = `JUDGE ONLY WHAT IS ON THE PAGE — THE ADMISSIONS OFFICER RULE:
- The reader sees this essay, its prompt, and the rest of the submitted file. They do NOT see the applicant's profile fields, uploaded materials, or Atlas's knowledge base. You are given those for exactly two purposes: to notice when a claim in the essay is invented, inflated, or inconsistent with what is true; and to offer optional ideas below.
- NEVER report "you have X but you did not include it" as a weakness, and NEVER lower any score because a fact Atlas knows is missing from the draft. The reader was never promised that fact. Absence of outside information is not a flaw in the writing.
- Score every dimension from the text alone: what these sentences actually do on the page, not what the applicant could have said.
- Where something from the context would genuinely strengthen a specific line, put it in "optional_additions" — an idea the applicant may take or leave, phrased as a suggestion ("consider …"), anchored to the exact place in the draft where it would go, and never counted against any score.
- What you MAY hold against the essay: vagueness, abstraction, claims the text does not support, a sentence that could belong to any applicant, structural drift, AI tells, a tone that does not suit this reader, an over-length or under-length draft, and anything in the essay that contradicts itself or overclaims. All of that is visible on the page.
- If a claim in the essay looks invented or inflated next to what Atlas knows, that is a risk finding — say which sentence and why it reads as unverifiable. Do not name the private source; describe what a reader would doubt.`;

const PRESERVATION_RULES = `THE PRIME DIRECTIVE — CONSERVE THE APPLICANT'S DRAFT:
- You are an editor, not an author. The story, the scenes, their order, the timeline, the people in it, and what the essay means must all survive your edit unchanged.
- Keep at least 80% of the original words recognisably intact. The applicant reads this draft as theirs; a rewrite is a rejection of their work and is not what was asked for.
- Change wording, rhythm, precision, and the specific problems the review named. Change a point only where leaving it would cost the essay a score.
- NEVER do any of these: replace the required root with another activity; restructure or reorder the narrative; delete a scene, a person, or a piece of evidence; add a new scene, achievement, name, or number; change what the ending means; switch person or tense; rewrite a paragraph that is already working; shorten the essay to make your job easier.
- Where you believe a substantial change is essential to reach 10/10, make it — and name it in "changes" with the reason. An unnamed substantial change is a failure of this task.
- Every change you report is shown to the applicant highlighted inside the text, so report the real wording you replaced, not a paraphrase of it.`;

/**
 * Optional ideas from the last review, passed to the editor as options.
 *
 * These are deliberately NOT part of "findings you must fix". An idea that
 * Atlas knows from the applicant's materials is not a defect in the draft, and
 * an editor that treats it as one will bolt on content and break the story.
 */
function optionalAdditionBrief(reviewResult) {
  const additions = (reviewResult?.optional_additions || [])
    .filter((item) => item && (item.suggestion || typeof item === 'string'))
    .map((item) => (typeof item === 'string'
      ? item
      : `- ${item.suggestion}${item.where ? ` (at: ${item.where})` : ''}${item.why_it_might_help ? ` — ${item.why_it_might_help}` : ''}`));
  if (!additions.length) return '';
  return `
OPTIONAL IDEAS FROM THE LAST REVIEW — options, not requirements:
${additions.join('\n')}
Use one ONLY where it fits the sentence you are already editing and does not change what the essay is about. Skipping every one of them is a completely acceptable outcome, and is the right one when adding it would mean inventing a fact or starting a second thread. Never restructure the draft around an optional idea.`;
}

/**
 * @param {{
 *   essay: object, university?: object|null, platform?: string, reviewResult?: object|null, knowledgeText?: string,
 *   allEssays?: object[], materialsText?: string, profileText?: string, applicantText?: string,
 *   focusPhrases?: string[]|null, focusInstructions?: string[]|null, editInstructions?: string,
 * }} args
 *   focusPhrases — flagged phrases still in the draft, which makes this a follow-up edit;
 *   focusInstructions — edit instructions the first pass missed, also a follow-up;
 *   editInstructions — the applicant's own change list: binding, below the root and above the review.
 */
export function buildPolishPrompt({
  essay, university, platform, reviewResult, knowledgeText, allEssays,
  materialsText = '', profileText = '', applicantText = '', focusPhrases = null, focusInstructions = null, editInstructions = '',
}) {
  const unit = limitUnitFor(essay);
  const limit = Number(essay.word_limit) || (unit === 'characters' ? 4000 : 650);
  const facts = lengthFacts(essay, allEssays);
  // A review quotes the phrases it objects to. Atlas keeps that list and checks
  // the answer against it, so "the edit improved the style" cannot pass as
  // "the edit did the job" while every flagged line sits there untouched.
  const flagged = focusPhrases && focusPhrases.length
    ? focusPhrases
    : extractFlaggedPhrases(reviewResult);
  const phraseRules = flagged.length
    ? `\nTHE FLAGGED PHRASES — EVERY ONE MUST BE RESOLVED:\n${flagged.map((phrase) => `- "${phrase}"`).join('\n')}\nFor each one, either change it, or list it under "unresolved_phrases" with the reason it should stay. Returning a draft that still contains a flagged phrase without naming it is a failed edit, whatever else improved. If a phrase is a strength the reviewer misread, say so in the reason — that is a legitimate answer and Atlas will show it.`
    : '';
  const missedCount = Array.isArray(focusInstructions) ? focusInstructions.length : 0;
  const followUpReasons = [
    focusPhrases && focusPhrases.length
      ? `these ${focusPhrases.length} phrase${focusPhrases.length === 1 ? '' : 's'} from the review ${focusPhrases.length === 1 ? 'is' : 'are'} still in it verbatim`
      : '',
    missedCount
      ? `${missedCount} of the applicant's edit instructions (listed above as binding) ${missedCount === 1 ? 'was' : 'were'} not carried out`
      : '',
  ].filter(Boolean);
  const focusBlock = followUpReasons.length
    ? `THIS IS A FOLLOW-UP EDIT. The draft below was already revised once, and ${followUpReasons.join(', and ')}. Do not restructure the essay, do not re-polish sentences that are already working, and do not change the story: resolve exactly these, plus anything they touch. Everything else must survive word for word.`
    : '';

  return `You are a master essay editor working line by line on a draft that belongs to the applicant. Your job is to lift it to the level of an essay read aloud in committee — more human, more specific, better aligned to its prompt — without inventing anything and without taking the essay over.

${PRESERVATION_RULES}

THE ROLE OF THIS PARTICULAR ESSAY:
${essayRoleBrief(essay)}

${platformBrief(essay, university, platform)}

${craftBrief({ essay, university, platform, limit, unit })}

${rootBrief(essay)}

${(() => { const block = editInstructionsBrief(editInstructions, { mode: 'edit' }); return block ? `${block}\n\n` : ''; })()}${HUMAN_VOICE_RULES}

${facts.text}
An edit that makes the draft SHORTER than the target band is a failed edit, whatever else it improves. ${buildLengthContractText(essay, allEssays)}

${LENGTH_CRAFT_RULES}

${focusBlock ? `${focusBlock}\n\n` : ''}${reviewResult ? `FINDINGS YOU MUST ACTUALLY FIX (the applicant will check each one against your change log${splitEditInstructions(editInstructions).length ? '; where one of these conflicts with an edit instruction above, the instruction wins' : ''}):
- Overall score last review: ${reviewResult.overall_score ?? '?'}/10
- Weaknesses: ${(reviewResult.weaknesses || []).join(' | ') || 'none reported'}
- Priority improvements: ${(reviewResult.priority_improvements || []).join(' | ') || 'none reported'}
- AI tells flagged: ${(reviewResult.ai_patterns_detected || []).join(' | ') || 'none reported'}
- Exact phrases flagged: ${(reviewResult.quoted_evidence || []).join(' | ') || 'none reported'}
- What would raise each dimension to 10: ${(reviewResult.per_dimension || []).map((d) => `${d.dimension}: ${d.how_to_reach_ten}`).join(' | ') || 'not reported'}
Fix every one of these that can be fixed by editing. If one genuinely cannot be fixed without new facts, say so in "gaps_for_applicant" instead of quietly leaving it.
${optionalAdditionBrief(reviewResult)}
` : 'No review has been run yet. Edit against the craft rules above and the length contract.'}

${buildFitBrief(knowledgeText, { kind: 'polish', essay }) || 'UNIVERSITY RESEARCH: none cached. Edit for voice, structure and clarity only; add no facts about the school.'}

${profileText ? `APPLICANT PROFILE (use concrete details from here when the draft needs one):\n${profileText}\n` : ''}${materialsText ? `SUPPORTING MATERIALS (use applicant-owned evidence according to its lens; academic work informs thinking, guidance supplies rules, samples supply craft only and never borrowed life. Distinguish US vs UK):\n${materialsText}\n` : ''}${applicantSection(applicantText)}CURRENT DRAFT (this is the applicant's own writing — the thing you are conserving):
<<<ESSAY
${essay?.content || ''}
ESSAY>>>

Rules for the revision itself:
- Do not invent experiences, names, numbers, or outcomes. If a change needs a fact you do not have, leave the sentence out rather than guessing, and list the fact you needed in "gaps_for_applicant".
- Preserve and strengthen the applicant's required root. Never replace it with a more convenient activity or a sample writer's story.
- Use concrete evidence from the appropriate applicant-owned sources — names, numbers, roles, outcomes, or intellectual questions — when the draft needs it. Do not turn an academic assessment, guidance source, or cautious interpretation into a claimed personal experience.
- For craft, you may borrow technique from samples that match this platform (US samples for US essays, UK samples for UCAS), but never borrow a life event.
- Deepen before you cut. Where a sentence is weak, first try to make it more concrete; only delete it if nothing in it is doing evidential work.
${limitUnitFor(essay) === 'characters' ? '- This limit is in CHARACTERS including spaces. Check your output length before returning it.' : '- Stay inside the word limit and inside the target band.'}

${AMBITION_RULES}${phraseRules}

Return JSON only, with:
- "revised_essay": the COMPLETE edited essay, from its first word to its last. Never a fragment, never only the changed paragraphs, never commentary, never markdown fences.
- "changes": one entry per edit you made, each { "original" (the exact words you replaced, quoted from the draft), "revised" (the exact words you put there), "reason" (which finding or craft rule this fixes) }. Include deletions with "revised" left empty, and additions with "original" left empty.
- "preserved_estimate": your honest estimate, 0-100, of how much of the original wording survives.
- "protected": what you deliberately left alone and why (this is how the applicant knows you read the whole draft).
- "why_it_scores_higher": two or three sentences naming which dimensions improved and what earned the increase.
- "gaps_for_applicant": facts you needed but did not have.
- "unresolved_phrases": each flagged phrase you deliberately left alone, as { "phrase", "reason" }. Empty only if you resolved every one.
- "instructions_followed": one { "instruction", "how" } per edit instruction you carried out; "instructions_not_followed": one { "instruction", "why" } per instruction you could not. Both empty when there were no instructions.
- "improvement_claim": one of "improved", "unchanged", "uncertain" — your honest judgement of whether a careful reader would score the revised draft higher. Say "unchanged" when you only touched wording that was already working.
- "summary_of_edit": one sentence for the applicant.`;
}

export const POLISH_SCHEMA = {
  type: 'object',
  properties: {
    revised_essay: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          original: { type: 'string' },
          revised: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
    preserved_estimate: { type: 'number' },
    unresolved_phrases: {
      type: 'array',
      items: {
        type: 'object',
        properties: { phrase: { type: 'string' }, reason: { type: 'string' } },
      },
    },
    protected: { type: 'array', items: { type: 'string' } },
    why_it_scores_higher: { type: 'string' },
    gaps_for_applicant: { type: 'array', items: { type: 'string' } },
    instructions_followed: {
      type: 'array',
      items: { type: 'object', properties: { instruction: { type: 'string' }, how: { type: 'string' } } },
    },
    instructions_not_followed: {
      type: 'array',
      items: { type: 'object', properties: { instruction: { type: 'string' }, why: { type: 'string' } } },
    },
    improvement_claim: { type: 'string' },
    summary_of_edit: { type: 'string' },
  },
};

/**
 * Models answer an editing request in whatever field they like. Take the essay
 * out of whichever of them actually holds it, and never accept a wrapper that
 * has no prose in it.
 */
export function extractRevisedEssay(result) {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  const candidates = [result.revised_essay, result.essay, result.revision, result.text, result.content];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate;
  }
  return '';
}

/** Strips the markdown fences and headings a model sometimes wraps prose in. */
export function cleanEssayText(text) {
  let value = String(text || '');
  const fence = value.match(/^\s*```[a-z]*\s*\n([\s\S]*?)\n```\s*$/i);
  if (fence) value = fence[1];
  value = value.replace(/^\s*(revised essay|final essay|essay|draft)\s*[:\-]\s*/i, '');
  return value.trim();
}

// ---------------------------------------------------------------------------
// Length repair — the automatic second pass when an answer misses the band
// ---------------------------------------------------------------------------
/**
 * @param {object} args
 * @param {object} args.essay the essay row being repaired
 * @param {object} [args.university] the university row, for the reader's voice
 * @param {string} [args.platform] application platform key
 * @param {'generate' | 'edit' | 'fix'} [args.mode] what produced the short draft:
 *   'generate' a first draft that stopped short, 'edit' an edit that cut too
 *   much, 'fix' the applicant's own text being brought to length by hand.
 * @param {string} args.text the draft that came back
 * @param {object} args.assessment from assessLength()
 * @param {string} [args.originalText] the pre-edit draft, for modes 'edit' and 'fix'
 * @param {number} [args.preservedRatio] how much of the original survived
 * @param {string} [args.knowledgeText] cached university research
 * @param {string} [args.materialsText] formatted materials
 * @param {string} [args.profileText] formatted profile
 * @param {string} [args.applicantText] AI Knowledge Base text
 * @param {object[]} [args.allEssays] every essay, for the shared UCAS budget
 */
export function buildLengthRepairPrompt({
  essay, university, platform, mode = 'generate', text, assessment,
  originalText = '', preservedRatio = null, knowledgeText = '', materialsText = '',
  profileText = '', applicantText = '', allEssays,
}) {
  const unit = limitUnitFor(essay);
  const limit = Number(essay.word_limit) || (unit === 'characters' ? 4000 : 650);
  const words = formatLimit(unit);
  const over = assessment.state === 'over';

  const editSpecific = mode === 'fix'
    ? 'This draft is the APPLICANT\'S OWN WRITING. Bring it to the length contract without changing what it says: deepen the scenes that are already there, or trim what is not doing work. Do not introduce a new story, a new argument, or a different voice.'
    : mode === 'edit'
    ? `This draft is an EDIT of an earlier version, and the edit went too far${
      Number.isFinite(preservedRatio) && preservedRatio !== null
        ? `: only ${Math.round(preservedRatio * 100)}% of the applicant's own words survived`
        : ''
    }.
${originalText ? `THE APPLICANT'S ORIGINAL DRAFT (restore the material in it that was doing real work):\n<<<ORIGINAL\n${originalText}\nORIGINAL>>>\n` : ''}
Put the essay back together: keep the improvements that are genuinely better, and restore the scenes, details, and sentences from the original that carried evidence. The result must read as the applicant's own essay, edited — not as a new essay.`
    : 'This is the draft you wrote. It stopped short.';

  return `You are the same elite admissions essay consultant. Your last answer did not meet the length contract, so it is being sent back to you to finish properly.

${editSpecific}

WHAT CAME BACK: ${assessment.count.toLocaleString()} ${words} — ${assessment.message}
${over ? `It is over the ceiling by ${assessment.overage.toLocaleString()} ${words}.` : `It is under the target band by ${assessment.shortfall.toLocaleString()} ${words}.`}

${buildLengthContractText(essay, allEssays)}

${LENGTH_CRAFT_RULES}

${platformBrief(essay, university, platform)}

${craftBrief({ essay, university, platform, limit, unit })}

${rootBrief(essay)}

${HUMAN_VOICE_RULES}

${profileText ? `APPLICANT PROFILE:\n${profileText}\n` : ''}${materialsText ? `SUPPORTING MATERIALS (evidence for the applicant's own life only; samples are craft only):\n${materialsText}\n` : ''}${applicantSection(applicantText)}${(() => { const brief = buildFitBrief(knowledgeText, { kind: 'polish', essay }); return brief ? `${brief}\n` : ''; })()}
THE DRAFT TO FIX:
<<<ESSAY
${text}
ESSAY>>>

Do this:
1. ${over
    ? `Cut ${assessment.overage.toLocaleString()}+ ${words} by removing sentences that only announce meaning, and spend the space you free on the most concrete detail already in the draft.`
    : `Add ${assessment.shortfall.toLocaleString()}+ ${words} of substance. Go back INTO the existing scenes: the exact room, the exact words someone said, the specific object, the number, what you were thinking at the time, what you did next. Do not add a new story, a new achievement, or a summary paragraph.`}
2. Never invent a fact. If you need one to reach the band, write the sentence around the gap and list the gap in your notes.
3. Keep the applicant's root, their voice, and the shape of the essay.
4. Count your own ${words} before you answer. If you are still outside the band, keep going.

Return the COMPLETE ${over ? 'trimmed' : 'expanded'} essay text in "essay" — every paragraph, first word to last — and in "notes" say what you deepened (or cut) and list any fact you still need from the applicant.`;
}

export const LENGTH_REPAIR_SCHEMA = {
  type: 'object',
  properties: {
    essay: { type: 'string' },
    notes: { type: 'string' },
    gaps_for_applicant: { type: 'array', items: { type: 'string' } },
  },
};

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

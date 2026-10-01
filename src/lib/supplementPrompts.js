// School-specific prompts that are published for the 2026-27 cycle (Fall 2027
// entry) and were checked against the university's own admissions page.
//
// If a school is not in this list, Atlas does not invent a prompt. The student
// pastes the current wording, or researches the school in the Knowledge Base.
// Every entry carries its source so the chooser can say where it came from.

import { COMMON_APP_AUXILIARY, COMMON_APP_PROMPTS, UC_PIQS, UCAS_QUESTIONS } from './applicationData';

export const SUPPLEMENT_PROMPTS = [
  {
    id: 'harvard-1',
    match: /\bharvard\b/i,
    exclude: /harvard-westlake/i,
    title: 'Harvard — Life experiences and contribution',
    prompt: 'Harvard has long recognized the importance of enrolling a student body with a diversity of perspectives and experiences. How will the life experiences that shaped who you are today enable you to contribute to Harvard?',
    word_limit: 150,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://college.harvard.edu/admissions/apply/application-requirements',
    cycle: '2026-27',
    role: 'How your life, not a list of activities, would change a Harvard conversation. 150 words is a scene plus a consequence, not a biography.',
  },
  {
    id: 'harvard-2',
    match: /\bharvard\b/i,
    exclude: /harvard-westlake/i,
    title: 'Harvard — Disagreement',
    prompt: 'Describe a time when you strongly disagreed with someone about an idea or issue. How did you communicate or engage with this person? What did you learn from this experience?',
    word_limit: 150,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://college.harvard.edu/admissions/apply/application-requirements',
    cycle: '2026-27',
    role: 'The engagement matters more than winning. Show how you stayed in the disagreement.',
  },
  {
    id: 'harvard-3',
    match: /\bharvard\b/i,
    exclude: /harvard-westlake/i,
    title: 'Harvard — Activities and responsibilities',
    prompt: 'Briefly describe any of your extracurricular activities, employment experience, travel, or family responsibilities that have shaped who you are.',
    word_limit: 150,
    limit_unit: 'words',
    type: 'activity',
    source: 'https://college.harvard.edu/admissions/apply/application-requirements',
    cycle: '2026-27',
    role: 'Not a second activity list. Pick the responsibility that actually shaped you and say how.',
  },
  {
    id: 'harvard-4',
    match: /\bharvard\b/i,
    exclude: /harvard-westlake/i,
    title: 'Harvard — Future use of a Harvard education',
    prompt: 'How do you hope to use your Harvard education in the future?',
    word_limit: 150,
    limit_unit: 'words',
    type: 'why_this_school',
    source: 'https://college.harvard.edu/admissions/apply/application-requirements',
    cycle: '2026-27',
    role: 'A specific use, not "to make a difference". Name the kind of work the education would make possible.',
  },
  {
    id: 'harvard-5',
    match: /\bharvard\b/i,
    exclude: /harvard-westlake/i,
    title: 'Harvard — Roommates',
    prompt: 'Top 3 things your roommates might like to know about you.',
    word_limit: 150,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://college.harvard.edu/admissions/apply/application-requirements',
    cycle: '2026-27',
    role: 'Three concrete things a person living with you would actually notice. Voice matters more than impressiveness here.',
  },
  {
    id: 'columbia-1',
    match: /\bcolumbia\b/i,
    exclude: /british columbia|district of columbia/i,
    title: 'Columbia — Intellectual development list',
    prompt: 'List the titles of texts, resources and outlets that have contributed to your intellectual development outside of academic courses, including but not limited to books, journals, websites, podcasts, essays, plays, presentations, videos, museums and other content that you enjoy.',
    word_limit: 100,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://undergrad.admissions.columbia.edu/apply/process/columbia-questions',
    cycle: '2026-27',
    role: 'A list, not an essay. Commas or semicolons. No author names, subtitles, or explanations. The pattern of the list is the point. Updated on Columbia\'s site 28 July 2026.',
  },
  {
    id: 'columbia-2',
    match: /\bcolumbia\b/i,
    exclude: /british columbia|district of columbia/i,
    title: 'Columbia — Lived experience and contribution',
    prompt: 'Tell us about an aspect of your life so far or your lived experience that is important to you, and describe how it has shaped the way you would learn from and contribute to Columbia\'s multidimensional and collaborative environment.',
    word_limit: 150,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://undergrad.admissions.columbia.edu/apply/process/columbia-questions',
    cycle: '2026-27',
    role: 'One aspect, then the specific way it would change how you learn with other people at Columbia.',
  },
  {
    id: 'columbia-3',
    match: /\bcolumbia\b/i,
    exclude: /british columbia|district of columbia/i,
    title: 'Columbia — Disagreement',
    prompt: 'At Columbia, students representing a wide range of perspectives are invited to live and learn together. In such a community, questions and debates naturally arise. Please describe a time when you did not agree with someone and discuss how you engaged with them and what you took away from the interaction.',
    word_limit: 150,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://undergrad.admissions.columbia.edu/apply/process/columbia-questions',
    cycle: '2026-27',
    role: 'How you stayed in a real disagreement. Do not end with you being obviously right.',
  },
  {
    id: 'columbia-4',
    match: /\bcolumbia\b/i,
    exclude: /british columbia|district of columbia/i,
    title: 'Columbia — Adversity',
    prompt: 'In college/university, students are often challenged in ways that they could not anticipate. Please describe a situation in which you have navigated through adversity and discuss how you changed as a result.',
    word_limit: 150,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://undergrad.admissions.columbia.edu/apply/process/columbia-questions',
    cycle: '2026-27',
    role: 'The change is the answer. The situation is only the setup.',
  },
  {
    id: 'columbia-5',
    match: /\bcolumbia\b/i,
    exclude: /british columbia|district of columbia/i,
    title: 'Columbia — Why Columbia',
    prompt: 'Why are you interested in attending Columbia University? We encourage you to consider the aspect(s) that you find unique and compelling about Columbia.',
    word_limit: 150,
    limit_unit: 'words',
    type: 'why_this_school',
    source: 'https://undergrad.admissions.columbia.edu/apply/process/columbia-questions',
    cycle: '2026-27',
    role: 'A specific Columbia feature you could not get by swapping the name. 150 words, so one or two aspects, not a tour.',
  },
  {
    id: 'columbia-6',
    match: /\bcolumbia\b/i,
    exclude: /british columbia|district of columbia/i,
    title: 'Columbia — Areas of study',
    prompt: 'What attracts you to your preferred areas of study at Columbia College or Columbia Engineering?',
    word_limit: 150,
    limit_unit: 'words',
    type: 'why_this_school',
    source: 'https://undergrad.admissions.columbia.edu/apply/process/columbia-questions',
    cycle: '2026-27',
    role: 'The academic direction, tied to something Columbia actually teaches. College and Engineering read the same question.',
  },
  {
    id: 'mit-1',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT — Field of study',
    prompt: 'What field of study appeals to you the most right now? (Applicants select from a drop-down list.) Reflect on what has led you to this interest.',
    word_limit: 200,
    limit_unit: 'words',
    type: 'why_this_school',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'MIT asks for about 100–200 words. The field is selected from a list; the essay is why that field, not a tour of MIT departments.',
  },
  {
    id: 'mit-2',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT — A different educational path',
    prompt: 'While some reach their goals following well-trodden paths, others blaze their own trails achieving the unexpected. In what ways have you done something different than what was expected in your educational journey?',
    word_limit: 200,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'A real departure from the expected path, not a humblebrag about exceeding it.',
  },
  {
    id: 'mit-3',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT — Problems you want to tackle',
    prompt: 'How have your personal and academic experiences influenced the types of problems you would want to tackle with an MIT education and the impact you aim to make on your community?',
    word_limit: 200,
    limit_unit: 'words',
    type: 'why_this_school',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'The problem comes from your experience. MIT is the means, not the subject of the essay.',
  },
  {
    id: 'mit-4',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT — Unexpected challenge',
    prompt: 'How did you manage a situation or challenge that you didn’t expect? What did you learn from it?',
    word_limit: 200,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'Management and learning. The surprise is the point — not a challenge you trained for.',
  },
  {
    id: 'mit-s1',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT short — Just for fun',
    prompt: 'What do you do just for fun?',
    word_limit: 50,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'MIT gives 40–50 words. One specific thing, said plainly.',
  },
  {
    id: 'mit-s2',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT short — Someone you admire',
    prompt: 'Who is someone you admire, whether you know them personally or look up to them from afar? Tell us why.',
    word_limit: 50,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'Name the person and the specific quality. 40–50 words.',
  },
  {
    id: 'mit-s3',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT short — Talk for hours',
    prompt: 'What’s a topic, academic or non-academic, that you could talk about for hours?',
    word_limit: 50,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'The topic plus one proof you actually would. 40–50 words.',
  },
  {
    id: 'mit-s4',
    match: /\bmit\b|massachusetts institute of technology/i,
    title: 'MIT short — Generalist or specialist',
    prompt: 'MIT values both “generalists” with varied interests and “specialists” who focus deeply on one or a few passions. Which do you think best describes you, and why?',
    word_limit: 50,
    limit_unit: 'words',
    type: 'supplemental',
    source: 'https://mitadmissions.org/apply/firstyear/essays-activities-academics/',
    cycle: '2026-27',
    role: 'Pick one and give the evidence. 40–50 words. Do not say "a bit of both" unless you can prove it in one sentence.',
  },
];

// Cambridge's extra My Cambridge Application box is real, but its 2026-27
// wording was not re-checked against the official page in this change. It is
// intentionally absent: Atlas does not offer a prompt it has not verified.

export function promptsForUniversity(name = '') {
  const text = String(name || '');
  if (!text.trim()) return [];
  return SUPPLEMENT_PROMPTS.filter((item) => item.match.test(text) && !(item.exclude && item.exclude.test(text)));
}

export function toEssayDraft(item, { scope = 'university_specific', applicationPlatform = 'common_app' } = {}) {
  return {
    title: item.title,
    prompt: item.prompt,
    word_limit: item.word_limit,
    limit_unit: item.limit_unit || 'words',
    type: item.type || 'supplemental',
    scope: item.scope || scope,
    application_platform: applicationPlatform,
    source: item.source,
    role: item.role,
    cycle: item.cycle,
    prompt_key: item.id || item.key,
  };
}

/** Fixed prompts the student should choose, rather than paste, for this context. */
export function fixedPromptChoices({ platform, universityName, scope }) {
  const choices = [];
  const shared = scope !== 'university_specific';
  if (platform === 'common_app' && shared) {
    for (const prompt of COMMON_APP_PROMPTS) {
      choices.push({
        key: prompt.key,
        group: 'Common App personal statement — choose one',
        label: `Prompt ${prompt.number} — ${prompt.label}`,
        prompt: prompt.text,
        word_limit: 650,
        limit_unit: 'words',
        type: 'personal_statement',
        scope: 'common',
        title: 'Common App Personal Statement',
        role: prompt.role,
        warn: prompt.watchOut,
        meta: `${prompt.share}% chose this last cycle · 250–650 words`,
      });
    }
    for (const extra of COMMON_APP_AUXILIARY) {
      choices.push({
        key: extra.key,
        group: 'Common App — other shared writing',
        label: extra.title,
        prompt: extra.prompt,
        word_limit: extra.limit,
        limit_unit: extra.unit,
        type: extra.type,
        scope: 'common',
        title: `Common App — ${extra.title}`,
        role: extra.role,
        meta: `${extra.limit} ${extra.unit}`,
      });
    }
  }
  if (platform === 'uc' && shared) {
    for (const question of UC_PIQS) {
      choices.push({
        key: question.key,
        group: 'UC Personal Insight Questions — answer exactly 4 of 8',
        label: `PIQ ${question.number} — ${question.theme}`,
        prompt: question.prompt,
        word_limit: question.limit,
        limit_unit: 'words',
        type: 'supplemental',
        scope: 'common',
        title: `UC PIQ ${question.number} — ${question.theme}`,
        role: question.role,
        meta: '350 words · same four answers go to every campus',
      });
    }
  }
  if (platform === 'ucas' && shared) {
    for (const question of UCAS_QUESTIONS) {
      choices.push({
        key: question.key,
        group: 'UCAS personal statement — three separate answers',
        label: `Question ${question.number} — ${question.label}`,
        prompt: question.prompt,
        word_limit: 4000,
        limit_unit: 'characters',
        type: 'personal_statement',
        scope: 'common',
        title: `UCAS Q${question.number} — ${question.label}`,
        role: question.role,
        meta: `Minimum ${question.minChars} characters · ${question.suggestedShare} · 4,000 shared`,
      });
    }
  }
  if (scope !== 'common') {
    for (const item of promptsForUniversity(universityName)) {
      choices.push({
        key: item.id,
        group: `Published ${item.cycle} prompts for this university`,
        label: item.title,
        prompt: item.prompt,
        word_limit: item.word_limit,
        limit_unit: item.limit_unit,
        type: item.type,
        scope: item.scope || 'university_specific',
        title: item.title,
        role: item.role,
        source: item.source,
        meta: `${item.word_limit} ${item.limit_unit === 'characters' ? 'characters' : 'words'} · ${item.cycle}`,
      });
    }
  }
  return choices;
}

export function missingSchoolPrompts(universityName, essays = []) {
  const havePrompt = new Set((essays || []).map((e) => String(e.prompt || '').trim()));
  const haveTitle = new Set((essays || []).map((e) => String(e.title || '').trim().toLowerCase()));
  return promptsForUniversity(universityName).filter((item) => {
    if (havePrompt.has(item.prompt)) return false;
    if (haveTitle.has(item.title.toLowerCase())) return false;
    return true;
  });
}

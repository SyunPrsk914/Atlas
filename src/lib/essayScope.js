export const ESSAY_SCOPES = {
  UNIVERSITY_SPECIFIC: 'university_specific',
  COMMON: 'common',
};

export const PLATFORM_LABELS = {
  common_app: 'Common App',
  uc: 'UC Application',
  coalition: 'Coalition',
  ucas: 'UCAS',
  direct: 'Direct',
  other: 'Other',
};

// Universities known to NOT use the Common App (use their own system)
const NON_COMMON_APP_KEYWORDS = ['uc ', 'university of california', 'mit', 'coalition', 'questbridge', 'ucas'];

export function getUniversityPlatform(university) {
  if (!university) return 'common_app';
  if (university.country === 'UK') return 'ucas';
  const type = (university.application_type || '').toLowerCase();
  if (type.includes('uc ') || type.includes('university of california') || type.trim() === 'uc') return 'uc';
  if (type.includes('mit')) return 'direct';
  if (type.includes('coalition')) return 'coalition';
  return 'common_app';
}

/**
 * Returns essays applicable to a given university:
 * - University-specific essays (university_id matches)
 * - Common essays whose platform matches the university's platform
 */
export function essaysApplicableToUniversity(allEssays, university) {
  const platform = getUniversityPlatform(university);
  return allEssays.filter((essay) => {
    if (essay.scope === 'common') {
      return essay.application_platform === platform;
    }
    // Default: treat undefined/null scope as university_specific
    return essay.university_id === university.id;
  });
}

export function isCommonEssay(essay) {
  return essay.scope === 'common';
}

export function isUniversitySpecific(essay) {
  return essay.scope !== 'common';
}
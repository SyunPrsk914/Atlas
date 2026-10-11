// The Atlas research pack.
//
// Twelve-plus universities, researched by hand from their own published pages —
// admission sites, department sites, catalogues and bulletins — and written into
// the same eleven-section structure the app's research prompt asks for. The point
// is that a student who knows exactly where they are applying should not have to
// wait for a live AI call to have institutional context: the context ships with
// the app, is attributed, and can be loaded into University Research in one
// click.
//
// Ground rules the pack was written under, and which any future entry must keep:
//   - Official sources only: the university's own admission pages, its
//     department pages, its catalogue or bulletin, and its news service. Facts
//     that only a third-party guide reports are labelled as such in section 11.
//   - No invented numbers. Where a figure could not be verified, the entry says
//     "Not published" or points at the page that publishes it.
//   - Current cycle. Deadlines and testing policies move every year, so each
//     entry carries `researchedAt` and tells the reader to confirm before
//     quoting.
//   - Fit, not ranking. Sections 3 and 10 carry what the school says it values
//     and how its readers read; that is what the drafting and review prompts
//     consume through buildFitBrief().
//
// Section headings come from RESEARCH_SECTIONS in src/lib/schoolFit.js, so every
// entry parses and slices without special-casing.

// Relative specifiers with explicit extensions on purpose: this module is also
// imported by the offline verification scripts running in plain Node, which
// resolves relative paths but not the `@/` alias.
import { universityNamesMatch } from '../../lib/essayScope.js';
import { fitSummary, missingSections } from '../../lib/schoolFit.js';

import { stanford } from './stanford.js';
import { mit } from './mit.js';
import { berkeley } from './berkeley.js';
import { ucla } from './ucla.js';
import { princeton } from './princeton.js';
import { umich } from './umich.js';
import { jhu } from './jhu.js';
import { caltech } from './caltech.js';
import { cornell } from './cornell.js';
import { columbia } from './columbia.js';
import { nyuTandon } from './nyuTandon.js';
import { washu } from './washu.js';
import { upenn } from './upenn.js';

/**
 * Every entry in the pack, in the order the applicant listed them.
 *
 * @type {{ key: string, university: string, aliases: string[], major: string, platform: string, researchedAt: string, sources: string[], content: string }[]}
 */
export const SCHOOL_RESEARCH_PACK = [
  stanford, mit, berkeley, ucla, princeton, umich, jhu, caltech,
  cornell, columbia, nyuTandon, washu, upenn,
];

/**
 * The pack entry for a university name, matched the same way the rest of the app
 * matches universities ("Stanford" and "Stanford University" are one school),
 * plus the explicit alias list each entry carries for names a transcript or a
 * UCAS choice might use.
 *
 * @param {string} universityName
 * @returns {object|null}
 */
/** Lowercase, punctuation-free form used for exact alias matching. */
const fold = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function findPackEntry(universityName) {
  const name = String(universityName || '').trim();
  if (!name) return null;
  const needle = fold(name);

  // Exact first. An alias such as "SEAS", "Cal" or "Tandon" is a name a
  // university list may really carry, and only an exact match is safe for those:
  // a substring rule would send "Penn State" to Penn and "Cal Poly" to Berkeley.
  const exact = SCHOOL_RESEARCH_PACK.find((entry) => [entry.university, ...(entry.aliases || [])]
    .some((candidate) => {
      const folded = fold(candidate);
      return folded.length >= 3 && folded === needle;
    }));
  if (exact) return exact;

  // Then the app's own fuzzy matcher, so "Stanford" and "Stanford University"
  // are one school exactly as they are everywhere else in Atlas.
  return SCHOOL_RESEARCH_PACK.find((entry) => [entry.university, ...(entry.aliases || [])]
    .some((candidate) => universityNamesMatch(candidate, name))) || null;
}

/**
 * A one-line description of each entry, for the list a user picks from.
 *
 * @returns {{ key: string, university: string, major: string, researchedAt: string, sections: number, values: string, missing: string[] }[]}
 */
export function packOverview() {
  return SCHOOL_RESEARCH_PACK.map((entry) => {
    const summary = fitSummary(entry.content);
    return {
      key: entry.key,
      university: entry.university,
      major: entry.major,
      researchedAt: entry.researchedAt,
      sections: summary.sections,
      values: summary.values,
      missing: missingSections(entry.content),
    };
  });
}

/**
 * True when a stored research record already came from the pack.
 *
 * @param {object|null|undefined} record a CollegeKnowledge row
 * @returns {boolean}
 */
export function isPackRecord(record) {
  return record?.research_provider === PACK_PROVIDER;
}

/**
 * How a pack record identifies itself in the CollegeKnowledge row, so the UI can
 * tell "Atlas researched this by hand" apart from "an AI call produced this"
 * without guessing from the text.
 */
export const PACK_PROVIDER = 'atlas-research-pack';
export const PACK_MODEL = 'manual-research';

/**
 * The exact fields to save when a pack entry is loaded into University Research.
 *
 * Kept as a function so the caller decides which university name to store (the
 * applicant's own spelling, so the record matches their university list) and so
 * nothing about the CollegeKnowledge shape is duplicated in the page.
 *
 * @param {object} entry a pack entry
 * @param {string} universityName the name as the applicant entered it
 * @returns {{ university_name: string, knowledge: string, last_updated: string, source_url: string|null, source_text: string|null, research_provider: string, research_model: string, grounded: boolean }}
 */
export function packRecordFields(entry, universityName) {
  return {
    university_name: String(universityName || entry.university),
    knowledge: entry.content,
    last_updated: new Date().toISOString(),
    // The first source is the single most load-bearing page for this entry; the
    // full list is in section 11 of the report itself.
    source_url: entry.sources?.[0] || null,
    source_text: null,
    research_provider: PACK_PROVIDER,
    research_model: PACK_MODEL,
    // Nothing here was grounded by a live model call, and saying so keeps the
    // app's honesty rule intact: a pack report is researched, not generated.
    grounded: false,
  };
}

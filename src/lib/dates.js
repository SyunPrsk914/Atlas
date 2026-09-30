// Date helpers shared by the dashboard, university list, university detail and
// knowledge base, so "days left" means exactly one thing across the app.
//
// Two things this deliberately gets right that the inline versions did not:
//
// 1. `new Date('2026-11-01')` is parsed as UTC midnight, while `new Date()` is
//    local time. For anyone west of Greenwich that combination made a deadline
//    show a day early, and for anyone east of it a day late. A date-only string
//    here is treated as a local calendar date.
//
// 2. Counting whole calendar days means the deadline day itself is "0 days
//    left", not "1 day left". `Math.ceil` on a raw millisecond difference
//    rounds a partial day up and overstates the time remaining.

const MS_PER_DAY = 86400000;

/** Parse a value into a Date at local midnight. Returns null if unusable. */
export function startOfLocalDay(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const raw = String(value).trim();
  // Bare `YYYY-MM-DD` (and `YYYY-MM-DDTHH:mm:ss` without a zone) are read as
  // local dates rather than being shifted through UTC.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const parsed = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Today at local midnight. */
export function today() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Whole calendar days from today until `value`.
 * 0 on the day itself, negative once it has passed, null when there is no date.
 */
export function daysUntil(value) {
  const target = startOfLocalDay(value);
  if (!target) return null;
  return Math.round((target.getTime() - today().getTime()) / MS_PER_DAY);
}

/** Whole calendar days since `value` was in the past. 0 means today. */
export function daysSince(value) {
  const target = startOfLocalDay(value);
  if (!target) return null;
  return Math.floor((today().getTime() - target.getTime()) / MS_PER_DAY);
}

/** "3 days left" / "Due today" / "Passed" — or null when there is no date. */
export function deadlineLabel(value) {
  const days = daysUntil(value);
  if (days === null) return null;
  if (days < 0) return 'Passed';
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

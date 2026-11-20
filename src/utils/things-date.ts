// ABOUTME: Converts tool date inputs into values accepted by the Things3 URL scheme
// ABOUTME: Keeps the user's calendar day (no UTC shift) and rejects values Things3 would ignore

import { ErrorType, Things3Error } from '../types/index.js';

export type ThingsDateField = 'when' | 'deadline';

const WHEN_KEYWORDS = ['today', 'tomorrow', 'evening', 'anytime', 'someday'];
const DEADLINE_KEYWORDS = ['today', 'tomorrow'];

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Format a Date as YYYY-MM-DD using the local calendar (never UTC). */
export function localCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

function invalid(value: string, field: ThingsDateField): Things3Error {
  const keywords = (field === 'when' ? WHEN_KEYWORDS : DEADLINE_KEYWORDS).join(', ');
  return new Things3Error(
    ErrorType.INVALID_PARAMETER,
    `Invalid ${field} date "${value}": use YYYY-MM-DD, an ISO 8601 date-time, or one of: ${keywords}`,
  );
}

/**
 * Convert a date given to a tool into the value sent to Things3.
 *
 * - Keywords (today, tomorrow, and for `when` also evening/anytime/someday)
 *   are passed through, lower-cased.
 * - `YYYY-MM-DD` is passed through unchanged: it already is a calendar day,
 *   so it must not go through `Date`/UTC conversion.
 * - Other ISO 8601 date-times are reduced to the calendar day of that instant
 *   in the machine's local timezone (the timezone Things3 runs in).
 * - Anything else throws instead of being silently dropped.
 */
export function toThingsDate(value: string, field: ThingsDateField): string {
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();

  const keywords = field === 'when' ? WHEN_KEYWORDS : DEADLINE_KEYWORDS;
  if (keywords.includes(lower)) return lower;

  const calendar = CALENDAR_DATE.exec(trimmed);
  if (calendar) {
    const [, y, m, d] = calendar;
    if (!isRealCalendarDate(Number(y), Number(m), Number(d))) throw invalid(value, field);
    return trimmed;
  }

  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) return localCalendarDate(parsed);
  }

  throw invalid(value, field);
}

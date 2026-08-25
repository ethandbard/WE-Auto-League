// Submission-window arithmetic. Decision #2: cutoffs are computed in the
// league's IANA timezone and stored as UTC instants, so a deadline holds
// across a DST boundary — see CLAUDE.md and decisions.md §2.
import { DateTime } from 'luxon';

export interface LeagueScheduleSettings {
  timezone: string;
  /** ISO weekday ints, Mon=1..Sun=7. */
  submissionDays: number[];
  /** "HH:mm:ss" or "HH:mm" */
  submissionCutoffTime: string;
}

function cutoffParts(time: string): { hour: number; minute: number } {
  const [h, m] = time.split(':').map(Number);
  return { hour: h ?? 12, minute: m ?? 0 };
}

export interface WindowInfo {
  /** The scheduled window this instant belongs to — today if today is a submission day, else the most recent one. */
  windowDate: string;
  cutoffAtUtc: Date;
  isPastCutoff: boolean;
  /** The next scheduled submission day at/after `windowDate`, for "next deadline" UI copy. */
  nextWindowDate: string;
  nextCutoffAtUtc: Date;
}

export function currentWindow(now: Date, league: LeagueScheduleSettings): WindowInfo {
  const { hour, minute } = cutoffParts(league.submissionCutoffTime);
  const nowInZone = DateTime.fromJSDate(now, { zone: league.timezone });

  let candidate = nowInZone.startOf('day');
  for (let i = 0; i < 8; i++) {
    if (league.submissionDays.includes(candidate.weekday)) break;
    candidate = candidate.minus({ days: 1 });
  }
  const cutoff = candidate.set({ hour, minute, second: 0, millisecond: 0 });

  let next = nowInZone.startOf('day');
  for (let i = 0; i < 8; i++) {
    const atCutoff = next.set({ hour, minute, second: 0, millisecond: 0 });
    if (league.submissionDays.includes(next.weekday) && atCutoff >= nowInZone) break;
    next = next.plus({ days: 1 });
  }
  const nextCutoff = next.set({ hour, minute, second: 0, millisecond: 0 });

  return {
    windowDate: candidate.toFormat('yyyy-MM-dd'),
    cutoffAtUtc: cutoff.toUTC().toJSDate(),
    isPastCutoff: nowInZone > cutoff,
    nextWindowDate: next.toFormat('yyyy-MM-dd'),
    nextCutoffAtUtc: nextCutoff.toUTC().toJSDate(),
  };
}

/** Every scheduled window date within [startsOn, endsOn], inclusive, in the league's zone. */
export function scheduledWindowDatesInRange(startsOn: string, endsOn: string, league: LeagueScheduleSettings): string[] {
  const dates: string[] = [];
  let cursor = DateTime.fromISO(startsOn, { zone: league.timezone }).startOf('day');
  const end = DateTime.fromISO(endsOn, { zone: league.timezone }).startOf('day');
  while (cursor <= end) {
    if (league.submissionDays.includes(cursor.weekday)) dates.push(cursor.toFormat('yyyy-MM-dd'));
    cursor = cursor.plus({ days: 1 });
  }
  return dates;
}

export function cutoffForWindowDate(windowDate: string, league: LeagueScheduleSettings): Date {
  const { hour, minute } = cutoffParts(league.submissionCutoffTime);
  return DateTime.fromISO(windowDate, { zone: league.timezone }).set({ hour, minute, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

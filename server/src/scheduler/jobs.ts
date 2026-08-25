import { and, eq, isNull, gt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { leagues, periods, dealerships, employees, submissions, penalties, scores, emailLog } from '../db/schema.js';
import { scheduledWindowDatesInRange, cutoffForWindowDate, currentWindow } from '../scheduling/windows.js';
import { sendOnce } from '../email/send.js';
import { reminderEmail, latePenaltyEmail, standingsEmail } from '../email/templates.js';
import { withAdvisoryLock } from './lock.js';
import { env } from '../env.js';

/**
 * For every open period, for every scheduled window date whose cutoff has
 * passed, penalise any store with no submission filed by that cutoff.
 * Idempotent: the penalty's reason string names the exact window date, so a
 * re-run finds the existing row and skips it — the late penalty stacks per
 * missed window (decision #3), it never double-charges the same one.
 */
export async function applyMissedWindowPenalties(): Promise<number> {
  let issued = 0;
  const openPeriods = await db.select().from(periods).where(eq(periods.status, 'open'));
  for (const period of openPeriods) {
    const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
    if (!league) continue;
    const scheduleSettings = { timezone: league.timezone, submissionDays: league.submissionDays, submissionCutoffTime: league.submissionCutoffTime };
    const windowDates = scheduledWindowDatesInRange(period.startsOn, period.endsOn, scheduleSettings);
    const now = new Date();
    const pastWindows = windowDates.filter((wd) => cutoffForWindowDate(wd, scheduleSettings) <= now);
    if (!pastWindows.length) continue;

    const dealershipRows = await db.select().from(dealerships).where(and(eq(dealerships.leagueId, league.id), isNull(dealerships.archivedAt)));
    const existingPenalties = await db.select().from(penalties).where(and(eq(penalties.periodId, period.id), eq(penalties.kind, 'late_submission')));

    for (const dealership of dealershipRows) {
      const dealershipSubmissions = await db.select().from(submissions).where(and(eq(submissions.dealershipId, dealership.id), eq(submissions.periodId, period.id)));
      for (const windowDate of pastWindows) {
        const cutoff = cutoffForWindowDate(windowDate, scheduleSettings);
        const filed = dealershipSubmissions.some((s) => s.submittedAt <= cutoff);
        if (filed) continue;

        const reason = `Missed the noon cutoff for ${windowDate}`;
        const already = existingPenalties.some((p) => p.dealershipId === dealership.id && p.reason === reason);
        if (already) continue;

        await db.insert(penalties).values({
          periodId: period.id,
          dealershipId: dealership.id,
          kind: 'late_submission',
          value: league.latePenaltyValue,
          reason,
        });
        issued++;

        const manager = (await db.select().from(employees).where(and(eq(employees.dealershipId, dealership.id), eq(employees.role, 'manager')))).at(0);
        if (manager) {
          const tpl = latePenaltyEmail({ recipientName: manager.alias ?? manager.name, dealershipName: dealership.alias ?? dealership.name, windowDate, penaltyValue: Number(league.latePenaltyValue) });
          await sendOnce({ leagueId: league.id, template: `late-penalty:${windowDate}`, periodId: period.id, to: manager.email, ...tpl });
        }
      }
    }
  }
  return issued;
}

/** Emails a manager who hasn't filed for the window closing within the next two hours. */
export async function sendPreDeadlineReminders(): Promise<number> {
  let sent = 0;
  const openPeriods = await db.select().from(periods).where(eq(periods.status, 'open'));
  for (const period of openPeriods) {
    const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
    if (!league) continue;
    const scheduleSettings = { timezone: league.timezone, submissionDays: league.submissionDays, submissionCutoffTime: league.submissionCutoffTime };
    const window = currentWindow(new Date(), scheduleSettings);
    const hoursToNextCutoff = (window.nextCutoffAtUtc.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursToNextCutoff > 2 || hoursToNextCutoff < 0) continue;

    const dealershipRows = await db.select().from(dealerships).where(and(eq(dealerships.leagueId, league.id), isNull(dealerships.archivedAt)));
    for (const dealership of dealershipRows) {
      const filedForNextWindow = await db
        .select()
        .from(submissions)
        .where(and(eq(submissions.dealershipId, dealership.id), eq(submissions.periodId, period.id), gt(submissions.submittedAt, DateTime.fromJSDate(window.nextCutoffAtUtc).minus({ days: 3 }).toJSDate())));
      if (filedForNextWindow.some((s) => s.submittedAt <= window.nextCutoffAtUtc)) continue;

      const manager = (await db.select().from(employees).where(and(eq(employees.dealershipId, dealership.id), eq(employees.role, 'manager')))).at(0);
      if (!manager) continue;
      const cutoffLocal = DateTime.fromJSDate(window.nextCutoffAtUtc).setZone(league.timezone).toFormat('cccc, LLL d, h:mm a ZZZZ');
      const tpl = reminderEmail({ recipientName: manager.alias ?? manager.name, dealershipName: dealership.alias ?? dealership.name, cutoffLocal, entryUrl: `${env.appBaseUrl}/enter` });
      const result = await sendOnce({ leagueId: league.id, template: `reminder:${window.nextWindowDate}`, periodId: period.id, to: manager.email, ...tpl });
      if (result === 'sent') sent++;
    }
  }
  return sent;
}

/** Mails every ranked advisor and manager once a period is published. */
export async function mailPublishedStandings(): Promise<number> {
  let sent = 0;
  const publishedPeriods = await db.select().from(periods).where(eq(periods.status, 'published'));
  for (const period of publishedPeriods) {
    const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
    if (!league) continue;
    const rows = await db.select().from(scores).where(and(eq(scores.periodId, period.id), eq(scores.isPublished, true)));
    for (const row of rows) {
      if (row.scope === 'team' || row.employeeId == null || row.dealershipId == null || row.position == null) continue;
      const [employee] = await db.select().from(employees).where(eq(employees.id, row.employeeId)).limit(1);
      const [dealership] = await db.select().from(dealerships).where(eq(dealerships.id, row.dealershipId)).limit(1);
      if (!employee || !dealership) continue;
      const tpl = standingsEmail({
        periodLabel: period.label,
        recipientName: employee.alias ?? employee.name,
        position: row.position,
        total: Number(row.total),
        scope: row.scope as 'advisor' | 'manager',
        dealershipName: dealership.alias ?? dealership.name,
        standingsUrl: `${env.appBaseUrl}/standings/${period.id}`,
      });
      const result = await sendOnce({ leagueId: league.id, template: `standings:${row.scope}`, periodId: period.id, to: employee.email, ...tpl });
      if (result === 'sent') sent++;
    }
  }
  return sent;
}

export async function runScheduledJobs(): Promise<void> {
  await withAdvisoryLock('missed-window-penalties', async () => {
    const n = await applyMissedWindowPenalties();
    if (n) console.log(`[scheduler] issued ${n} late-submission penalt${n === 1 ? 'y' : 'ies'}`);
  });
  await withAdvisoryLock('pre-deadline-reminders', async () => {
    const n = await sendPreDeadlineReminders();
    if (n) console.log(`[scheduler] sent ${n} pre-deadline reminder(s)`);
  });
  await withAdvisoryLock('mail-published-standings', async () => {
    const n = await mailPublishedStandings();
    if (n) console.log(`[scheduler] mailed ${n} standings email(s)`);
  });
}

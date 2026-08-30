import { and, eq, isNull, gt } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { leagues, periods, dealerships, employees, submissions, penalties } from '../db/schema.js';
import { scheduledWindowDatesInRange, cutoffForWindowDate, currentWindow } from '../scheduling/windows.js';
import { sendOnce } from '../email/send.js';
import { reminderEmail, latePenaltyEmail } from '../email/templates.js';
import { renderLeagueEmail } from '../email/render.js';
import { mailStandingsForPeriod } from '../email/standingsMail.js';
import { ccExtraRecipients } from '../email/recipients.js';
import { withAdvisoryLock } from './lock.js';
import { env } from '../env.js';

/**
 * For every open period, for every scheduled window date whose cutoff has
 * passed, penalise any store with no submission filed by that cutoff.
 *
 * Idempotent on `(periodId, dealershipId, kind, windowDate)`, which
 * `penalties_late_window_uq` also enforces — never on the reason text, so a
 * commissioner can waive a penalty (zero its value) or reword its reason
 * without the next tick re-issuing it. The late penalty stacks per missed
 * window (decision #3); it never double-charges the same one.
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

        const already = existingPenalties.some((p) => p.dealershipId === dealership.id && p.windowDate === windowDate);
        if (already) continue;

        await db.insert(penalties).values({
          periodId: period.id,
          dealershipId: dealership.id,
          kind: 'late_submission',
          value: league.latePenaltyValue,
          reason: `Missed the noon cutoff for ${windowDate}`,
          windowDate,
        });
        issued++;

        const manager = (await db.select().from(employees).where(and(eq(employees.dealershipId, dealership.id), eq(employees.role, 'manager')))).at(0);
        if (manager) {
          const data = {
            recipientName: manager.alias ?? manager.name,
            dealershipName: dealership.alias ?? dealership.name,
            windowDate,
            penaltyValue: Number(league.latePenaltyValue),
          };
          const tpl = await renderLeagueEmail(league.id, 'late-penalty', { ...data, penaltyValue: String(data.penaltyValue) }, latePenaltyEmail(data));
          const send = { leagueId: league.id, template: `late-penalty:${windowDate}`, periodId: period.id, ...tpl };
          await sendOnce({ ...send, to: manager.email });
          await ccExtraRecipients(league.id, 'late-penalty', dealership.id, send);
        }
      }
    }
  }
  return issued;
}

/** Emails a manager who hasn't filed for the window closing within the league's `reminderLeadHours` (default 2). */
export async function sendPreDeadlineReminders(): Promise<number> {
  let sent = 0;
  const openPeriods = await db.select().from(periods).where(eq(periods.status, 'open'));
  for (const period of openPeriods) {
    const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
    if (!league) continue;
    const scheduleSettings = { timezone: league.timezone, submissionDays: league.submissionDays, submissionCutoffTime: league.submissionCutoffTime };
    const window = currentWindow(new Date(), scheduleSettings);
    const hoursToNextCutoff = (window.nextCutoffAtUtc.getTime() - Date.now()) / (60 * 60 * 1000);
    if (hoursToNextCutoff > league.reminderLeadHours || hoursToNextCutoff < 0) continue;

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
      const data = {
        recipientName: manager.alias ?? manager.name,
        dealershipName: dealership.alias ?? dealership.name,
        cutoffLocal,
        entryUrl: `${env.appBaseUrl}/enter`,
      };
      const tpl = await renderLeagueEmail(league.id, 'reminder', data, reminderEmail(data));
      const send = { leagueId: league.id, template: `reminder:${window.nextWindowDate}`, periodId: period.id, ...tpl };
      const result = await sendOnce({ ...send, to: manager.email });
      if (result === 'sent') sent++;
      await ccExtraRecipients(league.id, 'reminder', dealership.id, send);
    }
  }
  return sent;
}

/**
 * Mails every ranked advisor and manager once a period is published, unless
 * the league has turned auto-mail off. That toggle gates this job only —
 * Admin's "send standings now" stays available either way, because a
 * commissioner clicking it is an explicit decision, not a schedule.
 */
export async function mailPublishedStandings(): Promise<number> {
  let sent = 0;
  const publishedPeriods = await db.select().from(periods).where(eq(periods.status, 'published'));
  for (const period of publishedPeriods) {
    const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
    if (!league?.autoMailStandingsOnPublish) continue;
    const result = await mailStandingsForPeriod(period.id);
    sent += result.sent;
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

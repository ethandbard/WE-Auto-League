// The scheduler applies point penalties people are paid against, so a redeploy
// that fires a job twice must be a no-op rather than a double charge
// (CLAUDE.md, "Scheduled jobs must be idempotent"). This suite proves the
// no-op on real rows.
//
// `sendOnce` runs here with the console transport — no provider credential is
// set in the test environment — so the late-penalty mail is logged to
// `email_log` and printed, never sent.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DateTime } from 'luxon';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { emailLog, penalties, submissions } from '../../src/db/schema.js';
import { applyMissedWindowPenalties } from '../../src/scheduler/jobs.js';
import { closeDatabase, resetDatabase, seedDealership, seedEmployee, seedLeague, seedPeriod } from './harness.js';

const TIMEZONE = 'America/Los_Angeles';

// One window date, 30 days back, and submission days set to just that weekday
// — so the period has exactly one past cutoff no matter when the suite runs.
const windowDay = DateTime.now().setZone(TIMEZONE).minus({ days: 30 }).startOf('day');
const WINDOW_DATE = windowDay.toFormat('yyyy-MM-dd');
const CUTOFF = windowDay.set({ hour: 12 }).toUTC().toJSDate();

let leagueId: number;
let periodId: number;
let lateStore: number;
let onTimeStore: number;
let lateManagerEmail: string;

before(async () => {
  await resetDatabase();
  const league = await seedLeague({ timezone: TIMEZONE, submissionDays: [windowDay.weekday] });
  leagueId = league.id;
  const period = await seedPeriod(leagueId, { startsOn: WINDOW_DATE, endsOn: WINDOW_DATE, status: 'open' });
  periodId = period.id;

  lateStore = (await seedDealership(leagueId, 'Never Filed Motors')).id;
  onTimeStore = (await seedDealership(leagueId, 'Filed On Time Motors')).id;

  const lateManager = await seedEmployee(leagueId, { name: 'Larry Late', role: 'manager', dealershipId: lateStore });
  lateManagerEmail = lateManager.email;
  const onTimeManager = await seedEmployee(leagueId, { name: 'Prompt Pat', role: 'manager', dealershipId: onTimeStore });

  await db.insert(submissions).values({
    dealershipId: onTimeStore,
    periodId,
    windowDate: WINDOW_DATE,
    submittedBy: onTimeManager.id,
    submittedAt: new Date(CUTOFF.getTime() - 60 * 60 * 1000),
    onTime: true,
  });
});

after(closeDatabase);

const latePenalties = () =>
  db.select().from(penalties).where(and(eq(penalties.periodId, periodId), eq(penalties.kind, 'late_submission')));

test('a store with no filing past the cutoff gets exactly one penalty', async () => {
  const issued = await applyMissedWindowPenalties();
  assert.equal(issued, 1);

  const rows = await latePenalties();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.dealershipId, lateStore);
  assert.equal(Number(rows[0]!.value), 2);
  assert.match(rows[0]!.reason, new RegExp(WINDOW_DATE));
});

test('a store that filed before the cutoff gets none', async () => {
  const rows = await latePenalties();
  assert.equal(rows.filter((r) => r.dealershipId === onTimeStore).length, 0);
});

test('the penalised store manager is mailed once', async () => {
  const rows = await db.select().from(emailLog).where(eq(emailLog.recipientEmail, lateManagerEmail));
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.template, `late-penalty:${WINDOW_DATE}`);
  assert.equal(rows[0]!.status, 'sent');
});

test('a second run adds no penalty and no second email', async () => {
  const issued = await applyMissedWindowPenalties();
  assert.equal(issued, 0, 'a re-fired job must be a no-op, not a double charge');

  const rows = await latePenalties();
  assert.equal(rows.length, 1);

  const mail = await db.select().from(emailLog).where(eq(emailLog.recipientEmail, lateManagerEmail));
  assert.equal(mail.length, 1, 'sendOnce dedupes on (template, period, recipient)');
});

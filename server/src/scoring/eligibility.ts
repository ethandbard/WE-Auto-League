// Decision #6: the incumbent's three eligibility rules, carried over as
// league toggles defaulted on. The predicates are pure — callers supply the
// facts already resolved from the database. updateFloaterCounters is the
// one DB-facing exception: it persists consecutive floater months at lock.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees, metricValues, periods, submissions } from '../db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** True while an advisor is still inside their new-hire grace window at a period's close. */
export function isNewHireGraceActive(hireDate: Date, periodEndsOn: Date, graceDays: number): boolean {
  const daysEmployed = (periodEndsOn.getTime() - hireDate.getTime()) / DAY_MS;
  return daysEmployed < graceDays;
}

export type ParticipationStatus = 'eligible' | 'hidden' | 'terminated';

/**
 * Whether an advisor's numbers count toward scoring for a period at all.
 * Decision #5: hidden is full exclusion, not partial inclusion.
 */
export function isAdvisorScored(
  status: ParticipationStatus,
  opts: { hireDate?: Date | null; periodEndsOn: Date; newHireGraceDays: number; graceRuleEnabled: boolean },
): boolean {
  if (status !== 'eligible') return false;
  if (opts.graceRuleEnabled && opts.hireDate) {
    if (isNewHireGraceActive(opts.hireDate, opts.periodEndsOn, opts.newHireGraceDays)) return false;
  }
  return true;
}

/** A manager needs at least `minAdvisors` scored advisors to be eligible to win. */
export function isManagerEligibleToWin(scoredAdvisorCount: number, minAdvisors: number): boolean {
  return scoredAdvisorCount >= minAdvisors;
}

/**
 * A floater who has written service for two consecutive months must be
 * entered on the roster proper by their third. This doesn't exclude anyone
 * from scoring by itself — it's a compliance flag the admin/compliance view
 * (Phase 5) surfaces to the manager before the month closes, per decision #6.
 */
export function floaterNeedsRosterEntry(consecutiveMonthsAsFloater: number, ruleEnabled: boolean): boolean {
  return ruleEnabled && consecutiveMonthsAsFloater >= 2;
}

/**
 * Increments consecutiveFloaterMonths for any unassigned advisor who filed
 * this period; resets everyone else to 0. Called from period lock, once.
 */
export async function updateFloaterCounters(periodId: number): Promise<void> {
  const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
  if (!period) return;

  const floaters = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.leagueId, period.leagueId),
        eq(employees.role, 'advisor'),
        isNull(employees.dealershipId),
        isNull(employees.archivedAt),
      ),
    );
  if (!floaters.length) return;

  const periodSubmissions = await db.select({ id: submissions.id }).from(submissions).where(eq(submissions.periodId, periodId));
  const submittedIds = new Set<number>();
  if (periodSubmissions.length) {
    const values = await db
      .select({ employeeId: metricValues.employeeId })
      .from(metricValues)
      .where(
        and(
          inArray(
            metricValues.submissionId,
            periodSubmissions.map((s) => s.id),
          ),
          inArray(
            metricValues.employeeId,
            floaters.map((f) => f.id),
          ),
        ),
      );
    for (const row of values) {
      if (row.employeeId != null) submittedIds.add(row.employeeId);
    }
  }

  for (const floater of floaters) {
    const next = submittedIds.has(floater.id) ? floater.consecutiveFloaterMonths + 1 : 0;
    if (next === floater.consecutiveFloaterMonths) continue;
    await db.update(employees).set({ consecutiveFloaterMonths: next }).where(eq(employees.id, floater.id));
  }
}

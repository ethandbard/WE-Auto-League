// Decision #6: the incumbent's three eligibility rules, carried over as
// league toggles defaulted on. Pure predicates — callers supply the facts
// (participation status, dates, counts) already resolved from the database.

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

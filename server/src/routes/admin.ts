import { Router } from 'express';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { submissions, dealerships, employees, penalties, periods, participation, leagues } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';

export const adminRouter = Router();

/** Who filed late, who's flagged, whose store is short of the manager-eligibility minimum — surfaced before the month closes. */
adminRouter.get(
  '/compliance',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const periodId = Number(req.query.periodId);
    if (!Number.isFinite(periodId)) throw badRequest('periodId is required');
    const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
    if (!period) throw notFound('Period not found');
    const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
    if (!league) throw notFound('League not found');

    const dealershipRows = await db.select().from(dealerships).where(and(eq(dealerships.leagueId, league.id), isNull(dealerships.archivedAt)));
    const submissionRows = await db.select().from(submissions).where(eq(submissions.periodId, periodId));
    const lateSubmissions = submissionRows.filter((s) => !s.onTime);

    const trainingFlags = await db.select().from(penalties).where(and(eq(penalties.periodId, periodId), eq(penalties.kind, 'training_incomplete')));

    const participationRows = await db.select().from(participation).where(eq(participation.periodId, periodId));
    const statusByEmployee = new Map(participationRows.map((p) => [p.employeeId, p.status]));
    const advisorRows = await db.select().from(employees).where(and(eq(employees.role, 'advisor'), isNull(employees.archivedAt)));

    const storeMinWarnings = dealershipRows
      .map((d) => {
        const advisors = advisorRows.filter((a) => a.dealershipId === d.id);
        const eligible = advisors.filter((a) => (statusByEmployee.get(a.id) ?? 'eligible') === 'eligible').length;
        return { dealershipId: d.id, dealershipName: d.name, eligibleAdvisors: eligible, minimum: league.eligibilityMinAdvisorsForManager };
      })
      .filter((w) => w.eligibleAdvisors < w.minimum);

    res.json({
      period,
      lateSubmissions: lateSubmissions.map((s) => ({ dealershipId: s.dealershipId, windowDate: s.windowDate, submittedAt: s.submittedAt })),
      trainingFlags,
      storeMinWarnings,
      submittedStoreCount: new Set(submissionRows.map((s) => s.dealershipId)).size,
      totalStoreCount: dealershipRows.length,
    });
  }),
);

adminRouter.get(
  '/overview',
  requireRole('commissioner'),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    const dealershipRows = await db.select().from(dealerships).where(and(eq(dealerships.leagueId, league.id), isNull(dealerships.archivedAt)));
    const employeeRows = await db.select().from(employees).where(and(eq(employees.leagueId, league.id), isNull(employees.archivedAt)));
    const periodRows = await db.select().from(periods).where(eq(periods.leagueId, league.id)).orderBy(desc(periods.startsOn)).limit(1);
    res.json({
      league,
      dealershipCount: dealershipRows.length,
      employeeCount: employeeRows.length,
      advisorCount: employeeRows.filter((e) => e.role === 'advisor').length,
      managerCount: employeeRows.filter((e) => e.role === 'manager').length,
      currentPeriod: periodRows[0] ?? null,
    });
  }),
);

import { Router } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees, dealerships, periods } from '../db/schema.js';
import { asyncHandler, notFound } from '../http.js';
import { requireAuth } from '../middleware.js';
import { currentScoresFor } from '../scoring/compute.js';

export const scoresRouter = Router();

type Score = Awaited<ReturnType<typeof currentScoresFor>>[number];
type DecoratedScore = Score & { employeeName: string | null; dealershipName: string | null };

/** Joins employee/dealership display names onto a set of score rows in two batched lookups. */
async function decorateScores(rows: Score[]): Promise<DecoratedScore[]> {
  const employeeIds = [...new Set(rows.map((s) => s.employeeId).filter((id): id is number => id != null))];
  const dealershipIds = [...new Set(rows.map((s) => s.dealershipId).filter((id): id is number => id != null))];
  const employeeRows = employeeIds.length ? await db.select().from(employees).where(inArray(employees.id, employeeIds)) : [];
  const dealershipRows = dealershipIds.length ? await db.select().from(dealerships).where(inArray(dealerships.id, dealershipIds)) : [];
  const employeeById = new Map(employeeRows.map((e) => [e.id, e]));
  const dealershipById = new Map(dealershipRows.map((d) => [d.id, d]));
  return rows.map((s) => ({
    ...s,
    employeeName: s.employeeId != null ? (employeeById.get(s.employeeId)?.alias ?? employeeById.get(s.employeeId)?.name ?? null) : null,
    dealershipName: s.dealershipId != null ? (dealershipById.get(s.dealershipId)?.alias ?? dealershipById.get(s.dealershipId)?.name ?? null) : null,
  }));
}

/** The Victory Lane board: both leaderboards for a period, in one call. */
scoresRouter.get(
  '/:periodId/standings',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const periodId = Number(req.params.periodId);
    const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
    if (!period) throw notFound('Period not found');

    const [advisorScores, managerScores, teamScores] = await Promise.all([
      currentScoresFor(periodId, 'advisor'),
      currentScoresFor(periodId, 'manager'),
      currentScoresFor(periodId, 'team'),
    ]);
    const [advisors, managers, teams] = await Promise.all([decorateScores(advisorScores), decorateScores(managerScores), decorateScores(teamScores)]);

    res.json({
      period,
      advisors: advisors.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      managers: managers.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
      teams: teams.sort((a, b) => Number(b.total) - Number(a.total)),
    });
  }),
);

/** An advisor's personal card: their breakdown, and what one more unit in each category is worth. */
scoresRouter.get(
  '/:periodId/advisor/:employeeId',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const periodId = Number(req.params.periodId);
    const employeeId = Number(req.params.employeeId);
    const all = await currentScoresFor(periodId, 'advisor');
    const mineRaw = all.find((s) => s.employeeId === employeeId);
    if (!mineRaw) throw notFound('No score for this advisor in this period yet.');

    const sorted = [...all].sort((a, b) => Number(b.total) - Number(a.total));
    const myIndex = sorted.findIndex((s) => s.id === mineRaw.id);
    const ahead = myIndex > 0 ? sorted[myIndex - 1] : null;
    const gapToNext = ahead ? Math.round((Number(ahead.total) - Number(mineRaw.total)) * 100) / 100 : 0;

    const [mine] = await decorateScores([mineRaw]);
    res.json({
      score: mine,
      position: mineRaw.position,
      totalAdvisors: sorted.length,
      gapToNextPosition: gapToNext,
      nextPositionHolder: ahead ? { employeeId: ahead.employeeId, total: ahead.total } : null,
    });
  }),
);

/** A manager's store view: their score plus their roster's advisor scores. */
scoresRouter.get(
  '/:periodId/dealership/:dealershipId',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const periodId = Number(req.params.periodId);
    const dealershipId = Number(req.params.dealershipId);
    const [dealership] = await db.select().from(dealerships).where(eq(dealerships.id, dealershipId)).limit(1);
    if (!dealership) throw notFound('Dealership not found');

    const [advisorScores, managerScores, teamScores] = await Promise.all([
      currentScoresFor(periodId, 'advisor'),
      currentScoresFor(periodId, 'manager'),
      currentScoresFor(periodId, 'team'),
    ]);
    const storeAdvisors = await decorateScores(advisorScores.filter((s) => s.dealershipId === dealershipId));
    const manager = managerScores.find((s) => s.dealershipId === dealershipId) ?? null;
    const team = teamScores.find((s) => s.dealershipId === dealershipId) ?? null;

    res.json({ dealership, manager, team, advisors: storeAdvisors.sort((a, b) => Number(b.total) - Number(a.total)) });
  }),
);

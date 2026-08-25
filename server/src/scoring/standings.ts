import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees, dealerships, periods } from '../db/schema.js';
import { notFound } from '../http.js';
import { currentScoresFor } from './compute.js';

type Score = Awaited<ReturnType<typeof currentScoresFor>>[number];
export type DecoratedScore = Score & { employeeName: string | null; dealershipName: string | null };

export interface FullStandings {
  period: typeof periods.$inferSelect;
  advisors: DecoratedScore[];
  managers: DecoratedScore[];
  teams: DecoratedScore[];
}

/** Joins employee/dealership display names onto a set of score rows in two batched lookups. */
export async function decorateScores(rows: Score[]): Promise<DecoratedScore[]> {
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

export async function fullStandingsFor(periodId: number): Promise<FullStandings> {
  const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
  if (!period) throw notFound('Period not found');

  const [advisorScores, managerScores, teamScores] = await Promise.all([
    currentScoresFor(periodId, 'advisor'),
    currentScoresFor(periodId, 'manager'),
    currentScoresFor(periodId, 'team'),
  ]);
  const [advisors, managers, teams] = await Promise.all([
    decorateScores(advisorScores),
    decorateScores(managerScores),
    decorateScores(teamScores),
  ]);

  return {
    period,
    advisors: advisors.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    managers: managers.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
    teams: teams.sort((a, b) => Number(b.total) - Number(a.total)),
  };
}

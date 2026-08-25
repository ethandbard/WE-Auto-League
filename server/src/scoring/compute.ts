// Wires the pure engine (engine.ts) to the database: reads the latest
// submission per store for a period, scores every eligible advisor, derives
// the team score, scores the manager, and stores the result.
//
// Published standings are immutable (see CLAUDE.md): once any row for a
// period is published, a recompute writes a NEW revision rather than
// touching the published rows. "Current" is always the highest revision.
import { and, eq, isNull, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  periods,
  leagues,
  dealerships,
  employees,
  participation,
  categories,
  categoryWeights,
  goals,
  submissions,
  metricValues,
  penalties,
  scores,
} from '../db/schema.js';
import { scoreAdvisor, scoreTeam, scoreManager, applyPenalties, assignPositions, ENGINE_VERSION } from './engine.js';
import { isAdvisorScored, type ParticipationStatus } from './eligibility.js';

async function latestSubmission(dealershipId: number, periodId: number) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(and(eq(submissions.dealershipId, dealershipId), eq(submissions.periodId, periodId)))
    .orderBy(desc(submissions.submittedAt))
    .limit(1);
  return row ?? null;
}

async function nextRevision(periodId: number): Promise<{ revision: number; hadPublished: boolean }> {
  const existing = await db.select().from(scores).where(eq(scores.periodId, periodId));
  const hadPublished = existing.some((s) => s.isPublished);
  if (!hadPublished) {
    // Draft recomputes overwrite each other rather than accumulating revisions.
    if (existing.length) await db.delete(scores).where(eq(scores.periodId, periodId));
    return { revision: 1, hadPublished: false };
  }
  return { revision: Math.max(...existing.map((s) => s.revision)) + 1, hadPublished: true };
}

export interface ComputeResult {
  revision: number;
  dealershipsScored: number;
  advisorsScored: number;
}

export async function computePeriodScores(periodId: number): Promise<ComputeResult> {
  const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
  if (!period) throw new Error(`Unknown period ${periodId}`);
  const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
  if (!league) throw new Error(`Unknown league for period ${periodId}`);

  const { revision, hadPublished } = await nextRevision(periodId);

  const allCategories = await db.select().from(categories).where(eq(categories.leagueId, league.id));
  const categoryById = new Map(allCategories.map((c) => [c.id, c]));
  const weightRows = await db.select().from(categoryWeights).where(eq(categoryWeights.periodId, periodId));
  const weightByCategoryId = new Map(weightRows.map((w) => [w.categoryId, Number(w.weight)]));

  const advisorWeights: Record<string, number> = {};
  const managerWeights: Record<string, number> = {};
  for (const c of allCategories) {
    const w = weightByCategoryId.get(c.id);
    if (w == null) continue;
    (c.scope === 'advisor' ? advisorWeights : managerWeights)[c.key] = w;
  }

  const cap = league.attainmentCap != null ? Number(league.attainmentCap) : null;
  const dealershipRows = await db
    .select()
    .from(dealerships)
    .where(and(eq(dealerships.leagueId, league.id), isNull(dealerships.archivedAt)));

  const participationRows = await db.select().from(participation).where(eq(participation.periodId, periodId));
  const participationByEmployee = new Map(participationRows.map((p) => [p.employeeId, p.status as ParticipationStatus]));
  const periodEndsOn = new Date(period.endsOn);

  const insertedAdvisorRows: Array<typeof scores.$inferInsert & { _brandKey: number }> = [];
  const insertedManagerRows: typeof scores.$inferInsert[] = [];
  let advisorsScored = 0;
  let dealershipsScored = 0;

  for (const dealership of dealershipRows) {
    const goalRows = await db.select().from(goals).where(and(eq(goals.dealershipId, dealership.id), eq(goals.periodId, periodId)));
    const goalByKey: Record<string, number> = {};
    for (const g of goalRows) {
      const cat = categoryById.get(g.categoryId);
      if (cat) goalByKey[cat.key] = Number(g.value);
    }

    const submission = await latestSubmission(dealership.id, periodId);
    if (!submission) continue;
    const mvRows = await db.select().from(metricValues).where(eq(metricValues.submissionId, submission.id));

    const employeeRows = await db
      .select()
      .from(employees)
      .where(and(eq(employees.dealershipId, dealership.id), isNull(employees.archivedAt)));
    const advisorRows = employeeRows.filter((e) => e.role === 'advisor');
    const managerRow = employeeRows.find((e) => e.role === 'manager') ?? null;

    const eligibleAdvisorScores: number[] = [];

    for (const advisor of advisorRows) {
      const status = participationByEmployee.get(advisor.id) ?? 'eligible';
      const scored = isAdvisorScored(status, {
        hireDate: advisor.hireDate ? new Date(advisor.hireDate) : null,
        periodEndsOn,
        newHireGraceDays: league.eligibilityNewHireGraceDays,
        graceRuleEnabled: true,
      });
      if (!scored) continue;

      const actual: Record<string, number> = {};
      for (const mv of mvRows) {
        if (mv.employeeId !== advisor.id) continue;
        const cat = categoryById.get(mv.categoryId);
        if (cat) actual[cat.key] = Number(mv.value);
      }
      if (Object.keys(actual).length === 0) continue;

      const { breakdown, total } = scoreAdvisor(actual, goalByKey, advisorWeights, { attainmentCap: cap });
      const penaltyRows = await db
        .select()
        .from(penalties)
        .where(and(eq(penalties.periodId, periodId), eq(penalties.employeeId, advisor.id)));
      const { total: finalTotal, penaltyTotal } = applyPenalties(total, penaltyRows.map((p) => Number(p.value)));

      insertedAdvisorRows.push({
        periodId,
        scope: 'advisor',
        employeeId: advisor.id,
        dealershipId: dealership.id,
        categoryBreakdown: breakdown,
        total: String(finalTotal),
        penaltyTotal: String(penaltyTotal),
        engineVersion: ENGINE_VERSION,
        revision,
        _brandKey: dealership.id,
      });
      eligibleAdvisorScores.push(finalTotal);
      advisorsScored++;
    }

    const teamScore = scoreTeam(eligibleAdvisorScores);
    await db.insert(scores).values({
      periodId,
      scope: 'team',
      dealershipId: dealership.id,
      categoryBreakdown: { advisorCount: eligibleAdvisorScores.length },
      total: String(teamScore),
      engineVersion: ENGINE_VERSION,
      revision,
    });

    if (managerRow) {
      const actual: Record<string, number> = { teamScore };
      for (const mv of mvRows) {
        if (mv.employeeId !== null) continue;
        const cat = categoryById.get(mv.categoryId);
        if (cat && cat.key !== 'teamScore') actual[cat.key] = Number(mv.value);
      }
      const { breakdown, total } = scoreManager(actual, managerWeights, { attainmentCap: cap });
      const penaltyRows = await db
        .select()
        .from(penalties)
        .where(and(eq(penalties.periodId, periodId), eq(penalties.dealershipId, dealership.id)));
      const { total: finalTotal, penaltyTotal } = applyPenalties(total, penaltyRows.map((p) => Number(p.value)));

      insertedManagerRows.push({
        periodId,
        scope: 'manager',
        employeeId: managerRow.id,
        dealershipId: dealership.id,
        categoryBreakdown: breakdown,
        total: String(finalTotal),
        penaltyTotal: String(penaltyTotal),
        engineVersion: ENGINE_VERSION,
        revision,
      });
    }
    dealershipsScored++;
  }

  if (insertedAdvisorRows.length) {
    await db.insert(scores).values(insertedAdvisorRows.map(({ _brandKey, ...row }) => row));
  }
  if (insertedManagerRows.length) {
    await db.insert(scores).values(insertedManagerRows);
  }

  await rankPeriodScores(periodId, revision, 'advisor');
  await rankPeriodScores(periodId, revision, 'manager');

  if (hadPublished) await linkSupersededRows(periodId, revision);

  return { revision, dealershipsScored, advisorsScored };
}

async function rankPeriodScores(periodId: number, revision: number, scope: 'advisor' | 'manager' | 'team'): Promise<void> {
  const rows = await db
    .select()
    .from(scores)
    .where(and(eq(scores.periodId, periodId), eq(scores.revision, revision), eq(scores.scope, scope)));
  const sorted = [...rows].sort((a, b) => Number(b.total) - Number(a.total));
  const ranked = assignPositions(sorted, (r) => Number(r.total));
  for (const row of ranked) {
    await db.update(scores).set({ position: row.position }).where(eq(scores.id, row.id));
  }
}

/** Best-effort: points each row in the new revision back at the published row it corrects, keyed by (scope, employeeId, dealershipId). */
async function linkSupersededRows(periodId: number, newRevision: number): Promise<void> {
  const previouslyPublished = await db
    .select()
    .from(scores)
    .where(and(eq(scores.periodId, periodId), eq(scores.isPublished, true)));
  const newRows = await db.select().from(scores).where(and(eq(scores.periodId, periodId), eq(scores.revision, newRevision)));

  const keyOf = (r: { scope: string; employeeId: number | null; dealershipId: number | null }) =>
    `${r.scope}:${r.employeeId ?? ''}:${r.dealershipId ?? ''}`;
  const newByKey = new Map(newRows.map((r) => [keyOf(r), r]));

  for (const old of previouslyPublished) {
    if (old.supersededById) continue; // already linked by an earlier correction
    const replacement = newByKey.get(keyOf(old));
    if (replacement) {
      await db.update(scores).set({ supersededById: replacement.id }).where(eq(scores.id, old.id));
    }
  }
}

/** The set of rows a normal read should show: the highest revision per (scope, employeeId, dealershipId). */
export async function currentScoresFor(periodId: number, scope?: 'advisor' | 'manager' | 'team') {
  const rows = await db
    .select()
    .from(scores)
    .where(scope ? and(eq(scores.periodId, periodId), eq(scores.scope, scope)) : eq(scores.periodId, periodId));
  const byKey = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.scope}:${row.employeeId ?? ''}:${row.dealershipId ?? ''}`;
    const existing = byKey.get(key);
    if (!existing || row.revision > existing.revision) byKey.set(key, row);
  }
  return [...byKey.values()];
}

/** Publishes the current (highest) revision for a period. Idempotent: rows already published are left alone. */
export async function publishPeriodScores(periodId: number): Promise<number> {
  const current = await currentScoresFor(periodId);
  const toPublish = current.filter((r) => !r.isPublished);
  const now = new Date();
  for (const row of toPublish) {
    await db.update(scores).set({ isPublished: true, publishedAt: now }).where(eq(scores.id, row.id));
  }
  return toPublish.length;
}

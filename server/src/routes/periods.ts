import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { periods, categoryWeights, goals, submissions } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';
import { computePeriodScores, publishPeriodScores } from '../scoring/compute.js';

export const periodsRouter = Router();

periodsRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    const rows = await db.select().from(periods).where(eq(periods.leagueId, league.id)).orderBy(desc(periods.startsOn));
    res.json({ periods: rows });
  }),
);

periodsRouter.get(
  '/:id',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const [row] = await db.select().from(periods).where(eq(periods.id, Number(req.params.id))).limit(1);
    if (!row) throw notFound('Period not found');
    res.json({ period: row });
  }),
);

const createSchema = z.object({
  label: z.string().min(1),
  startsOn: z.string(),
  endsOn: z.string(),
  /** Copy category weights + goals from this period, so nobody retypes them for a new month. */
  carryForwardFromPeriodId: z.number().int().positive().optional(),
});

periodsRouter.post(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const league = await currentLeague();

    const [period] = await db
      .insert(periods)
      .values({ leagueId: league.id, label: body.label, startsOn: body.startsOn, endsOn: body.endsOn })
      .returning();

    if (body.carryForwardFromPeriodId) {
      const priorWeights = await db.select().from(categoryWeights).where(eq(categoryWeights.periodId, body.carryForwardFromPeriodId));
      if (priorWeights.length) {
        await db.insert(categoryWeights).values(
          priorWeights.map((w) => ({ categoryId: w.categoryId, periodId: period!.id, weight: w.weight })),
        );
      }
      const priorGoals = await db.select().from(goals).where(eq(goals.periodId, body.carryForwardFromPeriodId));
      if (priorGoals.length) {
        await db.insert(goals).values(
          priorGoals.map((g) => ({
            dealershipId: g.dealershipId,
            categoryId: g.categoryId,
            periodId: period!.id,
            value: g.value,
            source: g.source,
          })),
        );
      }
    }

    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'period.create', entityType: 'period', entityId: period!.id, after: period });
    res.status(201).json({ period });
  }),
);

/** Locks the period: no more submissions, marks the latest filing per store as final, and computes scores. */
periodsRouter.post(
  '/:id/lock',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [period] = await db.select().from(periods).where(eq(periods.id, id)).limit(1);
    if (!period) throw notFound('Period not found');
    if (period.status !== 'open') throw badRequest(`Period is already ${period.status}`);

    const latestPerDealership = await db
      .selectDistinctOn([submissions.dealershipId], { id: submissions.id, dealershipId: submissions.dealershipId })
      .from(submissions)
      .where(eq(submissions.periodId, id))
      .orderBy(submissions.dealershipId, desc(submissions.submittedAt));
    for (const row of latestPerDealership) {
      await db.update(submissions).set({ isFinal: true }).where(eq(submissions.id, row.id));
    }

    const [updated] = await db.update(periods).set({ status: 'locked', lockedAt: new Date() }).where(eq(periods.id, id)).returning();
    const result = await computePeriodScores(id);
    await writeAudit({ actor: req.actor ?? null, leagueId: period.leagueId, action: 'period.lock', entityType: 'period', entityId: id, after: updated });
    res.json({ period: updated, scoring: result });
  }),
);

/** Publishes the current score revision. Immutable from here — a correction is a new revision, never an edit. */
periodsRouter.post(
  '/:id/publish',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [period] = await db.select().from(periods).where(eq(periods.id, id)).limit(1);
    if (!period) throw notFound('Period not found');
    if (period.status === 'open') throw badRequest('Lock the period before publishing.');

    const publishedCount = await publishPeriodScores(id);
    const [updated] = await db.update(periods).set({ status: 'published', publishedAt: new Date() }).where(eq(periods.id, id)).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: period.leagueId, action: 'period.publish', entityType: 'period', entityId: id, after: updated });
    res.json({ period: updated, publishedCount });
  }),
);

/** Recomputes without publishing — for previewing the provisional/live leaderboard mid-month. */
periodsRouter.post(
  '/:id/recompute',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await computePeriodScores(id);
    res.json({ scoring: result });
  }),
);

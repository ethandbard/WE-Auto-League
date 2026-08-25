import { Router } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { goals } from '../db/schema.js';
import { asyncHandler, badRequest } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { writeAudit } from '../audit.js';

export const goalsRouter = Router();

goalsRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const periodId = Number(req.query.periodId);
    if (!Number.isFinite(periodId)) throw badRequest('periodId is required');
    const dealershipId = req.query.dealershipId ? Number(req.query.dealershipId) : undefined;
    const conditions = [eq(goals.periodId, periodId)];
    if (dealershipId) conditions.push(eq(goals.dealershipId, dealershipId));
    const rows = await db.select().from(goals).where(and(...conditions));
    res.json({ goals: rows });
  }),
);

const setSchema = z.object({
  periodId: z.number().int().positive(),
  dealershipId: z.number().int().positive(),
  values: z.array(z.object({ categoryId: z.number().int().positive(), value: z.number() })).min(1),
  source: z.enum(['league_default', 'store_override']).default('store_override'),
});

goalsRouter.put(
  '/',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const body = setSchema.parse(req.body);
    if (req.actor!.role === 'manager' && req.actor!.dealershipId !== body.dealershipId) {
      throw badRequest('Managers can only set goals for their own store.');
    }
    for (const { categoryId, value } of body.values) {
      const [existing] = await db
        .select()
        .from(goals)
        .where(and(eq(goals.dealershipId, body.dealershipId), eq(goals.categoryId, categoryId), eq(goals.periodId, body.periodId)))
        .limit(1);
      if (existing) {
        await db.update(goals).set({ value: String(value), source: body.source }).where(eq(goals.id, existing.id));
      } else {
        await db.insert(goals).values({ dealershipId: body.dealershipId, categoryId, periodId: body.periodId, value: String(value), source: body.source });
      }
    }
    await writeAudit({ actor: req.actor ?? null, leagueId: null, action: 'goals.set', entityType: 'goals', after: body });
    res.json({ ok: true });
  }),
);

const carryForwardSchema = z.object({ fromPeriodId: z.number().int().positive(), toPeriodId: z.number().int().positive() });

/** Fills in only the (dealership, category) pairs missing in the target period — an existing override is never clobbered. */
goalsRouter.post(
  '/carry-forward',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = carryForwardSchema.parse(req.body);
    const source = await db.select().from(goals).where(eq(goals.periodId, body.fromPeriodId));
    const target = await db.select().from(goals).where(eq(goals.periodId, body.toPeriodId));
    const existingKeys = new Set(target.map((g) => `${g.dealershipId}:${g.categoryId}`));
    const toInsert = source
      .filter((g) => !existingKeys.has(`${g.dealershipId}:${g.categoryId}`))
      .map((g) => ({ dealershipId: g.dealershipId, categoryId: g.categoryId, periodId: body.toPeriodId, value: g.value, source: g.source }));
    if (toInsert.length) await db.insert(goals).values(toInsert);
    await writeAudit({ actor: req.actor ?? null, leagueId: null, action: 'goals.carry_forward', entityType: 'goals', after: { ...body, count: toInsert.length } });
    res.json({ copied: toInsert.length });
  }),
);

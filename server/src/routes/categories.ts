import { Router } from 'express';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { categories, categoryWeights } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';
import { weightsTotalTo100 } from '../scoring/engine.js';

export const categoriesRouter = Router();

categoriesRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const league = await currentLeague();
    const periodId = req.query.periodId ? Number(req.query.periodId) : undefined;
    const rows = await db.select().from(categories).where(eq(categories.leagueId, league.id));
    if (!periodId) {
      res.json({ categories: rows });
      return;
    }
    const weights = await db.select().from(categoryWeights).where(eq(categoryWeights.periodId, periodId));
    const weightByCategory = new Map(weights.map((w) => [w.categoryId, Number(w.weight)]));
    res.json({ categories: rows.map((c) => ({ ...c, weight: weightByCategory.get(c.id) ?? null })) });
  }),
);

const createSchema = z.object({
  key: z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'key must be a camelCase identifier'),
  label: z.string().min(1),
  scope: z.enum(['advisor', 'manager']),
  unit: z.enum(['count', 'currency', 'ratio', 'percent']),
  direction: z.enum(['higher_better', 'lower_better']).default('higher_better'),
  isDerived: z.boolean().default(false),
});

/**
 * Categories are data, not columns — see CLAUDE.md. Creating one does not by
 * itself change any scope's weights; PUT /weights below enforces the
 * "must total 100" invariant whenever weights are next set, which is what
 * forces whoever activates a new category to restate the others (decision #4).
 */
categoriesRouter.post(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const league = await currentLeague();
    const [row] = await db.insert(categories).values({ leagueId: league.id, ...body }).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'category.create', entityType: 'category', entityId: row!.id, after: row });
    res.status(201).json({ category: row });
  }),
);

const weightsSchema = z.object({
  periodId: z.number().int().positive(),
  scope: z.enum(['advisor', 'manager']),
  weights: z.array(z.object({ categoryId: z.number().int().positive(), weight: z.number().min(0).max(100) })).min(1),
});

categoriesRouter.put(
  '/weights',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = weightsSchema.parse(req.body);
    const league = await currentLeague();

    const scopeCategories = await db.select().from(categories).where(and(eq(categories.leagueId, league.id), eq(categories.scope, body.scope)));
    const activeCategoryIds = new Set(scopeCategories.map((c) => c.id));
    const submitted = new Map(body.weights.map((w) => [w.categoryId, w.weight]));
    for (const id of submitted.keys()) {
      if (!activeCategoryIds.has(id)) throw badRequest(`Category ${id} is not in scope ${body.scope} for this league.`);
    }
    if (submitted.size !== activeCategoryIds.size) {
      throw badRequest(`All ${activeCategoryIds.size} ${body.scope} categories must be given a weight, not just the ones changing.`);
    }
    const weightsRecord = Object.fromEntries(submitted);
    if (!weightsTotalTo100(weightsRecord)) {
      throw badRequest(`${body.scope} weights must total 100 (got ${Object.values(weightsRecord).reduce((a, b) => a + b, 0)}).`);
    }

    for (const [categoryId, weight] of submitted) {
      const [existing] = await db
        .select()
        .from(categoryWeights)
        .where(and(eq(categoryWeights.categoryId, categoryId), eq(categoryWeights.periodId, body.periodId)))
        .limit(1);
      if (existing) {
        await db.update(categoryWeights).set({ weight: String(weight) }).where(eq(categoryWeights.id, existing.id));
      } else {
        await db.insert(categoryWeights).values({ categoryId, periodId: body.periodId, weight: String(weight) });
      }
    }

    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'category.weights.set', entityType: 'category_weights', after: body });
    res.json({ ok: true });
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { dealerships } from '../db/schema.js';
import { asyncHandler, notFound } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';

export const dealershipsRouter = Router();

dealershipsRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const league = await currentLeague();
    const includeArchived = req.query.includeArchived === 'true';
    const rows = await db
      .select()
      .from(dealerships)
      .where(includeArchived ? eq(dealerships.leagueId, league.id) : and(eq(dealerships.leagueId, league.id), isNull(dealerships.archivedAt)));
    res.json({ dealerships: rows });
  }),
);

const createSchema = z.object({ name: z.string().min(1), alias: z.string().min(1).optional() });

dealershipsRouter.post(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const league = await currentLeague();
    const [row] = await db.insert(dealerships).values({ leagueId: league.id, name: body.name, alias: body.alias }).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'dealership.create', entityType: 'dealership', entityId: row!.id, after: row });
    res.status(201).json({ dealership: row });
  }),
);

const updateSchema = z.object({ name: z.string().min(1).optional(), alias: z.string().min(1).nullable().optional() });

dealershipsRouter.patch(
  '/:id',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(dealerships).where(eq(dealerships.id, id)).limit(1);
    if (!before) throw notFound('Dealership not found');
    const body = updateSchema.parse(req.body);
    const [after] = await db.update(dealerships).set(body).where(eq(dealerships.id, id)).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'dealership.update', entityType: 'dealership', entityId: id, before, after });
    res.json({ dealership: after });
  }),
);

dealershipsRouter.post(
  '/:id/archive',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(dealerships).where(eq(dealerships.id, id)).limit(1);
    if (!before) throw notFound('Dealership not found');
    const [after] = await db.update(dealerships).set({ archivedAt: new Date() }).where(eq(dealerships.id, id)).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'dealership.archive', entityType: 'dealership', entityId: id, before, after });
    res.json({ dealership: after });
  }),
);

dealershipsRouter.post(
  '/:id/restore',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(dealerships).where(eq(dealerships.id, id)).limit(1);
    if (!before) throw notFound('Dealership not found');
    const [after] = await db.update(dealerships).set({ archivedAt: null }).where(eq(dealerships.id, id)).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'dealership.restore', entityType: 'dealership', entityId: id, before, after });
    res.json({ dealership: after });
  }),
);

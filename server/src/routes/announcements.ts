import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { announcements, announcementReads } from '../db/schema.js';
import { asyncHandler, badRequest } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';

export const announcementsRouter = Router();

announcementsRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const league = await currentLeague();
    const rows = await db.select().from(announcements).where(eq(announcements.leagueId, league.id)).orderBy(desc(announcements.createdAt));
    const reads = await db
      .select()
      .from(announcementReads)
      .where(eq(announcementReads.employeeId, req.actor!.employeeId));
    const readAnnouncementIds = new Set(reads.map((r) => r.announcementId));
    res.json({ announcements: rows.map((a) => ({ ...a, read: readAnnouncementIds.has(a.id) })) });
  }),
);

const createSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  audience: z.enum(['all', 'managers', 'advisors', 'store']).default('all'),
  dealershipId: z.number().int().positive().optional(),
});

announcementsRouter.post(
  '/',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    if (body.audience === 'store' && !body.dealershipId) throw badRequest('dealershipId is required when audience is "store".');
    const league = await currentLeague();
    const [row] = await db
      .insert(announcements)
      .values({ leagueId: league.id, authorId: req.actor!.employeeId, title: body.title, body: body.body, audience: body.audience, dealershipId: body.dealershipId })
      .returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'announcement.create', entityType: 'announcement', entityId: row!.id, after: row });
    res.status(201).json({ announcement: row });
  }),
);

announcementsRouter.post(
  '/:id/read',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const announcementId = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(announcementReads)
      .where(and(eq(announcementReads.announcementId, announcementId), eq(announcementReads.employeeId, req.actor!.employeeId)))
      .limit(1);
    if (!existing) await db.insert(announcementReads).values({ announcementId, employeeId: req.actor!.employeeId });
    res.json({ ok: true });
  }),
);

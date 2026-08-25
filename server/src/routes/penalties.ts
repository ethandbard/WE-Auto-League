import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { penalties } from '../db/schema.js';
import { asyncHandler, badRequest } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { writeAudit } from '../audit.js';

export const penaltiesRouter = Router();

penaltiesRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const periodId = Number(req.query.periodId);
    if (!Number.isFinite(periodId)) throw badRequest('periodId is required');
    const rows = await db.select().from(penalties).where(eq(penalties.periodId, periodId));
    res.json({ penalties: rows });
  }),
);

const createSchema = z
  .object({
    periodId: z.number().int().positive(),
    dealershipId: z.number().int().positive().optional(),
    employeeId: z.number().int().positive().optional(),
    value: z.number().positive(),
    reason: z.string().min(1),
  })
  .refine((b) => Boolean(b.dealershipId) !== Boolean(b.employeeId), 'Exactly one of dealershipId or employeeId is required.');

/** Manual penalties only — automatic ones (late submission, training) are issued by the scheduler and Phase 4's training flag. */
penaltiesRouter.post(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const [row] = await db
      .insert(penalties)
      .values({
        periodId: body.periodId,
        dealershipId: body.dealershipId ?? null,
        employeeId: body.employeeId ?? null,
        kind: 'manual',
        value: String(body.value),
        reason: body.reason,
        issuedBy: req.actor!.employeeId,
      })
      .returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: null, action: 'penalty.create', entityType: 'penalty', entityId: row!.id, after: row });
    res.status(201).json({ penalty: row });
  }),
);

penaltiesRouter.delete(
  '/:id',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(penalties).where(eq(penalties.id, id)).limit(1);
    if (before?.kind !== 'manual') throw badRequest('Only manual penalties can be removed here.');
    await db.delete(penalties).where(eq(penalties.id, id));
    await writeAudit({ actor: req.actor ?? null, leagueId: null, action: 'penalty.delete', entityType: 'penalty', entityId: id, before });
    res.json({ ok: true });
  }),
);

const trainingSchema = z.object({ periodId: z.number().int().positive(), employeeId: z.number().int().positive(), value: z.number().positive() });

/** The training-criteria flag: -25 to the advisor plus a flag on the report (docs/build-plan.html §The request). */
penaltiesRouter.post(
  '/training-flag',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const body = trainingSchema.parse(req.body);
    const [row] = await db
      .insert(penalties)
      .values({
        periodId: body.periodId,
        employeeId: body.employeeId,
        kind: 'training_incomplete',
        value: String(body.value),
        reason: 'Training criteria incomplete',
        issuedBy: req.actor!.employeeId,
      })
      .returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: null, action: 'penalty.training_flag', entityType: 'penalty', entityId: row!.id, after: row });
    res.status(201).json({ penalty: row });
  }),
);

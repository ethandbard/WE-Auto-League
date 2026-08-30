import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees, penalties, periods } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { writeAudit } from '../audit.js';
import { idParam } from '../validation.js';
import { sendOnce } from '../email/send.js';
import { trainingFlagEmail } from '../email/templates.js';
import { renderLeagueEmail } from '../email/render.js';
import { ccExtraRecipients } from '../email/recipients.js';

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

const waiveSchema = z.object({ reason: z.string().min(1) });

/**
 * Waives any penalty by zeroing its value. The `reason` column is left alone —
 * it is the row's own record of why the penalty was issued — so the why of the
 * waiver goes in the audit row instead.
 *
 * Zeroing rather than deleting keeps the ledger honest: the charge is still
 * visible, at nil. For a `late_submission` row it is also the safe move, since
 * deleting one lets the scheduler re-issue that window.
 */
penaltiesRouter.post(
  '/:id/waive',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const body = waiveSchema.parse(req.body);
    const [before] = await db.select().from(penalties).where(eq(penalties.id, id)).limit(1);
    if (!before) throw notFound('Penalty not found');
    if (Number(before.value) === 0) throw badRequest('That penalty is already waived.');

    const [after] = await db.update(penalties).set({ value: '0' }).where(eq(penalties.id, id)).returning();
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: null,
      action: 'penalty.waive',
      entityType: 'penalty',
      entityId: id,
      before,
      after: { ...after, waiveReason: body.reason },
    });
    res.json({ penalty: after });
  }),
);

penaltiesRouter.delete(
  '/:id',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(penalties).where(eq(penalties.id, id)).limit(1);
    if (before?.kind !== 'manual') throw badRequest('Only manual penalties can be removed here. Waive the others instead.');
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

    const [employee] = await db.select().from(employees).where(eq(employees.id, body.employeeId)).limit(1);
    const [period] = await db.select().from(periods).where(eq(periods.id, body.periodId)).limit(1);
    if (employee && period) {
      const data = {
        recipientName: employee.alias ?? employee.name,
        periodLabel: period.label,
        penaltyValue: body.value,
      };
      const tpl = await renderLeagueEmail(
        employee.leagueId,
        'training-flag',
        { ...data, penaltyValue: String(data.penaltyValue) },
        trainingFlagEmail(data),
      );
      const send = { leagueId: employee.leagueId, template: 'training-flag', periodId: period.id, ...tpl };
      await sendOnce({ ...send, to: employee.email });
      await ccExtraRecipients(employee.leagueId, 'training-flag', employee.dealershipId, send);
    }

    res.status(201).json({ penalty: row });
  }),
);

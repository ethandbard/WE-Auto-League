import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailRecipients } from '../db/schema.js';
import { asyncHandler, notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';

export const emailRecipientsRouter = Router();

const templateEnum = z.enum(['standings', 'reminder', 'late-penalty', 'training-flag']);

emailRecipientsRouter.get(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    const rows = await db.select().from(emailRecipients).where(eq(emailRecipients.leagueId, league.id));
    res.json({ emailRecipients: rows });
  }),
);

const createSchema = z.object({
  label: z.string().min(1),
  email: z.string().email(),
  dealershipId: z.number().int().positive().nullable().optional(),
  templates: z.array(templateEnum).min(1),
});

emailRecipientsRouter.post(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const league = await currentLeague();
    const [row] = await db
      .insert(emailRecipients)
      .values({
        leagueId: league.id,
        dealershipId: body.dealershipId ?? null,
        label: body.label,
        email: body.email,
        templates: body.templates,
        createdBy: req.actor!.employeeId,
      })
      .returning();
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: league.id,
      action: 'email_recipient.create',
      entityType: 'email_recipient',
      entityId: row!.id,
      after: row,
    });
    res.status(201).json({ emailRecipient: row });
  }),
);

const updateSchema = z.object({
  label: z.string().min(1).optional(),
  email: z.string().email().optional(),
  dealershipId: z.number().int().positive().nullable().optional(),
  templates: z.array(templateEnum).min(1).optional(),
});

emailRecipientsRouter.patch(
  '/:id',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(emailRecipients).where(eq(emailRecipients.id, id)).limit(1);
    if (!before) throw notFound('Email recipient not found');
    const body = updateSchema.parse(req.body);
    const [after] = await db.update(emailRecipients).set(body).where(eq(emailRecipients.id, id)).returning();
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: before.leagueId,
      action: 'email_recipient.update',
      entityType: 'email_recipient',
      entityId: id,
      before,
      after,
    });
    res.json({ emailRecipient: after });
  }),
);

emailRecipientsRouter.post(
  '/:id/revoke',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(emailRecipients).where(eq(emailRecipients.id, id)).limit(1);
    if (!before) throw notFound('Email recipient not found');
    await db.update(emailRecipients).set({ revokedAt: new Date() }).where(eq(emailRecipients.id, id));
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: before.leagueId,
      action: 'email_recipient.revoke',
      entityType: 'email_recipient',
      entityId: id,
    });
    res.json({ ok: true });
  }),
);

import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { db } from '../db/client.js';
import { leagues } from '../db/schema.js';
import { asyncHandler, badRequest } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';

export const leaguesRouter = Router();

leaguesRouter.get(
  '/current',
  requireAuth(),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    res.json({ league });
  }),
);

const cutoffTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Cutoff must be HH:mm or HH:mm:ss');

const updateSchema = z.object({
  timezone: z.string().min(1),
  submissionDays: z.array(z.number().int().min(1).max(7)).min(1),
  submissionCutoffTime: cutoffTime,
  latePenaltyValue: z.number().nonnegative(),
  latePenaltyStacks: z.boolean(),
  trainingPenaltyValue: z.number().nonnegative(),
  eligibilityNewHireGraceDays: z.number().int().nonnegative(),
  eligibilityMinAdvisorsForManager: z.number().int().nonnegative(),
  eligibilityFloaterRuleEnabled: z.boolean(),
  attainmentCap: z.number().positive().nullable(),
});

leaguesRouter.put(
  '/current',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = updateSchema.parse(req.body);
    if (!DateTime.now().setZone(body.timezone).isValid) throw badRequest('Unknown timezone. Use an IANA name such as America/Los_Angeles.');

    const days = [...new Set(body.submissionDays)].sort((a, b) => a - b);
    const cutoff = body.submissionCutoffTime.length === 5 ? `${body.submissionCutoffTime}:00` : body.submissionCutoffTime;
    const league = await currentLeague();

    const [after] = await db
      .update(leagues)
      .set({
        timezone: body.timezone,
        submissionDays: days,
        submissionCutoffTime: cutoff,
        latePenaltyValue: String(body.latePenaltyValue),
        latePenaltyStacks: body.latePenaltyStacks,
        trainingPenaltyValue: String(body.trainingPenaltyValue),
        eligibilityNewHireGraceDays: body.eligibilityNewHireGraceDays,
        eligibilityMinAdvisorsForManager: body.eligibilityMinAdvisorsForManager,
        eligibilityFloaterRuleEnabled: body.eligibilityFloaterRuleEnabled,
        attainmentCap: body.attainmentCap == null ? null : String(body.attainmentCap),
      })
      .where(eq(leagues.id, league.id))
      .returning();

    await writeAudit({
      actor: req.actor ?? null,
      leagueId: league.id,
      action: 'league.update',
      entityType: 'league',
      entityId: league.id,
      before: league,
      after,
    });
    res.json({ league: after });
  }),
);

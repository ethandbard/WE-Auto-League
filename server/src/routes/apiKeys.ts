// Scoped API keys — Phase 7's REST integration seam. A key is either
// league-wide (dealershipId null, what an internal script/commissioner tool
// uses) or scoped to one store (what MetricSource.submit expects a DMS
// adapter or RPA job to hold).
import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { asyncHandler, notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';

export const apiKeysRouter = Router();

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

apiKeysRouter.get(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    const rows = await db.select().from(apiKeys).where(eq(apiKeys.leagueId, league.id));
    // Never return keyHash.
    res.json({ apiKeys: rows.map(({ keyHash, ...rest }) => rest) });
  }),
);

const createSchema = z.object({
  name: z.string().min(1),
  dealershipId: z.number().int().positive().nullable().optional(),
  scopes: z.array(z.enum(['submit', 'read'])).min(1),
});

apiKeysRouter.post(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const league = await currentLeague();
    const rawKey = `wal_live_${randomBytes(24).toString('base64url')}`;
    const [row] = await db
      .insert(apiKeys)
      .values({
        leagueId: league.id,
        dealershipId: body.dealershipId ?? null,
        name: body.name,
        keyHash: hashApiKey(rawKey),
        scopes: body.scopes,
        createdBy: req.actor!.employeeId,
      })
      .returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'api_key.create', entityType: 'api_key', entityId: row!.id, after: { name: body.name, scopes: body.scopes } });
    // The only time the raw key is ever returned — the caller must save it now.
    const { keyHash, ...rest } = row!;
    res.status(201).json({ apiKey: rest, key: rawKey });
  }),
);

apiKeysRouter.post(
  '/:id/revoke',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!before) throw notFound('API key not found');
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'api_key.revoke', entityType: 'api_key', entityId: id });
    res.json({ ok: true });
  }),
);

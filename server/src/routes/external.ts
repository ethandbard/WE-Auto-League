// The scoped-key REST surface: MetricSource.submit(period, store, rows[]) as
// HTTP, for an internal script, an RPA job, or a DmsAdapter once one exists.
// Shares recordSubmission with the web grid and the CSV importer — same
// validator, same audit log, differing only in provenance.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiKeys } from '../db/schema.js';
import { asyncHandler, badRequest, unauthorized, forbidden } from '../http.js';
import { hashApiKey } from './apiKeys.js';
import { recordSubmission } from './submissions.js';
import { currentScoresFor } from '../scoring/compute.js';
import { writeAudit } from '../audit.js';

export const externalRouter = Router();

interface ApiKeyContext {
  id: number;
  leagueId: number;
  dealershipId: number | null;
  scopes: string[];
  /** No session employee exists for an API-provenance write, so it attributes to the key's creator. */
  createdBy: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyCtx?: ApiKeyContext;
    }
  }
}

function requireApiKey(scope: 'submit' | 'read') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.header('Authorization') ?? '';
    const raw = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
    if (!raw) return next(unauthorized('Missing API key'));
    const [row] = await db.select().from(apiKeys).where(and(eq(apiKeys.keyHash, hashApiKey(raw)), isNull(apiKeys.revokedAt))).limit(1);
    if (!row) return next(unauthorized('Invalid or revoked API key'));
    const scopes = row.scopes as string[];
    if (!scopes.includes(scope)) return next(forbidden(`This key does not have "${scope}" scope`));
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));
    req.apiKeyCtx = { id: row.id, leagueId: row.leagueId, dealershipId: row.dealershipId, scopes, createdBy: row.createdBy };
    next();
  };
}

const submitSchema = z.object({
  dealershipId: z.number().int().positive(),
  periodId: z.number().int().positive(),
  advisorValues: z.array(z.object({ employeeId: z.number().int().positive(), values: z.record(z.string(), z.number()) })).default([]),
  managerValues: z.record(z.string(), z.number()).default({}),
});

externalRouter.post(
  '/submit',
  asyncHandler(requireApiKey('submit')),
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const ctx = req.apiKeyCtx!;
    if (ctx.dealershipId != null && ctx.dealershipId !== body.dealershipId) {
      throw badRequest('This key is scoped to a different store.');
    }
    // audit_log's actor is left null (no session employee for an API-provenance write); the api_key id
    // in the audit "after" payload is what makes the write traceable back to the key.
    const result = await recordSubmission(body, { submittedBy: ctx.createdBy, provenance: 'api' });
    await writeAudit({ actor: null, leagueId: ctx.leagueId, action: 'submission.create', entityType: 'submission', entityId: result.submission!.id, after: { apiKeyId: ctx.id }, provenance: 'api' });
    res.status(201).json(result);
  }),
);

const standingsQuerySchema = z.object({
  periodId: z.coerce.number().int().positive(),
  scope: z.enum(['advisor', 'manager', 'team']).optional(),
});

externalRouter.get(
  '/standings',
  asyncHandler(requireApiKey('read')),
  asyncHandler(async (req, res) => {
    const query = standingsQuerySchema.parse(req.query);
    const ctx = req.apiKeyCtx!;
    const rows = await currentScoresFor(query.periodId, query.scope);
    // A store-scoped key reads its own store only. Every score row — advisor,
    // team, and manager — carries the dealership it belongs to.
    const scoped = ctx.dealershipId == null ? rows : rows.filter((row) => row.dealershipId === ctx.dealershipId);
    res.json({ scores: scoped });
  }),
);

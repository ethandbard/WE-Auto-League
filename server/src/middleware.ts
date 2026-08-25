import type { NextFunction, Request, Response } from 'express';
import { resolveActor, type Actor } from './auth.js';
import { forbidden, unauthorized } from './http.js';
import { db } from './db/client.js';
import { delegates } from './db/schema.js';
import { and, eq, isNull } from 'drizzle-orm';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
    }
  }
}

/** Attaches `req.actor` when a session/header resolves one. Never throws — routes decide what's required. */
export function attachActor() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.actor = (await resolveActor(req)) ?? undefined;
    } catch (err) {
      console.error('[auth] failed to resolve actor', err);
    }
    next();
  };
}

export function requireAuth() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(unauthorized('Sign in required'));
    next();
  };
}

export function requireRole(...roles: Array<Actor['role']>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(unauthorized('Sign in required'));
    if (!roles.includes(req.actor.role)) return next(forbidden(`Requires role: ${roles.join(', ')}`));
    next();
  };
}

/**
 * Commissioners may write for any store. A manager or delegate may write only
 * for their own store — decision #7. Every write is attributed regardless of
 * who made it; this only decides who is *allowed* to.
 */
export async function canWriteForDealership(actor: Actor, dealershipId: number): Promise<boolean> {
  if (actor.role === 'commissioner') return true;
  if (actor.dealershipId === dealershipId) return true;
  const [delegate] = await db
    .select()
    .from(delegates)
    .where(and(eq(delegates.employeeId, actor.employeeId), eq(delegates.dealershipId, dealershipId), isNull(delegates.revokedAt)))
    .limit(1);
  return Boolean(delegate);
}

/** Express middleware form, reading the dealership id from `req.params[key]` (default) or `req.body[key]`. */
export function requireStoreWrite(key = 'dealershipId', source: 'params' | 'body' = 'params') {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.actor) return next(unauthorized('Sign in required'));
    const dealershipId = Number(source === 'body' ? req.body?.[key] : req.params[key]);
    if (!Number.isFinite(dealershipId)) return next(forbidden('Missing dealership id'));
    const allowed = await canWriteForDealership(req.actor, dealershipId);
    if (!allowed) return next(forbidden('Not authorised to write for this store'));
    next();
  };
}

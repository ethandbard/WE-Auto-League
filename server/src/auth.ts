// Auth sits behind this interface so the prototype's app-native magic-link
// sessions can be swapped for a trusted Cloudflare Access identity header in
// an enterprise deployment without touching route code — see CLAUDE.md.
import type { Request } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { db } from './db/client.js';
import { employees, sessions, magicLinks } from './db/schema.js';
import { env } from './env.js';

export interface Actor {
  employeeId: number;
  leagueId: number;
  dealershipId: number | null;
  email: string;
  name: string;
  role: 'advisor' | 'manager' | 'commissioner';
}

const hashToken = (token: string) => createHash('sha256').update(token).update(env.authSecret).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export const SESSION_COOKIE = 'wal_session';

/** node's `req.cookies` is only populated with cookie-parser middleware, which this app doesn't add — parse by hand. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function actorForEmployeeId(employeeId: number): Promise<Actor | null> {
  const [row] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!row || row.archivedAt) return null;
  return {
    employeeId: row.id,
    leagueId: row.leagueId,
    dealershipId: row.dealershipId,
    email: row.email,
    name: row.alias ?? row.name,
    role: row.role,
  };
}

/** Issues a magic link token for an employee's email. Does not check the email exists — callers should, to avoid leaking which emails are registered. */
export async function issueMagicLink(employeeId: number): Promise<{ token: string; url: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  await db.insert(magicLinks).values({ employeeId, tokenHash: hashToken(token), expiresAt });
  return { token, url: `${env.appBaseUrl}/auth/verify?token=${token}`, expiresAt };
}

/** Consumes a magic-link token exactly once and mints a session. Throws nothing — a bad/expired/reused token just returns null. */
export async function consumeMagicLink(token: string): Promise<{ sessionToken: string; actor: Actor } | null> {
  const tokenHash = hashToken(token);
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(and(eq(magicLinks.tokenHash, tokenHash), isNull(magicLinks.consumedAt), gt(magicLinks.expiresAt, new Date())))
    .limit(1);
  if (!link) return null;

  await db.update(magicLinks).set({ consumedAt: new Date() }).where(eq(magicLinks.id, link.id));

  const sessionToken = newToken();
  const expiresAt = new Date(Date.now() + env.authSessionDays * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ employeeId: link.employeeId, tokenHash: hashToken(sessionToken), expiresAt });

  const actor = await actorForEmployeeId(link.employeeId);
  if (!actor) return null;
  return { sessionToken, actor };
}

export async function revokeSession(sessionToken: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(sessionToken)));
}

async function resolveViaSession(req: Request): Promise<Actor | null> {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const [row] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  return actorForEmployeeId(row.employeeId);
}

/**
 * Cloudflare Access terminates in front of the app and injects this header
 * after its own auth — nothing here re-verifies it, which is the point: swap
 * the deployment's front door, not this function's caller.
 */
async function resolveViaCloudflareAccess(req: Request): Promise<Actor | null> {
  const email = req.header('Cf-Access-Authenticated-User-Email');
  if (!email) return null;
  const [row] = await db.select().from(employees).where(eq(employees.email, email)).limit(1);
  if (!row || row.archivedAt) return null;
  return actorForEmployeeId(row.id);
}

/** AUTH_PROVIDER=cloudflare-access for an enterprise deployment; session (magic link) otherwise. */
export async function resolveActor(req: Request): Promise<Actor | null> {
  if ((process.env.AUTH_PROVIDER ?? 'session') === 'cloudflare-access') {
    return resolveViaCloudflareAccess(req);
  }
  return resolveViaSession(req);
}

// Magic-link auth is the whole login surface in `session` mode: issue, consume
// exactly once, expire, and mint a session that resolveActor honours. Every
// step is a database round trip against hashed tokens, so none of it is
// reachable from the pure suite.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { SESSION_COOKIE, consumeMagicLink, issueMagicLink, resolveActor, revokeSession } from '../../src/auth.js';
import { db } from '../../src/db/client.js';
import { magicLinks } from '../../src/db/schema.js';
import { env } from '../../src/env.js';
import { closeDatabase, resetDatabase, seedDealership, seedEmployee, seedLeague } from './harness.js';

/** Mirrors `auth.ts`'s private hashToken, so a row can be planted with a token we know. */
const hashToken = (token: string) => createHash('sha256').update(token).update(env.authSecret).digest('hex');

/** The narrowest Request `resolveActor` actually reads: a cookie header, plus `header()` for the Access branch. */
function fakeRequest(cookie?: string): Request {
  const headers: Record<string, string> = cookie ? { cookie } : {};
  return {
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

let employeeId: number;
let employeeEmail: string;

before(async () => {
  assert.equal(env.authProvider, 'session', 'this suite exercises the magic-link provider; set AUTH_PROVIDER=session');
  await resetDatabase();
  const league = await seedLeague();
  const dealership = await seedDealership(league.id, 'Toyota PA');
  const employee = await seedEmployee(league.id, { name: 'Marge Manager', role: 'manager', dealershipId: dealership.id });
  employeeId = employee.id;
  employeeEmail = employee.email;
});

after(closeDatabase);

test('a magic link consumes exactly once and is dead on reuse', async () => {
  const link = await issueMagicLink(employeeId);
  assert.match(link.url, /\/auth\/verify\?token=/);
  assert.ok(link.expiresAt.getTime() > Date.now(), 'a fresh link is not already expired');

  const first = await consumeMagicLink(link.token);
  assert.ok(first, 'the first consume succeeds');
  assert.equal(first.actor.employeeId, employeeId);
  assert.equal(first.actor.email, employeeEmail);
  assert.equal(first.actor.role, 'manager');

  const second = await consumeMagicLink(link.token);
  assert.equal(second, null, 'a replayed token is refused');
});

test('the raw token is never stored — only its hash', async () => {
  const link = await issueMagicLink(employeeId);
  const rows = await db.select().from(magicLinks).where(eq(magicLinks.tokenHash, hashToken(link.token)));
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]!.tokenHash, link.token);
});

test('an expired link is refused', async () => {
  const token = 'expired-token-fixture';
  await db.insert(magicLinks).values({
    employeeId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() - 60 * 1000),
  });
  assert.equal(await consumeMagicLink(token), null);
});

test('an unknown token is refused', async () => {
  assert.equal(await consumeMagicLink('never-issued'), null);
});

test('consuming mints a session that resolveActor honours, and revoking kills it', async () => {
  const link = await issueMagicLink(employeeId);
  const consumed = await consumeMagicLink(link.token);
  assert.ok(consumed);

  const actor = await resolveActor(fakeRequest(`${SESSION_COOKIE}=${consumed.sessionToken}`));
  assert.ok(actor, 'the session cookie resolves an actor');
  assert.equal(actor.employeeId, employeeId);
  assert.equal(actor.role, 'manager');

  // Other cookies on the header must not confuse the parser.
  const withNoise = await resolveActor(fakeRequest(`other=1; ${SESSION_COOKIE}=${consumed.sessionToken}; another=2`));
  assert.equal(withNoise?.employeeId, employeeId);

  await revokeSession(consumed.sessionToken);
  assert.equal(await resolveActor(fakeRequest(`${SESSION_COOKIE}=${consumed.sessionToken}`)), null);
});

test('no cookie and a garbage cookie both resolve to no actor', async () => {
  assert.equal(await resolveActor(fakeRequest()), null);
  assert.equal(await resolveActor(fakeRequest(`${SESSION_COOKIE}=not-a-real-session`)), null);
});

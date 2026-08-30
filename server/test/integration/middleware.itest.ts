// canWriteForDealership is the whole of write authorisation (decision #7):
// commissioner anywhere, manager and named delegates only at their own store.
// It reads the delegates table, so it can only be tested against a database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import type { Actor } from '../../src/auth.js';
import { db } from '../../src/db/client.js';
import { delegates } from '../../src/db/schema.js';
import { canWriteForDealership } from '../../src/middleware.js';
import { closeDatabase, resetDatabase, seedDealership, seedEmployee, seedLeague } from './harness.js';

function actorFor(row: { id: number; leagueId: number; dealershipId: number | null; email: string; name: string; role: Actor['role'] }): Actor {
  return { employeeId: row.id, leagueId: row.leagueId, dealershipId: row.dealershipId, email: row.email, name: row.name, role: row.role };
}

let storeA: number;
let storeB: number;
let commissioner: Actor;
let managerA: Actor;
let delegateForA: Actor;
let delegateRowId: number;

before(async () => {
  await resetDatabase();
  const league = await seedLeague();
  storeA = (await seedDealership(league.id, 'Store A')).id;
  storeB = (await seedDealership(league.id, 'Store B')).id;

  commissioner = actorFor(await seedEmployee(league.id, { name: 'Cora Commissioner', role: 'commissioner' }));
  managerA = actorFor(await seedEmployee(league.id, { name: 'Marge Manager', role: 'manager', dealershipId: storeA }));
  // Rostered at store B, granted write access to store A — the case that only
  // the delegates table can answer.
  delegateForA = actorFor(await seedEmployee(league.id, { name: 'Dana Delegate', role: 'advisor', dealershipId: storeB }));

  const [grant] = await db
    .insert(delegates)
    .values({ dealershipId: storeA, employeeId: delegateForA.employeeId, grantedBy: commissioner.employeeId })
    .returning();
  delegateRowId = grant!.id;
});

after(closeDatabase);

test('a commissioner may write for any store', async () => {
  assert.equal(await canWriteForDealership(commissioner, storeA), true);
  assert.equal(await canWriteForDealership(commissioner, storeB), true);
});

test('a manager may write for their own store only', async () => {
  assert.equal(await canWriteForDealership(managerA, storeA), true);
  assert.equal(await canWriteForDealership(managerA, storeB), false);
});

test('a delegate may write for the store they were granted, not their own roster store', async () => {
  assert.equal(await canWriteForDealership(delegateForA, storeA), true);
  // Store B is their roster store, so `actor.dealershipId` alone would allow it
  // — this asserts the grant, not the roster, is what opened store A.
  assert.equal(await canWriteForDealership({ ...delegateForA, dealershipId: null }, storeB), false);
});

test('a revoked delegate is denied', async () => {
  await db.update(delegates).set({ revokedAt: new Date() }).where(eq(delegates.id, delegateRowId));
  try {
    assert.equal(await canWriteForDealership(delegateForA, storeA), false);
  } finally {
    await db.update(delegates).set({ revokedAt: null }).where(eq(delegates.id, delegateRowId));
  }
});

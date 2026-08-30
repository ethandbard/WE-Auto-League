// The commissioner-only correction routes that replaced the SQL surgery in
// docs/data-corrections.md: period unlock, penalty waive, submission delete,
// and the audit-log read. Each one is a route rather than a function, so this
// file mounts the real routers on a throwaway Express app and drives them over
// HTTP — the middleware chain (requireRole) and the error mapping in
// http.ts's errorHandler are half of what is under test.
//
// `attachActor` is replaced by a stub that sets `req.actor` directly: session
// resolution is already covered by auth.itest.ts, and re-testing it here would
// only make these cases slower to read.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { auditLog, metricValues, penalties, periods, submissions } from '../../src/db/schema.js';
import { errorHandler } from '../../src/http.js';
import type { Actor } from '../../src/auth.js';
import { adminRouter } from '../../src/routes/admin.js';
import { penaltiesRouter } from '../../src/routes/penalties.js';
import { periodsRouter } from '../../src/routes/periods.js';
import { submissionsRouter } from '../../src/routes/submissions.js';
import { closeDatabase, resetDatabase, seedCategory, seedDealership, seedEmployee, seedLeague, seedPeriod } from './harness.js';

let actor: Actor;
let server: Server;
let baseUrl: string;

let leagueId: number;
let periodId: number;
let dealershipId: number;
let advisorId: number;
let categoryId: number;

before(async () => {
  await resetDatabase();
  const league = await seedLeague();
  leagueId = league.id;
  periodId = (await seedPeriod(leagueId)).id;
  dealershipId = (await seedDealership(leagueId, 'Toyota PA')).id;
  const commissioner = await seedEmployee(leagueId, { name: 'Cora Commissioner', role: 'commissioner' });
  advisorId = (await seedEmployee(leagueId, { name: 'Adam Advisor', role: 'advisor', dealershipId })).id;
  categoryId = (await seedCategory(leagueId, { key: 'csi100s', scope: 'advisor' })).id;

  actor = {
    employeeId: commissioner.id,
    leagueId,
    dealershipId: null,
    email: commissioner.email,
    name: commissioner.name,
    role: 'commissioner',
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use('/api/periods', periodsRouter);
  app.use('/api/penalties', penaltiesRouter);
  app.use('/api/submissions', submissionsRouter);
  app.use('/api/admin', adminRouter);
  app.use(errorHandler);

  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await closeDatabase();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Files one submission with one metric value, without going through recordSubmission's window math. */
async function seedSubmission() {
  const [row] = await db
    .insert(submissions)
    .values({ dealershipId, periodId, windowDate: '2026-06-04', submittedBy: actor.employeeId, onTime: true })
    .returning();
  await db.insert(metricValues).values({ submissionId: row!.id, employeeId: advisorId, categoryId, value: '12' });
  return row!;
}

// ------------------------------------------------------------------ unlock --

test('unlock reopens a locked period and audits before/after', async () => {
  await db.update(periods).set({ status: 'locked', lockedAt: new Date() }).where(eq(periods.id, periodId));

  const res = await call('POST', `/api/periods/${periodId}/unlock`);
  assert.equal(res.status, 200);

  const [row] = await db.select().from(periods).where(eq(periods.id, periodId));
  assert.equal(row!.status, 'open');
  assert.equal(row!.lockedAt, null);

  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'period.unlock'), eq(auditLog.entityId, periodId)));
  assert.ok(entry, 'the unlock is on the audit trail');
  assert.equal((entry!.before as { status: string }).status, 'locked');
  assert.equal((entry!.after as { status: string }).status, 'open');
});

test('unlock reopens a published period; published scores are untouched by design', async () => {
  await db.update(periods).set({ status: 'published', publishedAt: new Date() }).where(eq(periods.id, periodId));
  const res = await call('POST', `/api/periods/${periodId}/unlock`);
  assert.equal(res.status, 200);

  const [row] = await db.select().from(periods).where(eq(periods.id, periodId));
  assert.equal(row!.status, 'open');
  assert.ok(row!.publishedAt, 'publishedAt stays — the board that went out is still a published fact');
});

test('unlocking an already-open period is a 400', async () => {
  const res = await call('POST', `/api/periods/${periodId}/unlock`);
  assert.equal(res.status, 400);
  assert.match(String(res.body.error), /already open/i);
});

// ------------------------------------------------------------------- waive --

test('waive zeroes any kind, leaves the reason column alone, and records why', async () => {
  const [row] = await db
    .insert(penalties)
    .values({
      periodId,
      dealershipId,
      kind: 'late_submission',
      value: '2',
      reason: 'Missed the noon cutoff for 2026-06-04',
      windowDate: '2026-06-04',
    })
    .returning();

  const res = await call('POST', `/api/penalties/${row!.id}/waive`, { reason: 'DMS outage, store filed by phone' });
  assert.equal(res.status, 200);

  const [after] = await db.select().from(penalties).where(eq(penalties.id, row!.id));
  assert.equal(Number(after!.value), 0);
  assert.equal(after!.reason, 'Missed the noon cutoff for 2026-06-04', 'the reason column is the issue record, not the waiver record');

  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'penalty.waive'), eq(auditLog.entityId, row!.id)));
  assert.equal((entry!.after as { waiveReason: string }).waiveReason, 'DMS outage, store filed by phone');
});

test('waive requires a reason', async () => {
  const [row] = await db
    .insert(penalties)
    .values({ periodId, employeeId: advisorId, kind: 'training_incomplete', value: '25', reason: 'Training criteria incomplete' })
    .returning();
  const res = await call('POST', `/api/penalties/${row!.id}/waive`, {});
  assert.equal(res.status, 400);
  assert.equal(Number((await db.select().from(penalties).where(eq(penalties.id, row!.id)))[0]!.value), 25);
});

test('delete still refuses a non-manual penalty', async () => {
  const [row] = await db
    .insert(penalties)
    .values({ periodId, employeeId: advisorId, kind: 'training_incomplete', value: '25', reason: 'Training criteria incomplete' })
    .returning();
  const res = await call('DELETE', `/api/penalties/${row!.id}`);
  assert.equal(res.status, 400);
});

// --------------------------------------------------------- submission delete --

test('deleting a submission removes its metric values in the same transaction', async () => {
  const row = await seedSubmission();

  const res = await call('DELETE', `/api/submissions/${row.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.deletedValueCount, 1);

  assert.equal((await db.select().from(submissions).where(eq(submissions.id, row.id))).length, 0);
  assert.equal((await db.select().from(metricValues).where(eq(metricValues.submissionId, row.id))).length, 0);

  const [entry] = await db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'submission.delete'), eq(auditLog.entityId, row.id)));
  const before = entry!.before as { metricValues: unknown[] };
  assert.equal(before.metricValues.length, 1, 'the audit row carries the full before payload');
});

test('deleting a submission that is not there is a 404', async () => {
  const res = await call('DELETE', '/api/submissions/999999');
  assert.equal(res.status, 404);
});

// --------------------------------------------------------------- audit read --

test('the audit log reads newest first, paginated, and filters', async () => {
  const all = await call('GET', '/api/admin/audit-log?pageSize=5');
  assert.equal(all.status, 200);
  const rows = all.body.auditLog as Array<{ action: string; createdAt: string }>;
  assert.ok(rows.length > 0 && rows.length <= 5);
  const times = rows.map((r) => new Date(r.createdAt).getTime());
  assert.deepEqual(times, [...times].sort((a, b) => b - a), 'newest first');

  const filtered = await call('GET', '/api/admin/audit-log?entityType=penalty&action=penalty.waive');
  const waives = filtered.body.auditLog as Array<{ action: string; entityType: string }>;
  assert.ok(waives.length > 0);
  assert.ok(waives.every((r) => r.action === 'penalty.waive' && r.entityType === 'penalty'));

  const pagination = filtered.body.pagination as { total: number };
  assert.equal(pagination.total, waives.length);
});

test('a non-commissioner cannot read the audit log', async () => {
  const commissioner = actor;
  actor = { ...actor, role: 'manager' };
  try {
    const res = await call('GET', '/api/admin/audit-log');
    assert.equal(res.status, 403);
  } finally {
    actor = commissioner;
  }
});

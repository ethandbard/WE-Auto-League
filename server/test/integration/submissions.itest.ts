// recordSubmission() is the single write path every ingestion route shares
// (web grid, CSV, XLSX, scoped REST, MCP), so it is the one function where a
// bad filing can corrupt scores from four directions at once.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { auditLog, employees, metricValues, periods, submissions } from '../../src/db/schema.js';
import { HttpError } from '../../src/http.js';
import { recordSubmission } from '../../src/routes/submissions.js';
import { closeDatabase, resetDatabase, seedCategory, seedDealership, seedEmployee, seedLeague, seedPeriod } from './harness.js';

let leagueId: number;
let periodId: number;
let dealershipId: number;
let managerId: number;
let advisorId: number;
let floaterId: number;
let otherStoreAdvisorId: number;

before(async () => {
  await resetDatabase();
  const league = await seedLeague();
  leagueId = league.id;
  const period = await seedPeriod(leagueId);
  periodId = period.id;
  const dealership = await seedDealership(leagueId, 'Toyota PA');
  dealershipId = dealership.id;
  const manager = await seedEmployee(leagueId, { name: 'Marge Manager', role: 'manager', dealershipId });
  managerId = manager.id;
  const advisor = await seedEmployee(leagueId, { name: 'Adam Advisor', role: 'advisor', dealershipId });
  advisorId = advisor.id;
  floaterId = (await seedEmployee(leagueId, { name: 'Fran Floater', role: 'advisor' })).id;
  const otherStore = await seedDealership(leagueId, 'Honda North');
  otherStoreAdvisorId = (await seedEmployee(leagueId, { name: 'Otto Other', role: 'advisor', dealershipId: otherStore.id })).id;
  await seedCategory(leagueId, { key: 'csi100s', scope: 'advisor' });
  await seedCategory(leagueId, { key: 'csiGoal', scope: 'manager', unit: 'percent' });
  await seedCategory(leagueId, { key: 'teamScore', scope: 'manager', unit: 'percent', isDerived: true });
});

after(closeDatabase);

test('a valid filing inserts the submission and both scopes of metric values', async () => {
  const result = await recordSubmission(
    {
      dealershipId,
      periodId,
      advisorValues: [{ employeeId: advisorId, values: { csi100s: 12 } }],
      managerValues: { csiGoal: 103.5 },
    },
    { submittedBy: managerId, provenance: 'web' },
  );

  assert.equal(result.valueCount, 2);
  assert.equal(result.submission!.dealershipId, dealershipId);
  assert.equal(result.submission!.provenance, 'web');
  assert.equal(result.submission!.isFinal, false);

  const rows = await db.select().from(metricValues).where(eq(metricValues.submissionId, result.submission!.id));
  assert.equal(rows.length, 2);

  const advisorRow = rows.find((r) => r.employeeId === advisorId);
  assert.ok(advisorRow, 'expected an advisor-scoped metric value');
  assert.equal(Number(advisorRow.value), 12);

  // A store-level row for the manager board carries a null employeeId.
  const managerRow = rows.find((r) => r.employeeId === null);
  assert.ok(managerRow, 'expected a store-level metric value');
  assert.equal(Number(managerRow.value), 103.5);
});

test('a derived category cannot be filed directly', async () => {
  await assert.rejects(
    () => recordSubmission({ dealershipId, periodId, advisorValues: [], managerValues: { teamScore: 90 } }, { submittedBy: managerId, provenance: 'web' }),
    (err: unknown) => err instanceof HttpError && err.status === 400 && /derived/i.test(err.message),
  );
});

test('a locked period rejects further submissions', async () => {
  await db.update(periods).set({ status: 'locked' }).where(eq(periods.id, periodId));
  try {
    await assert.rejects(
      () => recordSubmission({ dealershipId, periodId, advisorValues: [], managerValues: { csiGoal: 99 } }, { submittedBy: managerId, provenance: 'web' }),
      (err: unknown) => err instanceof HttpError && err.status === 400 && /locked/.test(err.message),
    );
  } finally {
    await db.update(periods).set({ status: 'open' }).where(eq(periods.id, periodId));
  }
});

test('a published period rejects further submissions', async () => {
  await db.update(periods).set({ status: 'published' }).where(eq(periods.id, periodId));
  try {
    await assert.rejects(
      () => recordSubmission({ dealershipId, periodId, advisorValues: [], managerValues: { csiGoal: 99 } }, { submittedBy: managerId, provenance: 'web' }),
      (err: unknown) => err instanceof HttpError && err.status === 400 && /published/.test(err.message),
    );
  } finally {
    await db.update(periods).set({ status: 'open' }).where(eq(periods.id, periodId));
  }
});

// A rejected filing must leave nothing behind. A bare submission row with no
// metric values reads as "this store filed", which silently exempts the store
// from the missed-window late penalty.
test('an unknown category key writes no submission row at all', async () => {
  const before = await db.select().from(submissions).where(eq(submissions.periodId, periodId));

  await assert.rejects(
    () =>
      recordSubmission(
        { dealershipId, periodId, advisorValues: [{ employeeId: advisorId, values: { notACategory: 5 } }], managerValues: {} },
        { submittedBy: managerId, provenance: 'web' },
      ),
    (err: unknown) => err instanceof HttpError && err.status === 400 && /Unknown advisor category/.test(err.message),
  );

  const afterRows = await db.select().from(submissions).where(eq(submissions.periodId, periodId));
  assert.equal(afterRows.length, before.length, 'a rejected filing leaves no submission row');
});

test('an advisor from another store is rejected by id, and writes nothing', async () => {
  const before = await db.select().from(submissions).where(eq(submissions.periodId, periodId));

  await assert.rejects(
    () =>
      recordSubmission(
        { dealershipId, periodId, advisorValues: [{ employeeId: otherStoreAdvisorId, values: { csi100s: 7 } }], managerValues: {} },
        { submittedBy: managerId, provenance: 'web' },
      ),
    (err: unknown) =>
      err instanceof HttpError && err.status === 400 && err.message.includes(String(otherStoreAdvisorId)),
  );

  const afterRows = await db.select().from(submissions).where(eq(submissions.periodId, periodId));
  assert.equal(afterRows.length, before.length);
});

// An unassigned advisor writes service wherever they are needed, so any store
// may file numbers for them — storeOrFloaterCondition, the same roster the
// entry grid renders.
test('an unassigned floater advisor is accepted', async () => {
  const result = await recordSubmission(
    { dealershipId, periodId, advisorValues: [{ employeeId: floaterId, values: { csi100s: 4 } }], managerValues: {} },
    { submittedBy: managerId, provenance: 'web' },
  );
  assert.equal(result.valueCount, 1);

  const rows = await db.select().from(metricValues).where(eq(metricValues.submissionId, result.submission!.id));
  assert.equal(rows[0]!.employeeId, floaterId);
});

test('an archived advisor is off the roster and rejected', async () => {
  await db.update(employees).set({ archivedAt: new Date() }).where(eq(employees.id, advisorId));
  try {
    await assert.rejects(
      () =>
        recordSubmission(
          { dealershipId, periodId, advisorValues: [{ employeeId: advisorId, values: { csi100s: 3 } }], managerValues: {} },
          { submittedBy: managerId, provenance: 'web' },
        ),
      (err: unknown) => err instanceof HttpError && err.status === 400 && /roster/.test(err.message),
    );
  } finally {
    await db.update(employees).set({ archivedAt: null }).where(eq(employees.id, advisorId));
  }
});

// meta.audit rides the same transaction as the write, so the trail cannot
// record a filing that rolled back.
test('the audit row is written with the submission and rolled back with it', async () => {
  const result = await recordSubmission(
    { dealershipId, periodId, advisorValues: [], managerValues: { csiGoal: 88 } },
    {
      submittedBy: managerId,
      provenance: 'web',
      audit: { actor: null, leagueId, action: 'submission.create', after: { note: 'audited' } },
    },
  );
  const written = await db.select().from(auditLog).where(eq(auditLog.entityId, result.submission!.id));
  assert.equal(written.length, 1);
  assert.equal(written[0]!.action, 'submission.create');

  const countBefore = (await db.select().from(auditLog)).length;
  await assert.rejects(() =>
    recordSubmission(
      { dealershipId, periodId, advisorValues: [], managerValues: { notACategory: 1 } },
      {
        submittedBy: managerId,
        provenance: 'web',
        audit: { actor: null, leagueId, action: 'submission.create' },
      },
    ),
  );
  assert.equal((await db.select().from(auditLog)).length, countBefore, 'a rejected filing writes no audit row either');
});

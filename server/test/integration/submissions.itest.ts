// recordSubmission() is the single write path every ingestion route shares
// (web grid, CSV, XLSX, scoped REST, MCP), so it is the one function where a
// bad filing can corrupt scores from four directions at once.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import { metricValues, periods, submissions } from '../../src/db/schema.js';
import { HttpError } from '../../src/http.js';
import { recordSubmission } from '../../src/routes/submissions.js';
import { closeDatabase, resetDatabase, seedCategory, seedDealership, seedEmployee, seedLeague, seedPeriod } from './harness.js';

let leagueId: number;
let periodId: number;
let dealershipId: number;
let managerId: number;
let advisorId: number;

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

test('CURRENT BEHAVIOUR: an unknown category key leaves an orphan submission row', async () => {
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

  // PHASE 3 WILL CHANGE THIS. recordSubmission inserts the submission row
  // before it validates any category key, and is not wrapped in a
  // transaction — so a rejected filing still leaves a row behind. That row
  // reads as "this store filed", which silently exempts it from the
  // missed-window late penalty (hardening-plan.md phase 3, first bullet).
  //
  // When phase 3 makes recordSubmission transactional, these two assertions
  // flip: the count stays equal and there is no orphan. That failure is the
  // point — it is the signal that the bug is fixed, and this test should then
  // be rewritten to assert no row was written.
  assert.equal(afterRows.length, before.length + 1, 'orphan submission row is still written today');

  const orphan = afterRows.find((row) => !before.some((b) => b.id === row.id))!;
  const orphanValues = await db.select().from(metricValues).where(eq(metricValues.submissionId, orphan.id));
  assert.equal(orphanValues.length, 0, 'the orphan carries no metric values — it is a bare "they filed" marker');
});

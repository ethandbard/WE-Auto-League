import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { submissions, metricValues, categories, employees, periods, dealerships, leagues, participation } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireAuth, requireRole, requireStoreWrite } from '../middleware.js';
import { writeAudit } from '../audit.js';
import { currentWindow } from '../scheduling/windows.js';
import { storeOrFloaterCondition } from '../roster.js';
import { idParam } from '../validation.js';
import type { Actor } from '../auth.js';

export const submissionsRouter = Router();

async function loadContext(dealershipId: number, periodId: number) {
  const [dealership] = await db.select().from(dealerships).where(eq(dealerships.id, dealershipId)).limit(1);
  if (!dealership) throw notFound('Dealership not found');
  const [period] = await db.select().from(periods).where(eq(periods.id, periodId)).limit(1);
  if (!period) throw notFound('Period not found');
  const [league] = await db.select().from(leagues).where(eq(leagues.id, dealership.leagueId)).limit(1);
  if (!league) throw notFound('League not found');
  return { dealership, period, league };
}

submissionsRouter.get(
  '/current',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const dealershipId = Number(req.query.dealershipId);
    const periodId = Number(req.query.periodId);
    if (!Number.isFinite(dealershipId) || !Number.isFinite(periodId)) throw badRequest('dealershipId and periodId are required');
    const { league, period } = await loadContext(dealershipId, periodId);

    const window = currentWindow(new Date(), league);

    const roster = await db
      .select()
      .from(employees)
      .where(and(eq(employees.role, 'advisor'), storeOrFloaterCondition(dealershipId)));
    const participationRows = await db.select().from(participation).where(eq(participation.periodId, periodId));
    const statusByEmployee = new Map(participationRows.map((p) => [p.employeeId, p.status]));

    const allCategories = await db.select().from(categories).where(eq(categories.leagueId, league.id));
    const advisorCategories = allCategories.filter((c) => c.scope === 'advisor');
    const managerCategories = allCategories.filter((c) => c.scope === 'manager' && !c.isDerived);
    const categoryById = new Map(allCategories.map((c) => [c.id, c]));

    const [latest] = await db
      .select()
      .from(submissions)
      .where(and(eq(submissions.dealershipId, dealershipId), eq(submissions.periodId, periodId)))
      .orderBy(desc(submissions.submittedAt))
      .limit(1);

    let advisorValues: Record<number, Record<string, number>> = {};
    let managerValues: Record<string, number> = {};
    if (latest) {
      const rows = await db.select().from(metricValues).where(eq(metricValues.submissionId, latest.id));
      for (const row of rows) {
        const cat = categoryById.get(row.categoryId);
        if (!cat) continue;
        if (row.employeeId == null) {
          managerValues[cat.key] = Number(row.value);
        } else {
          advisorValues[row.employeeId] ??= {};
          advisorValues[row.employeeId]![cat.key] = Number(row.value);
        }
      }
    }

    res.json({
      period,
      window,
      roster: roster.map((r) => ({ id: r.id, name: r.name, alias: r.alias, status: statusByEmployee.get(r.id) ?? 'eligible' })),
      advisorCategories,
      managerCategories,
      advisorValues,
      managerValues,
      lastSubmission: latest ? { submittedAt: latest.submittedAt, submittedBy: latest.submittedBy, onTime: latest.onTime, isFinal: latest.isFinal } : null,
    });
  }),
);

const submitSchema = z.object({
  dealershipId: z.number().int().positive(),
  periodId: z.number().int().positive(),
  advisorValues: z.array(z.object({ employeeId: z.number().int().positive(), values: z.record(z.string(), z.number()) })).default([]),
  managerValues: z.record(z.string(), z.number()).default({}),
});

/** One metric value, resolved against the roster and the category list but not yet tied to a submission row. */
type PendingValue = { employeeId: number | null; categoryId: number; value: string };

/**
 * The single write path every ingestion route shares (web grid, CSV, XLSX,
 * scoped REST, MCP).
 *
 * Everything is validated before the transaction opens, and the submission row
 * and its metric values are written inside one. A rejected filing therefore
 * leaves zero rows: an orphan submission would read as "this store filed" and
 * silently exempt the store from the missed-window late penalty.
 *
 * `meta.audit`, when given, writes the caller's audit row on the same
 * transaction — so a rollback takes it too, the way `ingestion/roster.ts`
 * threads its transaction into `writeAudit`.
 */
export async function recordSubmission(
  body: z.infer<typeof submitSchema>,
  meta: {
    submittedBy: number;
    provenance: 'web' | 'csv' | 'api' | 'mcp';
    audit?: { actor: Actor | null; leagueId: number | null; action: string; after?: unknown };
  },
) {
  const { league, period } = await loadContext(body.dealershipId, body.periodId);
  if (period.status !== 'open') throw badRequest(`Period is ${period.status}; no further submissions are accepted.`);

  const allCategories = await db.select().from(categories).where(eq(categories.leagueId, league.id));
  const categoryByKey = new Map(allCategories.map((c) => [c.key, c]));

  // The same roster the entry grid shows: advisors at this store, plus
  // unassigned floaters. A value filed for anybody else is a wrong-store
  // filing that would score against another team's mean.
  const roster = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.role, 'advisor'), storeOrFloaterCondition(body.dealershipId)));
  const rosterIds = new Set(roster.map((r) => r.id));

  const window = currentWindow(new Date(), league);

  const pending: PendingValue[] = [];
  for (const advisor of body.advisorValues) {
    if (!rosterIds.has(advisor.employeeId)) {
      throw badRequest(`Employee ${advisor.employeeId} is not an advisor on this store's roster.`);
    }
    for (const [key, value] of Object.entries(advisor.values)) {
      const cat = categoryByKey.get(key);
      if (!cat || cat.scope !== 'advisor') throw badRequest(`Unknown advisor category "${key}"`);
      pending.push({ employeeId: advisor.employeeId, categoryId: cat.id, value: String(value) });
    }
  }
  for (const [key, value] of Object.entries(body.managerValues)) {
    const cat = categoryByKey.get(key);
    if (!cat || cat.scope !== 'manager') throw badRequest(`Unknown manager category "${key}"`);
    if (cat.isDerived) throw badRequest(`"${key}" is derived (e.g. Team Score) and cannot be entered directly.`);
    pending.push({ employeeId: null, categoryId: cat.id, value: String(value) });
  }

  const submission = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(submissions)
      .values({
        dealershipId: body.dealershipId,
        periodId: body.periodId,
        windowDate: window.windowDate,
        submittedBy: meta.submittedBy,
        basis: 'mtd',
        isFinal: false,
        onTime: !window.isPastCutoff,
        provenance: meta.provenance,
      })
      .returning();

    if (pending.length) {
      await tx.insert(metricValues).values(pending.map((v) => ({ ...v, submissionId: row!.id })));
    }

    if (meta.audit) {
      await writeAudit(
        {
          actor: meta.audit.actor,
          leagueId: meta.audit.leagueId,
          action: meta.audit.action,
          entityType: 'submission',
          entityId: row!.id,
          after: meta.audit.after,
          provenance: meta.provenance,
        },
        tx,
      );
    }

    return row;
  });

  return { submission, window, valueCount: pending.length };
}

submissionsRouter.post(
  '/',
  requireStoreWrite('dealershipId', 'body'),
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const result = await recordSubmission(body, {
      submittedBy: req.actor!.employeeId,
      provenance: 'web',
      audit: { actor: req.actor ?? null, leagueId: null, action: 'submission.create', after: body },
    });
    res.status(201).json(result);
  }),
);

/**
 * Removes a filing and its metric values — the correction for a submission
 * made against the wrong store or period, which the grid cannot fix because it
 * only supersedes. Commissioner-only, and one transaction so a half-deleted
 * filing cannot exist.
 *
 * Deleting a store's only filing before a past cutoff lets the scheduler issue
 * that window's late penalty on its next tick. That is usually right; waive it
 * (`POST /api/penalties/:id/waive`) when it is not.
 */
submissionsRouter.delete(
  '/:id',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const [submission] = await db.select().from(submissions).where(eq(submissions.id, id)).limit(1);
    if (!submission) throw notFound('Submission not found');
    const values = await db.select().from(metricValues).where(eq(metricValues.submissionId, id));

    await db.transaction(async (tx) => {
      await tx.delete(metricValues).where(eq(metricValues.submissionId, id));
      await tx.delete(submissions).where(eq(submissions.id, id));
      await writeAudit(
        {
          actor: req.actor ?? null,
          leagueId: null,
          action: 'submission.delete',
          entityType: 'submission',
          entityId: id,
          before: { submission, metricValues: values },
          provenance: 'web',
        },
        tx,
      );
    });

    res.json({ ok: true, deletedValueCount: values.length });
  }),
);

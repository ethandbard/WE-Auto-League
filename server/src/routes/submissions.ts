import { Router } from 'express';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { submissions, metricValues, categories, employees, periods, dealerships, leagues, participation } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireAuth, requireStoreWrite } from '../middleware.js';
import { writeAudit } from '../audit.js';
import { currentWindow } from '../scheduling/windows.js';
import { storeOrFloaterCondition } from '../roster.js';

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

export async function recordSubmission(
  body: z.infer<typeof submitSchema>,
  meta: { submittedBy: number; provenance: 'web' | 'csv' | 'api' | 'mcp' },
) {
  const { league, period } = await loadContext(body.dealershipId, body.periodId);
  if (period.status !== 'open') throw badRequest(`Period is ${period.status}; no further submissions are accepted.`);

  const allCategories = await db.select().from(categories).where(eq(categories.leagueId, league.id));
  const categoryByKey = new Map(allCategories.map((c) => [c.key, c]));

  const window = currentWindow(new Date(), league);

  const [submission] = await db
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

  const valueRows: (typeof metricValues.$inferInsert)[] = [];
  for (const advisor of body.advisorValues) {
    for (const [key, value] of Object.entries(advisor.values)) {
      const cat = categoryByKey.get(key);
      if (!cat || cat.scope !== 'advisor') throw badRequest(`Unknown advisor category "${key}"`);
      valueRows.push({ submissionId: submission!.id, employeeId: advisor.employeeId, categoryId: cat.id, value: String(value) });
    }
  }
  for (const [key, value] of Object.entries(body.managerValues)) {
    const cat = categoryByKey.get(key);
    if (!cat || cat.scope !== 'manager') throw badRequest(`Unknown manager category "${key}"`);
    if (cat.isDerived) throw badRequest(`"${key}" is derived (e.g. Team Score) and cannot be entered directly.`);
    valueRows.push({ submissionId: submission!.id, employeeId: null, categoryId: cat.id, value: String(value) });
  }
  if (valueRows.length) await db.insert(metricValues).values(valueRows);

  return { submission, window, valueCount: valueRows.length };
}

submissionsRouter.post(
  '/',
  requireStoreWrite('dealershipId', 'body'),
  asyncHandler(async (req, res) => {
    const body = submitSchema.parse(req.body);
    const result = await recordSubmission(body, { submittedBy: req.actor!.employeeId, provenance: 'web' });
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: null,
      action: 'submission.create',
      entityType: 'submission',
      entityId: result.submission!.id,
      after: { ...body, onTime: result.submission!.onTime },
      provenance: 'web',
    });
    res.status(201).json(result);
  }),
);

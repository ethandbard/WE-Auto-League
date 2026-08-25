import { Router } from 'express';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees, participation, leagues } from '../db/schema.js';
import { asyncHandler, notFound, badRequest } from '../http.js';
import { requireAuth, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';

export const employeesRouter = Router();

employeesRouter.get(
  '/',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const league = await currentLeague();
    const dealershipId = req.query.dealershipId ? Number(req.query.dealershipId) : undefined;
    const includeArchived = req.query.includeArchived === 'true';
    const conditions = [eq(employees.leagueId, league.id)];
    if (dealershipId) conditions.push(eq(employees.dealershipId, dealershipId));
    if (!includeArchived) conditions.push(isNull(employees.archivedAt));
    const rows = await db.select().from(employees).where(and(...conditions));
    res.json({ employees: rows });
  }),
);

const createSchema = z.object({
  dealershipId: z.number().int().positive().nullable().optional(),
  name: z.string().min(1),
  alias: z.string().min(1).optional(),
  email: z.string().email(),
  role: z.enum(['advisor', 'manager', 'commissioner']).default('advisor'),
  hireDate: z.string().optional(),
});

employeesRouter.post(
  '/',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const league = await currentLeague();
    if (req.actor!.role === 'manager' && body.dealershipId !== req.actor!.dealershipId) {
      throw badRequest('Managers can only add employees to their own store.');
    }
    const [row] = await db
      .insert(employees)
      .values({ leagueId: league.id, dealershipId: body.dealershipId ?? null, name: body.name, alias: body.alias, email: body.email, role: body.role, hireDate: body.hireDate })
      .returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: league.id, action: 'employee.create', entityType: 'employee', entityId: row!.id, after: row });
    res.status(201).json({ employee: row });
  }),
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  alias: z.string().min(1).nullable().optional(),
  role: z.enum(['advisor', 'manager', 'commissioner']).optional(),
  dealershipId: z.number().int().positive().nullable().optional(),
});

employeesRouter.patch(
  '/:id',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!before) throw notFound('Employee not found');
    if (req.actor!.role === 'manager' && before.dealershipId !== req.actor!.dealershipId) {
      throw badRequest('Managers can only edit employees at their own store.');
    }
    const body = updateSchema.parse(req.body);
    if (body.dealershipId !== undefined && req.actor!.role !== 'commissioner') {
      throw badRequest('Only a commissioner can transfer an employee to another store.');
    }
    const becomingRostered = before.dealershipId == null && body.dealershipId != null;
    const [after] = await db
      .update(employees)
      .set(becomingRostered ? { ...body, consecutiveFloaterMonths: 0 } : body)
      .where(eq(employees.id, id))
      .returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'employee.update', entityType: 'employee', entityId: id, before, after });
    res.json({ employee: after });
  }),
);

employeesRouter.post(
  '/:id/archive',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!before) throw notFound('Employee not found');
    const [after] = await db.update(employees).set({ archivedAt: new Date() }).where(eq(employees.id, id)).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'employee.archive', entityType: 'employee', entityId: id, before, after });
    res.json({ employee: after });
  }),
);

employeesRouter.post(
  '/:id/restore',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [before] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
    if (!before) throw notFound('Employee not found');
    const [after] = await db.update(employees).set({ archivedAt: null }).where(eq(employees.id, id)).returning();
    await writeAudit({ actor: req.actor ?? null, leagueId: before.leagueId, action: 'employee.restore', entityType: 'employee', entityId: id, before, after });
    res.json({ employee: after });
  }),
);

const participationSchema = z.object({
  periodId: z.number().int().positive(),
  status: z.enum(['eligible', 'hidden', 'terminated']),
  reason: z.string().min(1).optional(),
});

/**
 * Hiding an advisor is a scoring input, not a UI filter — see CLAUDE.md. This
 * upserts `participation`, not a boolean on the employee row, so a disputed
 * standing can be reconstructed.
 */
employeesRouter.put(
  '/:id/participation',
  requireRole('commissioner', 'manager'),
  asyncHandler(async (req, res) => {
    const employeeId = Number(req.params.id);
    const [employee] = await db.select().from(employees).where(eq(employees.id, employeeId)).limit(1);
    if (!employee) throw notFound('Employee not found');
    if (req.actor!.role === 'manager' && employee.dealershipId !== req.actor!.dealershipId) {
      throw badRequest('Managers can only manage participation at their own store.');
    }
    const body = participationSchema.parse(req.body);
    if (body.status !== 'eligible' && !body.reason) throw badRequest('A reason is required when hiding or terminating an advisor.');

    const [existing] = await db
      .select()
      .from(participation)
      .where(and(eq(participation.employeeId, employeeId), eq(participation.periodId, body.periodId)))
      .limit(1);

    const values = {
      employeeId,
      periodId: body.periodId,
      status: body.status,
      reason: body.reason ?? null,
      decidedBy: req.actor!.employeeId,
      decidedAt: new Date(),
    };

    const [row] = existing
      ? await db.update(participation).set(values).where(eq(participation.id, existing.id)).returning()
      : await db.insert(participation).values(values).returning();

    await writeAudit({
      actor: req.actor ?? null,
      leagueId: employee.leagueId,
      action: 'participation.set',
      entityType: 'participation',
      entityId: row!.id,
      before: existing ?? null,
      after: row,
    });

    // Decision #6: dropping a store below the manager-eligibility minimum must surface before the month closes.
    let warning: string | null = null;
    if (body.status !== 'eligible' && employee.dealershipId) {
      const [league] = await db.select().from(leagues).where(eq(leagues.id, employee.leagueId)).limit(1);
      const storeAdvisors = await db
        .select()
        .from(employees)
        .where(and(eq(employees.dealershipId, employee.dealershipId), eq(employees.role, 'advisor'), isNull(employees.archivedAt)));
      const statuses = await db.select().from(participation).where(eq(participation.periodId, body.periodId));
      const statusByEmployee = new Map(statuses.map((p) => [p.employeeId, p.status]));
      const eligibleCount = storeAdvisors.filter((a) => (statusByEmployee.get(a.id) ?? 'eligible') === 'eligible').length;
      if (league && eligibleCount < league.eligibilityMinAdvisorsForManager) {
        warning = `This store now has ${eligibleCount} eligible advisor(s), below the league minimum of ${league.eligibilityMinAdvisorsForManager} for the manager to be eligible to win.`;
      }
    }

    res.json({ participation: row, warning });
  }),
);

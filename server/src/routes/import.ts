// CSV import: the realistic bridge, since these figures live in DMS exports
// today (see docs/build-plan.html §Integration seams). Shares the exact same
// validator and write path (`recordSubmission`) as the web grid — a number
// pushed by a file is indistinguishable downstream from one typed by hand,
// except in its provenance field. Parsing/matching itself lives in
// ingestion/tabular.ts, shared with the entry grid's paste handler.
import { Router, type Request } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees } from '../db/schema.js';
import { asyncHandler, badRequest } from '../http.js';
import { requireStoreWrite, requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';
import { recordSubmission } from './submissions.js';
import { parseTabular, resolveTabularRows } from '../ingestion/tabular.js';
import { parseWorkbookSheet, workbookToTsv } from '../ingestion/workbook.js';
import { resolveRoster, rosterTemplateHeader } from '../ingestion/roster.js';

export const importRouter = Router();

const requestSchema = z.object({ dealershipId: z.number().int().positive(), periodId: z.number().int().positive(), csvText: z.string().min(1) });

importRouter.post(
  '/preview',
  requireStoreWrite('dealershipId', 'body'),
  asyncHandler(async (req, res) => {
    const body = requestSchema.parse(req.body);
    const parsed = parseTabular(body.csvText);
    const resolved = await resolveTabularRows(body.dealershipId, parsed);
    res.json({ parseErrors: parsed.errors, rowCount: parsed.rows.length, ...resolved });
  }),
);

importRouter.post(
  '/commit',
  requireStoreWrite('dealershipId', 'body'),
  asyncHandler(async (req, res) => {
    const body = requestSchema.parse(req.body);
    const parsed = parseTabular(body.csvText);
    if (parsed.errors.length) throw badRequest(`Fix ${parsed.errors.length} parse error(s) before importing: ${parsed.errors[0]}`);
    const resolved = await resolveTabularRows(body.dealershipId, parsed);
    if (resolved.unmatchedAdvisors.length) throw badRequest(`Unknown advisor name(s) on the roster: ${resolved.unmatchedAdvisors.join(', ')}`);

    const result = await recordSubmission(
      { dealershipId: body.dealershipId, periodId: body.periodId, advisorValues: resolved.advisorValues, managerValues: resolved.managerValues },
      { submittedBy: req.actor!.employeeId, provenance: 'csv' },
    );
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: null,
      action: 'submission.import_csv',
      entityType: 'submission',
      entityId: result.submission!.id,
      after: { rowCount: parsed.rows.length },
      provenance: 'csv',
    });
    res.status(201).json({ ...result, unmatchedCategories: resolved.unmatchedCategories });
  }),
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const xlsxMetaSchema = z.object({
  dealershipId: z.coerce.number().int().positive(),
  periodId: z.coerce.number().int().positive(),
});

importRouter.post(
  '/preview-xlsx',
  upload.single('file'),
  requireStoreWrite('dealershipId', 'body'),
  asyncHandler(async (req, res) => {
    const body = xlsxMetaSchema.parse(req.body);
    const file = req.file;
    if (!file) throw badRequest('Upload an .xlsx file as "file".');
    const parsed = await parseWorkbookSheet(file.buffer);
    const resolved = await resolveTabularRows(body.dealershipId, parsed);
    res.json({ parseErrors: parsed.errors, rowCount: parsed.rows.length, ...resolved });
  }),
);

importRouter.post(
  '/commit-xlsx',
  upload.single('file'),
  requireStoreWrite('dealershipId', 'body'),
  asyncHandler(async (req, res) => {
    const body = xlsxMetaSchema.parse(req.body);
    const file = req.file;
    if (!file) throw badRequest('Upload an .xlsx file as "file".');
    const parsed = await parseWorkbookSheet(file.buffer);
    if (parsed.errors.length) throw badRequest(`Fix ${parsed.errors.length} parse error(s) before importing: ${parsed.errors[0]}`);
    const resolved = await resolveTabularRows(body.dealershipId, parsed);
    if (resolved.unmatchedAdvisors.length) throw badRequest(`Unknown advisor name(s) on the roster: ${resolved.unmatchedAdvisors.join(', ')}`);

    const result = await recordSubmission(
      { dealershipId: body.dealershipId, periodId: body.periodId, advisorValues: resolved.advisorValues, managerValues: resolved.managerValues },
      { submittedBy: req.actor!.employeeId, provenance: 'csv' },
    );
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: null,
      action: 'submission.import_xlsx',
      entityType: 'submission',
      entityId: result.submission!.id,
      after: { rowCount: parsed.rows.length },
      provenance: 'csv',
    });
    res.status(201).json({ ...result, unmatchedCategories: resolved.unmatchedCategories });
  }),
);

// ------------------------------------------------------------ roster import --
// Commissioner-only: a roster file can move somebody between stores, which
// PATCH /api/employees/:id already restricts to a commissioner. Accepting the
// same change in bulk must not be the loophole around that rule.

/** Pasted text or an uploaded file, reduced to one delimited string. */
async function rosterTextFrom(req: Request): Promise<string> {
  const file = req.file;
  if (file) {
    const isXlsx = /\.xlsx$/i.test(file.originalname) || file.mimetype.includes('spreadsheetml');
    if (isXlsx) {
      const tsv = await workbookToTsv(file.buffer);
      if (!tsv) throw badRequest('The first sheet is empty, or the workbook has no sheets.');
      return tsv;
    }
    return file.buffer.toString('utf8').replace(/^﻿/, '');
  }
  const parsed = z.object({ text: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Provide a roster file as "file", or the rows as "text".');
  return parsed.data.text;
}

// Served rather than hardcoded client-side so the accepted columns and the
// documented ones cannot drift apart.
importRouter.get(
  '/roster/template',
  requireRole('commissioner'),
  asyncHandler(async (_req, res) => {
    res.json({ expectedColumns: rosterTemplateHeader() });
  }),
);

importRouter.post(
  '/roster/preview',
  requireRole('commissioner'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const resolved = await resolveRoster(await rosterTextFrom(req));
    res.json({ ...resolved, expectedColumns: rosterTemplateHeader() });
  }),
);

importRouter.post(
  '/roster/commit',
  requireRole('commissioner'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const resolved = await resolveRoster(await rosterTextFrom(req));
    if (resolved.errors.length) {
      throw badRequest(`Fix ${resolved.errors.length} problem(s) before importing: ${resolved.errors[0]}`);
    }
    const league = await currentLeague();

    // All or nothing: a 45-row file that fails partway would otherwise leave a
    // roster the commissioner never approved, and a preview that no longer
    // describes it.
    const { created, updated } = await db.transaction(async (tx) => {
      let created = 0;
      let updated = 0;

      for (const row of resolved.toCreate) {
        const [inserted] = await tx
          .insert(employees)
          .values({
            leagueId: league.id,
            dealershipId: row.dealershipId,
            name: row.name,
            alias: row.alias,
            email: row.email,
            role: row.role,
            hireDate: row.hireDate,
          })
          .returning();
        created += 1;
        await writeAudit(
          {
            actor: req.actor ?? null,
            leagueId: league.id,
            action: 'employee.create',
            entityType: 'employee',
            entityId: inserted!.id,
            after: inserted,
            provenance: 'csv',
          },
          tx,
        );
      }

      for (const row of resolved.toUpdate) {
        const [before] = await tx.select().from(employees).where(eq(employees.id, row.employeeId)).limit(1);
        if (!before) continue;
        // Rostering a floater resets the counter, exactly as PATCH /api/employees/:id does.
        const becomingRostered = before.dealershipId == null && row.dealershipId != null;
        const [after] = await tx
          .update(employees)
          .set({
            name: row.name,
            alias: row.alias,
            role: row.role,
            dealershipId: row.dealershipId,
            ...(row.hireDate ? { hireDate: row.hireDate } : {}),
            ...(becomingRostered ? { consecutiveFloaterMonths: 0 } : {}),
            ...(row.restore ? { archivedAt: null } : {}),
          })
          .where(eq(employees.id, row.employeeId))
          .returning();
        updated += 1;
        await writeAudit(
          {
            actor: req.actor ?? null,
            leagueId: league.id,
            action: row.restore ? 'employee.restore' : 'employee.update',
            entityType: 'employee',
            entityId: row.employeeId,
            before,
            after,
            provenance: 'csv',
          },
          tx,
        );
      }

      return { created, updated };
    });

    res.status(201).json({ created, updated, unchanged: resolved.unchanged });
  }),
);

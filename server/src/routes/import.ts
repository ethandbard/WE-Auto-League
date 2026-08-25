// CSV import: the realistic bridge, since these figures live in DMS exports
// today (see docs/build-plan.html §Integration seams). Shares the exact same
// validator and write path (`recordSubmission`) as the web grid — a number
// pushed by a file is indistinguishable downstream from one typed by hand,
// except in its provenance field. Parsing/matching itself lives in
// ingestion/tabular.ts, shared with the entry grid's paste handler.
import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { asyncHandler, badRequest } from '../http.js';
import { requireStoreWrite } from '../middleware.js';
import { writeAudit } from '../audit.js';
import { recordSubmission } from './submissions.js';
import { parseTabular, resolveTabularRows } from '../ingestion/tabular.js';
import { parseWorkbookSheet } from '../ingestion/workbook.js';

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

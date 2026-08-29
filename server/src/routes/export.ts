// Data export — "can I get my numbers out" is a fair question from any client,
// and the answer needs to work without a database login. Shaping and
// serialization live in ../export/standings.ts; this file only negotiates
// HTTP. Read-only, so requireAuth() is the whole authorization story: anyone
// who can see a leaderboard can export the same rows.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../http.js';
import { requireAuth } from '../middleware.js';
import { idParam } from '../validation.js';
import { standingsExport, sheetForScope, toCsv, toWorkbook, exportFilename } from '../export/standings.js';

export const exportRouter = Router();

const scopeQuery = z.object({ scope: z.enum(['advisor', 'manager', 'team']).default('advisor') });

exportRouter.get(
  '/:id/standings.csv',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const { scope } = scopeQuery.parse(req.query);
    const exported = await standingsExport(id);
    const csv = toCsv(sheetForScope(exported, scope));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(exported.periodLabel, `${scope}s`, 'csv')}"`);
    // Excel reads a UTF-8 CSV as the system codepage unless it sees a BOM.
    res.send('﻿' + csv);
  }),
);

exportRouter.get(
  '/:id/standings.xlsx',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { id } = idParam.parse(req.params);
    const exported = await standingsExport(id);
    const buffer = await toWorkbook(exported.sheets);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${exportFilename(exported.periodLabel, 'all', 'xlsx')}"`);
    res.send(buffer);
  }),
);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseWorkbookSheet } from '../src/ingestion/workbook.js';

test('parseWorkbookSheet reads the first sheet into ParsedTable', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.addRow(['Name', 'CSI 100s', 'ELR']);
  sheet.addRow(['Ada', 10, 2.5]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  const parsed = await parseWorkbookSheet(buffer);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.identifier, 'Ada');
  assert.equal(parsed.rows[0]!.values['CSI 100s'], 10);
  assert.equal(parsed.rows[0]!.values.ELR, 2.5);
});

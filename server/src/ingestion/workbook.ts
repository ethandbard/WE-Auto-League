import ExcelJS from 'exceljs';
import { parseTabular, type ParsedTable } from './tabular.js';

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && 'result' in value && value.result != null) {
    return String(value.result);
  }
  return (cell.text ?? String(value)).trim();
}

/**
 * First worksheet only, flattened to TSV so any tab-aware parser can consume
 * it. Tab rather than comma because cell text is passed through unquoted — a
 * dealership name like "Toyota, PA" would split a CSV line but survives here.
 * Returns null when there is nothing to read.
 */
export async function workbookToTsv(buffer: Buffer): Promise<string | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return null;

  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (cells.length < colNumber - 1) cells.push('');
      cells.push(cellText(cell));
    });
    if (cells.some((c) => c !== '')) lines.push(cells.join('\t'));
  });

  return lines.length ? lines.join('\n') : null;
}

/**
 * First worksheet only, same ParsedTable shape as parseTabular, so
 * resolveTabularRows and the commit path stay unchanged.
 */
export async function parseWorkbookSheet(buffer: Buffer): Promise<ParsedTable> {
  const tsv = await workbookToTsv(buffer);
  if (tsv === null) return { header: [], rows: [], errors: ['The first sheet is empty, or the workbook has no sheets.'] };
  return parseTabular(tsv);
}

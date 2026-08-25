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
 * First worksheet only, same ParsedTable shape as parseTabular, so
 * resolveTabularRows and the commit path stay unchanged.
 */
export async function parseWorkbookSheet(buffer: Buffer): Promise<ParsedTable> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { header: [], rows: [], errors: ['Workbook has no sheets.'] };

  const lines: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      while (cells.length < colNumber - 1) cells.push('');
      cells.push(cellText(cell));
    });
    if (cells.some((c) => c !== '')) lines.push(cells.join('\t'));
  });

  if (lines.length === 0) return { header: [], rows: [], errors: ['The first sheet is empty.'] };
  return parseTabular(lines.join('\n'));
}

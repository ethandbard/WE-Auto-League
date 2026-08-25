// Shared "smart tabular entry" logic: turns a block of pasted-or-uploaded
// rows (advisor name in column 1, category labels/keys across the header)
// into the shape `recordSubmission()` expects. Used today by the CSV
// importer (routes/import.ts, delimiter `,`), XLSX import (ingestion/workbook.ts
// reduces the first sheet to this same shape), and the entry grid's
// paste-from-spreadsheet handler (delimiter `\t`, what Excel/Sheets put on
// the clipboard) — factored out here, rather than left inside a route file,
// so a future MCP tool or other integration can call `resolveTabularRows`
// directly with no HTTP round trip. This is a parsing/matching helper only;
// every caller still writes through `recordSubmission` (submissions.ts) for
// the actual submit, so provenance and audit stay correct regardless of
// where the rows came from.
import { db } from '../db/client.js';
import { categories, employees } from '../db/schema.js';
import { storeOrFloaterCondition } from '../roster.js';

const MANAGER_ROW_MARKERS = new Set(['store', 'manager', 'team']);

export interface ParsedRow {
  identifier: string;
  isManagerRow: boolean;
  values: Record<string, number>;
}

export interface ParsedTable {
  header: string[];
  rows: ParsedRow[];
  errors: string[];
}

export interface ResolvedTable {
  advisorValues: Array<{ employeeId: number; values: Record<string, number> }>;
  managerValues: Record<string, number>;
  unmatchedAdvisors: string[];
  unmatchedCategories: string[];
}

/**
 * Parses CSV or TSV — tab-separated is what a browser paste event delivers
 * for a range copied out of Excel or Google Sheets, so this is what makes
 * "copy the DMS report, paste into the grid" work. No quoted-field support:
 * neither the client's DMS exports nor a plain spreadsheet paste produce
 * embedded delimiters.
 */
export function parseTabular(text: string): ParsedTable {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const errors: string[] = [];
  if (lines.length < 2) return { header: [], rows: [], errors: ['Needs a header row and at least one data row.'] };

  const delimiter = lines[0]!.includes('\t') ? '\t' : ',';
  const header = lines[0]!.split(delimiter).map((h) => h.trim());
  const rows: ParsedRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(delimiter).map((c) => c.trim());
    const identifier = cells[0] ?? '';
    const values: Record<string, number> = {};
    for (let col = 1; col < header.length; col++) {
      const raw = cells[col];
      if (raw === undefined || raw === '') continue;
      const num = Number(raw.replace(/[$,]/g, ''));
      if (Number.isNaN(num)) {
        errors.push(`Row ${i + 2}, column "${header[col]}": "${raw}" is not a number.`);
        continue;
      }
      values[header[col]!] = num;
    }
    rows.push({ identifier, isManagerRow: MANAGER_ROW_MARKERS.has(identifier.toLowerCase()), values });
  });
  return { header, rows, errors };
}

/** Matches parsed rows against the store's roster (by name/alias) and the league's categories (by label/key). */
export async function resolveTabularRows(dealershipId: number, parsed: ParsedTable): Promise<ResolvedTable> {
  const employeeRows = await db.select().from(employees).where(storeOrFloaterCondition(dealershipId));
  const employeeByName = new Map(employeeRows.flatMap((e) => [[e.name.toLowerCase(), e], ...(e.alias ? [[e.alias.toLowerCase(), e] as const] : [])]));
  const categoryRows = await db.select().from(categories);
  const categoryByLabelOrKey = new Map(categoryRows.flatMap((c) => [[c.key.toLowerCase(), c], [c.label.toLowerCase(), c]] as const));

  const unmatchedAdvisors: string[] = [];
  const unmatchedCategories = new Set<string>();
  const advisorValues: Array<{ employeeId: number; values: Record<string, number> }> = [];
  let managerValues: Record<string, number> = {};

  for (const row of parsed.rows) {
    const mappedValues: Record<string, number> = {};
    for (const [header, value] of Object.entries(row.values)) {
      const cat = categoryByLabelOrKey.get(header.toLowerCase());
      if (!cat) {
        unmatchedCategories.add(header);
        continue;
      }
      mappedValues[cat.key] = value;
    }
    if (row.isManagerRow) {
      managerValues = mappedValues;
      continue;
    }
    const employee = employeeByName.get(row.identifier.toLowerCase());
    if (!employee) {
      unmatchedAdvisors.push(row.identifier);
      continue;
    }
    advisorValues.push({ employeeId: employee.id, values: mappedValues });
  }

  return { advisorValues, managerValues, unmatchedAdvisors, unmatchedCategories: [...unmatchedCategories] };
}

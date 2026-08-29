// Standings export. Shaping lives here rather than in the route so CSV and
// XLSX cannot drift apart — both serialize the same Sheet[], the mirror of
// ingestion/tabular.ts on the way in.
//
// Sheets stay purely tabular: no title banner, no merged metadata rows. An
// export people are paid against gets re-imported, diffed, and pivoted, so the
// header must be row 1. Period identity rides in the filename instead, and the
// per-row audit columns (engine version, computed-at, published) carry the
// provenance a payroll dispute actually needs.
import ExcelJS from 'exceljs';
import { fullStandingsFor, type DecoratedScore } from '../scoring/standings.js';

export interface Sheet {
  name: string;
  header: string[];
  rows: (string | number | null)[][];
}

export type ExportScope = 'advisor' | 'manager' | 'team';

/**
 * Category columns come from the rows themselves, not a fixed list — categories
 * are data (see CLAUDE.md), so a league that activates a ninth one exports it
 * without a code change. `advisorCount` is dropped: it's a team-score input,
 * not a points column.
 */
function categoryKeysFor(rows: DecoratedScore[]): string[] {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.categoryBreakdown)) {
      if (key !== 'advisorCount') keys.add(key);
    }
  }
  return [...keys];
}

function sheetFor(name: string, scope: ExportScope, rows: DecoratedScore[]): Sheet {
  const categoryKeys = categoryKeysFor(rows);
  const namesPeople = scope !== 'team';
  const header = [
    'Position',
    ...(namesPeople ? [scope === 'advisor' ? 'Advisor' : 'Manager'] : []),
    'Store',
    ...categoryKeys,
    'Penalties',
    'Score',
    'Engine Version',
    'Computed At',
    'Published',
  ];

  const body = rows.map((row) => [
    row.position ?? null,
    ...(namesPeople ? [row.employeeName ?? ''] : []),
    row.dealershipName ?? '',
    ...categoryKeys.map((key) => row.categoryBreakdown[key] ?? null),
    Number(row.penaltyTotal),
    Number(row.total),
    row.engineVersion,
    row.computedAt instanceof Date ? row.computedAt.toISOString() : String(row.computedAt),
    row.isPublished ? 'yes' : 'no',
  ]);

  return { name, header, rows: body };
}

export interface StandingsExport {
  periodLabel: string;
  isPublished: boolean;
  sheets: Sheet[];
}

export async function standingsExport(periodId: number): Promise<StandingsExport> {
  const { period, advisors, managers, teams } = await fullStandingsFor(periodId);
  return {
    periodLabel: period.label,
    isPublished: period.status === 'published',
    sheets: [
      sheetFor('Advisors', 'advisor', advisors),
      sheetFor('Managers', 'manager', managers),
      sheetFor('Teams', 'team', teams),
    ],
  };
}

export function sheetForScope(exported: StandingsExport, scope: ExportScope): Sheet {
  const byScope: Record<ExportScope, string> = { advisor: 'Advisors', manager: 'Managers', team: 'Teams' };
  return exported.sheets.find((s) => s.name === byScope[scope])!;
}

/** RFC 4180: quote when the value contains a delimiter, quote, or newline; double interior quotes. */
function csvCell(value: string | number | null): string {
  if (value === null) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(sheet: Sheet): string {
  const lines = [sheet.header.map(csvCell).join(','), ...sheet.rows.map((r) => r.map(csvCell).join(','))];
  // CRLF and a trailing newline: Excel is the destination for most of these.
  return lines.join('\r\n') + '\r\n';
}

export async function toWorkbook(sheets: Sheet[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    ws.addRow(sheet.header);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const row of sheet.rows) ws.addRow(row);
    ws.columns.forEach((column, i) => {
      const widest = Math.max(sheet.header[i]?.length ?? 0, ...sheet.rows.map((r) => String(r[i] ?? '').length));
      column.width = Math.min(Math.max(widest + 2, 10), 40);
    });
  }
  // ExcelJS.Buffer is its own declared type; at runtime this is a Node Buffer.
  // workbook.ts casts the same way on the way in.
  return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
}

/** `we-auto-league-standings-June-2026-advisors.csv` — safe on every filesystem, sorts sensibly. */
export function exportFilename(periodLabel: string, suffix: string, extension: string): string {
  const slug = periodLabel.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `we-auto-league-standings-${slug}-${suffix}.${extension}`;
}

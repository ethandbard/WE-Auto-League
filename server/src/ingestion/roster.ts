// Roster import: get 50-odd advisors, their stores, and — the part that
// actually blocks anything — their email addresses into the system without
// typing them one at a time. Separate from tabular.ts because that module
// coerces every non-identifier cell to a number, which is right for metrics
// and wrong for a roster of names and addresses.
//
// Resolution only. Nothing here writes; routes/import.ts drives preview and
// commit off the same resolve call, so what an admin approves is exactly what
// lands.
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { dealerships, employees } from '../db/schema.js';

export type RosterRole = 'advisor' | 'manager' | 'commissioner';

/**
 * Parse output: valid in shape, not yet checked against the league's stores or
 * roster.
 *
 * Every optional field distinguishes two states the file genuinely expresses.
 * `undefined` means the file had no such column, so it states no opinion and
 * the stored value must be left alone — a Name+Email file collecting addresses
 * would otherwise demote every manager and un-roster every advisor. A present
 * column's blank cell is a stated value: a blank Alias clears it, and a blank
 * Store means floater.
 */
export interface ParsedRosterRow {
  /** 1-based row number in the source file, for error messages an admin can act on. */
  line: number;
  name: string;
  email: string;
  alias: string | null | undefined;
  /** Blank cells stay undefined: there is no meaningful "empty role" to state. */
  role: RosterRole | undefined;
  storeName: string | null | undefined;
  /** Blank cells stay undefined; clearing a hire date by leaving a cell empty would be data loss. */
  hireDate: string | null | undefined;
}

export interface RosterRow extends Omit<ParsedRosterRow, 'storeName'> {
  dealershipId: number | null | undefined;
  dealershipName: string | null | undefined;
}

export interface ResolvedRoster {
  toCreate: RosterRow[];
  /** Only rows whose stored values actually differ — an unchanged re-import is a no-op, not 45 audit entries. */
  toUpdate: Array<RosterRow & { employeeId: number; restore: boolean; changes: string[] }>;
  unchanged: number;
  errors: string[];
  unmatchedStores: string[];
}

/** Header aliases, so a spreadsheet exported from a DMS or typed by hand both land. */
const COLUMN_ALIASES: Record<string, string[]> = {
  name: ['name', 'employee', 'employee name', 'full name', 'advisor', 'advisor name'],
  email: ['email', 'email address', 'e-mail', 'work email'],
  alias: ['alias', 'display name', 'nickname', 'short name'],
  role: ['role', 'position', 'title', 'job title'],
  store: ['store', 'dealership', 'location', 'brand', 'rooftop'],
  hireDate: ['hire date', 'hiredate', 'hired', 'start date', 'startdate'],
};

const ROLE_ALIASES: Record<string, RosterRole> = {
  advisor: 'advisor',
  'service advisor': 'advisor',
  sa: 'advisor',
  manager: 'manager',
  'service manager': 'manager',
  sm: 'manager',
  commissioner: 'commissioner',
  admin: 'commissioner',
  administrator: 'commissioner',
};

/** Splits CSV or TSV into header-keyed cells, all as text. No quoted-field support, matching parseTabular. */
function splitRows(text: string): { header: string[]; rows: Array<{ line: number; cells: string[] }> } | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const delimiter = lines[0]!.includes('\t') ? '\t' : ',';
  const header = lines[0]!.split(delimiter).map((h) => h.trim());
  const rows = lines.slice(1).map((line, i) => ({ line: i + 2, cells: line.split(delimiter).map((c) => c.trim()) }));
  return { header, rows };
}

/** Maps our canonical field names onto the column indexes this file happens to use. */
function mapColumns(header: string[]): Record<string, number> {
  const lowered = header.map((h) => h.toLowerCase());
  const found: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const index = lowered.findIndex((h) => aliases.includes(h));
    if (index !== -1) found[field] = index;
  }
  return found;
}

// Deliberately permissive: catches "not an address at all" without rejecting
// the valid-but-unusual. The real proof an address works is a delivered email.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// A real .xlsx date cell reaches here as a full ISO timestamp — workbook.ts
// stringifies Date values — while a hand-typed sheet gives M/D/YYYY.
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/;
const US_DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Normalize a hire-date cell to `YYYY-MM-DD`, or explain why it isn't a date.
 *
 * `employees.hire_date` is a Postgres `date`, so an unparseable cell that
 * reaches the insert is a 500 rather than a row an admin can fix in the
 * preview.
 */
function normalizeHireDate(raw: string): { date: string } | { error: string } {
  const iso = ISO_DATE_RE.exec(raw);
  const us = iso ? null : US_DATE_RE.exec(raw);
  let year: string;
  let month: string;
  let day: string;
  if (iso) {
    year = iso[1]!;
    month = iso[2]!;
    day = iso[3]!;
  } else if (us) {
    month = us[1]!.padStart(2, '0');
    day = us[2]!.padStart(2, '0');
    year = us[3]!;
  } else {
    return { error: `"${raw}" is not a hire date. Use YYYY-MM-DD.` };
  }
  const date = `${year}-${month}-${day}`;
  // Round-tripping rejects a well-formed date that isn't on the calendar:
  // 2025-02-30 parses, then normalizes to March 2nd.
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return { error: `"${raw}" is not a real calendar date.` };
  }
  return { date };
}

export interface ParsedRoster {
  rows: ParsedRosterRow[];
  errors: string[];
}

/**
 * Pure: shape, header mapping, and per-cell validation, with no database
 * involved. Split out from resolveRoster the same way parseTabular is split
 * from resolveTabularRows, so the fiddly part is testable without fixtures.
 */
export function parseRoster(text: string): ParsedRoster {
  const split = splitRows(text);
  if (!split) return { rows: [], errors: ['Needs a header row and at least one data row.'] };

  const columns = mapColumns(split.header);
  const errors: string[] = [];
  if (columns.name === undefined) errors.push('No "Name" column found. Expected one of: ' + COLUMN_ALIASES.name!.join(', ') + '.');
  if (columns.email === undefined) errors.push('No "Email" column found. Expected one of: ' + COLUMN_ALIASES.email!.join(', ') + '.');
  if (errors.length) return { rows: [], errors };

  /** undefined when the file has no such column, distinct from a present-but-blank cell. */
  const cell = (cells: string[], field: string): string | undefined =>
    columns[field] === undefined ? undefined : (cells[columns[field]!] ?? '');
  const seenEmails = new Set<string>();
  const rows: ParsedRosterRow[] = [];

  for (const { line, cells } of split.rows) {
    // Both columns are proven present above, so these are always strings.
    const name = cell(cells, 'name')!;
    const rawEmail = cell(cells, 'email')!;
    const email = rawEmail.toLowerCase();
    if (!name && !rawEmail) continue;
    if (!name) {
      errors.push(`Row ${line}: missing a name.`);
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      errors.push(`Row ${line} (${name}): "${rawEmail}" is not a valid email address.`);
      continue;
    }
    if (seenEmails.has(email)) {
      errors.push(`Row ${line} (${name}): ${email} appears more than once in this file.`);
      continue;
    }
    seenEmails.add(email);

    const rawRole = cell(cells, 'role')?.toLowerCase();
    if (rawRole && !ROLE_ALIASES[rawRole]) {
      errors.push(`Row ${line} (${name}): unknown role "${cell(cells, 'role')}". Use advisor, manager, or commissioner.`);
      continue;
    }

    const rawHireDate = cell(cells, 'hireDate');
    let hireDate: string | undefined;
    if (rawHireDate) {
      const normalized = normalizeHireDate(rawHireDate);
      if ('error' in normalized) {
        errors.push(`Row ${line} (${name}): ${normalized.error}`);
        continue;
      }
      hireDate = normalized.date;
    }

    const rawAlias = cell(cells, 'alias');
    const rawStore = cell(cells, 'store');

    rows.push({
      line,
      name,
      email,
      alias: rawAlias === undefined ? undefined : rawAlias || null,
      role: rawRole ? ROLE_ALIASES[rawRole]! : undefined,
      // A blank store is meaningful, not missing: that's a floater advisor, or
      // a commissioner, both of whom carry a null dealershipId. See CLAUDE.md.
      storeName: rawStore === undefined ? undefined : rawStore || null,
      hireDate,
    });
  }

  return { rows, errors };
}

export async function resolveRoster(text: string): Promise<ResolvedRoster> {
  const parsed = parseRoster(text);
  if (parsed.rows.length === 0) {
    return { toCreate: [], toUpdate: [], unchanged: 0, errors: parsed.errors, unmatchedStores: [] };
  }

  const [storeRows, employeeRows] = await Promise.all([
    db.select().from(dealerships).where(isNull(dealerships.archivedAt)),
    // Archived employees are read too. `employees_league_email_uq` ignores
    // archived_at, so treating an archived address as new would insert
    // straight into a unique violation; it resolves to a restore instead.
    db.select().from(employees),
  ]);
  const storeByName = new Map(storeRows.flatMap((d) => [[d.name.toLowerCase(), d], ...(d.alias ? [[d.alias.toLowerCase(), d] as const] : [])]));
  const storeNameById = new Map(storeRows.map((d) => [d.id, d.alias ?? d.name]));
  const employeeByEmail = new Map(employeeRows.map((e) => [e.email.toLowerCase(), e]));
  /** Both sides of a store diff read as names — a commissioner approving the preview should never see a raw id. */
  const storeLabel = (id: number | null): string => (id == null ? 'unassigned' : (storeNameById.get(id) ?? `store ${id}`));

  const errors = [...parsed.errors];
  const unmatchedStores = new Set<string>();
  const toCreate: RosterRow[] = [];
  const toUpdate: ResolvedRoster['toUpdate'] = [];
  let unchanged = 0;

  for (const { storeName, ...rest } of parsed.rows) {
    let dealershipId: number | null | undefined;
    let dealershipName: string | null | undefined;
    if (storeName) {
      const store = storeByName.get(storeName.toLowerCase());
      if (!store) {
        unmatchedStores.add(storeName);
        errors.push(`Row ${rest.line} (${rest.name}): no store named "${storeName}".`);
        continue;
      }
      dealershipId = store.id;
      dealershipName = store.alias ?? store.name;
    } else if (storeName === null) {
      // A stated blank: floater. An absent Store column leaves both undefined.
      dealershipId = null;
      dealershipName = null;
    }

    const row: RosterRow = { ...rest, dealershipId, dealershipName };
    const existing = employeeByEmail.get(row.email);
    if (!existing) {
      toCreate.push(row);
      continue;
    }

    const changes: string[] = [];
    // Restoring puts somebody back into scoring eligibility, so it is shown in
    // the preview for approval rather than applied silently.
    const restore = existing.archivedAt != null;
    if (restore) changes.push('archived → active');
    // Each field is compared only when the file stated it. An absent column is
    // no opinion, so it can neither show as a change nor be written on commit.
    if (existing.name !== row.name) changes.push(`name: ${existing.name} → ${row.name}`);
    if (row.alias !== undefined && (existing.alias ?? null) !== row.alias) {
      changes.push(`alias: ${existing.alias ?? '—'} → ${row.alias ?? '—'}`);
    }
    if (row.role !== undefined && existing.role !== row.role) changes.push(`role: ${existing.role} → ${row.role}`);
    if (dealershipId !== undefined && existing.dealershipId !== dealershipId) {
      changes.push(`store: ${storeLabel(existing.dealershipId)} → ${storeLabel(dealershipId)}`);
    }
    if (row.hireDate && existing.hireDate !== row.hireDate) changes.push(`hire date: ${existing.hireDate ?? '—'} → ${row.hireDate}`);

    if (changes.length === 0) {
      unchanged += 1;
      continue;
    }
    toUpdate.push({ ...row, employeeId: existing.id, restore, changes });
  }

  return { toCreate, toUpdate, unchanged, errors: byLineNumber(errors), unmatchedStores: [...unmatchedStores] };
}

/**
 * Parse errors and store-matching errors are collected in two passes, so left
 * alone they interleave out of order. An admin fixing a file works top to
 * bottom; file-level complaints (no Email column) sort first.
 */
function byLineNumber(errors: string[]): string[] {
  const lineOf = (e: string): number => {
    const match = /^Row (\d+)/.exec(e);
    return match ? Number(match[1]) : 0;
  };
  return [...errors].sort((a, b) => lineOf(a) - lineOf(b));
}

/**
 * Return the column set an admin should put in the file.
 *
 * Derived from COLUMN_ALIASES rather than written out again, so a field the
 * parser accepts cannot go missing from the template the UI shows. The first
 * alias of each field is its canonical label.
 */
export function rosterTemplateHeader(): string[] {
  return Object.values(COLUMN_ALIASES).map((aliases) => aliases[0]!.replace(/\b\w/g, (c) => c.toUpperCase()));
}

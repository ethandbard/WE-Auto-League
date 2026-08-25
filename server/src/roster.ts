// Store roster plus unassigned floater advisors. Commissioners (unassigned,
// non-advisor) stay out — they are not writing service at a store.
import { and, eq, isNull, or } from 'drizzle-orm';
import { employees } from './db/schema.js';

export function includeOnStoreRoster(
  employee: { id: number; dealershipId: number | null; role: string },
  dealershipId: number,
): boolean {
  if (employee.dealershipId === dealershipId) return true;
  return employee.dealershipId === null && employee.role === 'advisor';
}

/** Dedupes by id so concatenating a store list with a floater list cannot double-count. */
export function uniqueRosterById<T extends { id: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}

export function storeRosterIds(
  allEmployees: Array<{ id: number; dealershipId: number | null; role: string }>,
  dealershipId: number,
): number[] {
  return uniqueRosterById(allEmployees.filter((e) => includeOnStoreRoster(e, dealershipId))).map((e) => e.id);
}

/** SQL form of includeOnStoreRoster, plus the archived-at filter every caller already applied. */
export function storeOrFloaterCondition(dealershipId: number) {
  return and(
    isNull(employees.archivedAt),
    or(eq(employees.dealershipId, dealershipId), and(isNull(employees.dealershipId), eq(employees.role, 'advisor'))),
  );
}

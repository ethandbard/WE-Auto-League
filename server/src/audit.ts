// All writes land here, whatever path they arrive by (web, csv, api, mcp) —
// see CLAUDE.md. Call from inside the same route handler that performs the
// write, after it succeeds.
import { db } from './db/client.js';
import { auditLog } from './db/schema.js';
import type { Actor } from './auth.js';

export type Provenance = 'web' | 'csv' | 'api' | 'mcp' | 'system';

export async function writeAudit(entry: {
  actor: Actor | null;
  leagueId: number | null;
  action: string;
  entityType: string;
  entityId?: number | null;
  before?: unknown;
  after?: unknown;
  provenance?: Provenance;
}): Promise<void> {
  await db.insert(auditLog).values({
    leagueId: entry.leagueId,
    actorId: entry.actor?.employeeId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    before: entry.before === undefined ? null : (entry.before as object),
    after: entry.after === undefined ? null : (entry.after as object),
    provenance: entry.provenance ?? 'web',
  });
}

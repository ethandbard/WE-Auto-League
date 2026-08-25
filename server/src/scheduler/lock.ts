// Every scheduled run takes a Postgres advisory lock, so a duplicate
// container or a redeploy that fires the same job twice is a no-op rather
// than a double penalty or a duplicate standings email — see CLAUDE.md.
import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';

// Arbitrary but stable per job name, via a simple string hash — Postgres advisory locks take a bigint key.
function lockKeyFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return hash;
}

export async function withAdvisoryLock(name: string, fn: () => Promise<void>): Promise<'ran' | 'skipped-locked'> {
  const key = lockKeyFor(name);
  const [{ locked }] = (await db.execute(sql`select pg_try_advisory_lock(${key}) as locked`)).rows as unknown as [{ locked: boolean }];
  if (!locked) {
    console.log(`[scheduler] "${name}" already running elsewhere — skipped`);
    return 'skipped-locked';
  }
  try {
    await fn();
    return 'ran';
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${key})`);
  }
}

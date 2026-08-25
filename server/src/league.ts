// The prototype serves one league per deployment (the multi-tenant columns
// exist for the enterprise story — see CLAUDE.md decision #3 in decisions.md
// — but nothing here needs a league switcher yet). Routes that need "the"
// league call this instead of hard-coding id 1.
import { eq } from 'drizzle-orm';
import { db } from './db/client.js';
import { leagues } from './db/schema.js';
import { notFound } from './http.js';

let cachedLeagueId: number | null = null;

export async function currentLeague() {
  const [row] = cachedLeagueId
    ? await db.select().from(leagues).where(eq(leagues.id, cachedLeagueId)).limit(1)
    : await db.select().from(leagues).limit(1);
  if (!row) throw notFound('No league configured. Run the seed script.');
  cachedLeagueId = row.id;
  return row;
}

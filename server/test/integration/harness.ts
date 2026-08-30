// Harness for the DB-backed integration suite: a throwaway Postgres database,
// the real migrations, and inline fixtures.
//
// Deliberately named `.ts` rather than `.test.ts` so `npm test`'s
// `test/**/*.test.ts` glob never picks the suite up — the pure tests must stay
// runnable with no database. Run these with `npm run test:integration`, which
// points DATABASE_URL at the test database before `src/env.ts` reads it.
import pg from 'pg';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { env } from '../../src/env.js';
import { db, pool } from '../../src/db/client.js';
import { categories, dealerships, employees, leagues, organizations, periods } from '../../src/db/schema.js';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Hard safety guard. Every reset TRUNCATEs the whole schema, so the suite must
 * never reach a database holding real data — the dev database
 * (`we_auto_league`) is one dropped env var away.
 */
function testDatabaseName(): string {
  const name = new URL(env.databaseUrl).pathname.replace(/^\//, '');
  if (!/(itest|_test)$/.test(name)) {
    throw new Error(
      `Refusing to run integration tests against "${name}". DATABASE_URL's database name must end in "itest" or "_test" — run them with \`npm run test:integration\`.`,
    );
  }
  return name;
}

/** Mirrors `src/db/create.ts`: connect to the maintenance database, create ours if it is missing. */
async function ensureDatabase(name: string): Promise<void> {
  const url = new URL(env.databaseUrl);
  url.pathname = '/postgres';
  const client = new pg.Client({
    connectionString: url.toString(),
    ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
  });
  await client.connect();
  try {
    const { rows } = await client.query('select 1 from pg_database where datname = $1', [name]);
    if (rows.length === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function truncateAll(): Promise<void> {
  // The drizzle bookkeeping table lives in its own `drizzle` schema, so every
  // public table is an app table and safe to clear.
  const { rows } = await pool.query<{ tablename: string }>(
    `select tablename from pg_tables where schemaname = 'public'`,
  );
  if (!rows.length) return;
  const list = rows.map((r) => `public."${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let prepared = false;

/**
 * Call once per test file, before the fixtures. Creates the database if
 * needed, applies `server/drizzle/`, and truncates — so a file starts from an
 * empty schema whatever ran before it.
 */
export async function resetDatabase(): Promise<void> {
  const name = testDatabaseName();
  if (!prepared) {
    await ensureDatabase(name);
    // Path is relative to this file, matching src/db/migrate.ts.
    await migrate(db, { migrationsFolder: resolve(here, '../../drizzle') });
    const { rows } = await pool.query<{ current_database: string }>('select current_database()');
    // Belt and braces: prove the pool really landed on the guarded database.
    if (rows[0]?.current_database !== name) {
      throw new Error(`Connected to "${rows[0]?.current_database}", expected "${name}"`);
    }
    prepared = true;
  }
  await truncateAll();
}

/** Node keeps the process alive on an open pool; every test file must call this from `after()`. */
export async function closeDatabase(): Promise<void> {
  await pool.end();
}

// ------------------------------------------------------------------ fixtures --
// Minimal inline seeds. The real `scripts/seed.ts` loads a 53-person fixture
// and publishes a period; a suite that needs four rows should not pay for that,
// and should not depend on its shape either.

let unique = 0;
const suffix = () => `${process.pid}-${++unique}`;

export async function seedLeague(overrides: Partial<typeof leagues.$inferInsert> = {}) {
  const [org] = await db
    .insert(organizations)
    .values({ name: 'Test Group', slug: `test-org-${suffix()}` })
    .returning();
  const [league] = await db
    .insert(leagues)
    .values({ organizationId: org!.id, name: 'Test League', slug: `test-league-${suffix()}`, ...overrides })
    .returning();
  return league!;
}

export async function seedPeriod(leagueId: number, overrides: Partial<typeof periods.$inferInsert> = {}) {
  const [period] = await db
    .insert(periods)
    .values({ leagueId, label: `2026-06-${suffix()}`, startsOn: '2026-06-01', endsOn: '2026-06-30', ...overrides })
    .returning();
  return period!;
}

export async function seedDealership(leagueId: number, name: string) {
  const [dealership] = await db.insert(dealerships).values({ leagueId, name }).returning();
  return dealership!;
}

export async function seedEmployee(
  leagueId: number,
  overrides: Partial<typeof employees.$inferInsert> & { name: string },
) {
  const [employee] = await db
    .insert(employees)
    .values({ leagueId, email: `${overrides.name.toLowerCase().replace(/\W+/g, '.')}.${suffix()}@example.test`, ...overrides })
    .returning();
  return employee!;
}

export async function seedCategory(
  leagueId: number,
  overrides: Partial<typeof categories.$inferInsert> & { key: string; scope: 'advisor' | 'manager' },
) {
  const [category] = await db
    .insert(categories)
    .values({ leagueId, label: overrides.key, unit: 'count', ...overrides })
    .returning();
  return category!;
}

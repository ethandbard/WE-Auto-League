import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// drizzle-kit bundles this file as CJS, so it can't share `src/env.ts` (which
// uses ESM-only `import.meta.url`). Reading the same .env directly keeps the
// two in sync without the coupling. See CLAUDE.md Gotchas.
config({ path: '../.env' });

const ssl = (process.env.PGSSL ?? 'false').toLowerCase() === 'true';

const url =
  process.env.DATABASE_URL ||
  `postgres://${process.env.PGUSER ?? 'postgres'}${process.env.PGPASSWORD ? `:${process.env.PGPASSWORD}` : ''}@${
    process.env.PGHOST ?? 'localhost'
  }:${process.env.PGPORT ?? '5432'}/${process.env.PGDATABASE ?? 'we_auto_league'}`;

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url,
    ssl: ssl ? { rejectUnauthorized: false } : false,
  },
  verbose: true,
  strict: true,
});

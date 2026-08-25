import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { db, pool } from './client.js';

const here = dirname(fileURLToPath(import.meta.url));

// Path is relative to this file so it works from tsx (src/db) and from the
// compiled image (dist/db), whose CWD is /app — not server/.
await migrate(db, { migrationsFolder: resolve(here, '../../drizzle') });
console.log('[db:migrate] up to date');
await pool.end();

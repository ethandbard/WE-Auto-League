import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

await migrate(db, { migrationsFolder: './drizzle' });
console.log('[db:migrate] up to date');
await pool.end();

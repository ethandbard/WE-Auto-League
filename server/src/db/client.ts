import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../env.js';
import * as schema from './schema.js';

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('[db] idle client error', err);
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
/** The handle drizzle hands to a `db.transaction` callback. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/**
 * Anything that can run a query. A write that must roll back with its audit
 * row passes the open transaction where a caller would otherwise pass `db`.
 */
export type Executor = Database | Transaction;

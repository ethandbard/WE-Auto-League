// Connects to the `postgres` maintenance database and issues CREATE DATABASE
// for the app database, so a fresh machine doesn't have to do it by hand.
import pg from 'pg';
import { env } from '../env.js';

const url = new URL(env.databaseUrl);
const dbName = url.pathname.replace(/^\//, '');
url.pathname = '/postgres';

const client = new pg.Client({
  connectionString: url.toString(),
  ssl: env.dbSsl ? { rejectUnauthorized: false } : false,
});

await client.connect();
const { rows } = await client.query('select 1 from pg_database where datname = $1', [dbName]);
if (rows.length === 0) {
  await client.query(`CREATE DATABASE "${dbName}"`);
  console.log(`[db:create] created database "${dbName}"`);
} else {
  console.log(`[db:create] database "${dbName}" already exists`);
}
await client.end();

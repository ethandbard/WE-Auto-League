import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The single .env lives at the repo root, one level above `server/`.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../.env') });

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) throw new Error(`Environment variable ${name} must be an integer.`);
  return parsed;
}

function connectionStringFromParts(): string {
  const host = required('PGHOST', 'localhost');
  const port = int('PGPORT', 5432);
  const database = required('PGDATABASE', 'we_auto_league');
  const user = required('PGUSER', 'postgres');
  const password = process.env.PGPASSWORD ?? '';
  const auth = password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}` : encodeURIComponent(user);
  return `postgres://${auth}@${host}:${port}/${database}`;
}

export const env = {
  databaseUrl: process.env.DATABASE_URL || connectionStringFromParts(),
  /** Azure/managed Postgres requires TLS; local dev servers usually do not. */
  dbSsl: (process.env.PGSSL ?? 'false').toLowerCase() === 'true',
  port: int('API_PORT', int('PORT', 4000)),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  authSecret: process.env.AUTH_SECRET || 'dev-only-change-me',
  authSessionDays: int('AUTH_SESSION_DAYS', 30),
  cfEmailAccountId: process.env.CF_EMAIL_ACCOUNT_ID ?? '',
  cfEmailApiToken: process.env.CF_EMAIL_API_TOKEN ?? '',
  cfEmailFrom: process.env.CF_EMAIL_FROM || 'standings@auto.ethandbard.com',
} as const;

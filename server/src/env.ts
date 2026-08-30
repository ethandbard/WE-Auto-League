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

/** The shipped placeholder. Usable in dev; a boot failure in production. */
export const DEFAULT_AUTH_SECRET = 'dev-only-change-me';

/** Only the fields the production guard inspects, so it can be called with a literal in tests. */
export interface BootConfig {
  nodeEnv: string;
  authProvider: 'session' | 'cloudflare-access';
  authSecret: string;
  cfAccessTeamDomain: string;
  cfAccessAud: string;
}

/**
 * Settings that are fine locally but unsafe in production: a guessable session
 * secret, or Access mode with nothing to verify the Access JWT against. Pure,
 * so `server/test/security.test.ts` can pin it.
 */
export function productionConfigErrors(cfg: BootConfig): string[] {
  if (cfg.nodeEnv !== 'production') return [];
  const errors: string[] = [];
  if (!cfg.authSecret || cfg.authSecret === DEFAULT_AUTH_SECRET) {
    errors.push('AUTH_SECRET is unset or still the shipped default. Set it to a long random string.');
  }
  if (cfg.authProvider === 'cloudflare-access') {
    if (!cfg.cfAccessTeamDomain) {
      errors.push('CF_ACCESS_TEAM_DOMAIN is required when AUTH_PROVIDER=cloudflare-access (e.g. https://ethandbard.cloudflareaccess.com).');
    }
    if (!cfg.cfAccessAud) {
      errors.push('CF_ACCESS_AUD is required when AUTH_PROVIDER=cloudflare-access (the Access app\'s Application Audience tag).');
    }
  }
  return errors;
}

export function assertProductionConfig(cfg: BootConfig): void {
  const errors = productionConfigErrors(cfg);
  if (errors.length > 0) {
    throw new Error(`Refusing to start in production:\n  - ${errors.join('\n  - ')}`);
  }
}

export const env = {
  databaseUrl: process.env.DATABASE_URL || connectionStringFromParts(),
  /** Azure/managed Postgres requires TLS; local dev servers usually do not. */
  dbSsl: (process.env.PGSSL ?? 'false').toLowerCase() === 'true',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int('API_PORT', int('PORT', 4000)),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:5173',
  authSecret: process.env.AUTH_SECRET || DEFAULT_AUTH_SECRET,
  authSessionDays: int('AUTH_SESSION_DAYS', 30),
  authProvider: (process.env.AUTH_PROVIDER ?? 'session') === 'cloudflare-access' ? 'cloudflare-access' : 'session',
  /** Access team domain, e.g. https://ethandbard.cloudflareaccess.com — also the Access JWT's `iss`. */
  cfAccessTeamDomain: process.env.CF_ACCESS_TEAM_DOMAIN ?? '',
  /** The Access app's Application Audience (AUD) tag — the JWT's `aud`. */
  cfAccessAud: process.env.CF_ACCESS_AUD ?? '',
  /** Explicit transport choice. Empty means auto-detect from whichever credential is set — see email/send.ts. */
  emailProvider: (process.env.EMAIL_PROVIDER ?? '').toLowerCase(),
  /** Shared by every transport. CF_EMAIL_FROM is the pre-Resend name, still honoured. */
  emailFrom: process.env.EMAIL_FROM || process.env.CF_EMAIL_FROM || 'standings@mail.auto.ethandbard.com',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  cfEmailAccountId: process.env.CF_EMAIL_ACCOUNT_ID ?? '',
  cfEmailApiToken: process.env.CF_EMAIL_API_TOKEN ?? '',
} as const;

assertProductionConfig(env);

// Cloudflare Access JWT verification. Access authenticates in front of the
// app, but the origin is a plain HTTP service on the tunnel's other end —
// anything that reaches it can set the identity header itself. The signed
// `Cf-Access-Jwt-Assertion` is what actually proves who is calling.
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { env } from './env.js';

/** `https://<team>.cloudflareaccess.com`, no trailing slash — this is also the JWT's `iss`. */
export function normalizeTeamDomain(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Where the team's rotating RS256 public keys live. */
export function accessCertsUrl(teamDomain: string): string {
  return `${normalizeTeamDomain(teamDomain)}/cdn-cgi/access/certs`;
}

/**
 * The email a verified payload identifies. `exp` is required rather than
 * merely validated-if-present: a token with no expiry would never age out.
 * A service-token assertion carries no email and resolves to nobody.
 */
export function emailFromPayload(payload: JWTPayload): string | null {
  if (typeof payload.exp !== 'number') return null;
  const email = payload.email;
  return typeof email === 'string' && email.length > 0 ? email : null;
}

/** True once both Access vars are set. env.ts refuses to boot without them in production. */
export function accessVerificationConfigured(): boolean {
  return Boolean(env.cfAccessTeamDomain && env.cfAccessAud);
}

// createRemoteJWKSet caches the key set and refetches on an unknown `kid`, so
// this is built once and reused rather than per request.
let keySet: ReturnType<typeof createRemoteJWKSet> | null = null;
function accessKeySet() {
  if (!keySet) keySet = createRemoteJWKSet(new URL(accessCertsUrl(env.cfAccessTeamDomain)));
  return keySet;
}

/** Verifies signature, issuer, audience, and expiry. Returns null — with a log line — on any failure. */
export async function verifiedAccessEmail(assertion: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(assertion, accessKeySet(), {
      issuer: normalizeTeamDomain(env.cfAccessTeamDomain),
      audience: env.cfAccessAud,
      algorithms: ['RS256'],
    });
    return emailFromPayload(payload);
  } catch (err) {
    console.warn('[auth] Cloudflare Access JWT rejected:', err instanceof Error ? err.message : err);
    return null;
  }
}

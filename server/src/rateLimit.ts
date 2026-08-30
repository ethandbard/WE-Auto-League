// Rate limits for the /api surface. Strict on the two unauthenticated auth
// endpoints — a magic link is an email send and a token guess — and moderate
// on everything else.
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, Response } from 'express';

/** Just the parts of a request the key needs, so this is callable with a literal in tests. */
type IpSource = Pick<Request, 'headers'> & { ip?: string };

/**
 * cloudflared hands the origin the browser's address in CF-Connecting-IP.
 * Express `trust proxy` stays off (see index.ts), so `req.ip` is the socket
 * address and no client can claim a different bucket through X-Forwarded-For.
 * CF-Connecting-IP is trusted only because the origin is reachable through the
 * tunnel alone; anything with direct network access to the origin could forge
 * it, which is a network exposure this function cannot close.
 * IPv6 is bucketed by /56 — one subscriber line, not one address.
 */
export function clientIpKey(req: IpSource): string {
  const header = req.headers['cf-connecting-ip'];
  const forwarded = (Array.isArray(header) ? header[0] : header)?.trim();
  return ipKeyGenerator(forwarded || req.ip || 'unknown');
}

function limiter(options: { windowMs: number; limit: number; message: string }) {
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.limit,
    keyGenerator: clientIpKey,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // `trust proxy` off plus a header-derived key is the deliberate setup
    // described above; without this, both checks warn on every request.
    validate: { xForwardedForHeader: false, keyGeneratorIpFallback: false },
    // Match the app's error shape: { error: string }.
    handler: (_req: Request, res: Response) => {
      res.status(429).json({ error: options.message });
    },
  });
}

export const authRequestLinkLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  message: 'Too many sign-in link requests. Try again in a few minutes.',
});

export const authVerifyLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many sign-in attempts. Try again in a few minutes.',
});

export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 300,
  message: 'Too many requests. Slow down and try again shortly.',
});

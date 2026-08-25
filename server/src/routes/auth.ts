import { Router } from 'express';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees } from '../db/schema.js';
import { asyncHandler, badRequest } from '../http.js';
import { issueMagicLink, consumeMagicLink, revokeSession, parseCookies, SESSION_COOKIE } from '../auth.js';
import { env } from '../env.js';
import { sendMagicLinkEmail } from '../email/send.js';

export const authRouter = Router();

const requestLinkSchema = z.object({ email: z.string().email() });

authRouter.post(
  '/request-link',
  asyncHandler(async (req, res) => {
    const { email } = requestLinkSchema.parse(req.body);
    const [employee] = await db.select().from(employees).where(eq(employees.email, email)).limit(1);
    // Always 200, whether or not the email is registered — don't leak the roster by timing/response shape.
    if (employee && !employee.archivedAt) {
      const { token, url } = await issueMagicLink(employee.id);
      if (process.env.NODE_ENV === 'production') {
        await sendMagicLinkEmail(employee.leagueId, employee.email, url);
      } else {
        // Dev convenience: no email transport is configured locally, so hand the link back directly.
        console.log(`[auth] magic link for ${email}: ${url}`);
        res.json({ ok: true, devLink: url, devToken: token });
        return;
      }
    }
    res.json({ ok: true });
  }),
);

const verifySchema = z.object({ token: z.string().min(10) });

authRouter.post(
  '/verify',
  asyncHandler(async (req, res) => {
    const { token } = verifySchema.parse(req.body);
    const result = await consumeMagicLink(token);
    if (!result) throw badRequest('This link is invalid or has expired. Request a new one.');
    res.cookie(SESSION_COOKIE, result.sessionToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: env.authSessionDays * 24 * 60 * 60 * 1000,
      path: '/',
    });
    res.json({ actor: result.actor });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) await revokeSession(token);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ actor: req.actor ?? null });
  }),
);

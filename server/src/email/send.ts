// Every send carries an idempotency key of (template, period, recipient) that
// email_log enforces via a unique index — see CLAUDE.md. Call sendOnce, never
// the transport directly, so a re-fired scheduler job is a no-op rather than
// a duplicate standings email, and so the league's pause switch and
// per-template toggles are enforced in one place.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailLog, leagues } from '../db/schema.js';
import { env } from '../env.js';
import { suppressionFor, type EmailGateSettings, type SuppressionReason } from './overrides.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<{ providerMessageId: string | null }>;
}

/**
 * Cloudflare Email Sending, REST API. Endpoint is `.../email/sending/send`
 * (not `.../email/send`); the response carries delivery status, not a
 * message id — `{result: {delivered: string[], permanent_bounces: string[],
 * queued: string[]}}`. A recipient landing in `permanent_bounces` is a
 * same-request failure (bad address), not a transient error, so it's treated
 * as `failed` rather than `sent`.
 */
class CloudflareEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.cfEmailAccountId}/email/sending/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.cfEmailApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare email send failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json().catch(() => null)) as { result?: { delivered?: string[]; permanent_bounces?: string[] } } | null;
    if (body?.result?.permanent_bounces?.length) {
      throw new Error(`Cloudflare email send bounced: ${body.result.permanent_bounces.join(', ')}`);
    }
    return { providerMessageId: null };
  }
}

/**
 * Resend, REST API. The production default: unlike Cloudflare Email Sending it
 * needs no Workers Paid plan and no sending-subdomain onboarding, and it is
 * generally available rather than in beta. Non-2xx bodies carry
 * `{name, message}`; a 2xx returns `{id}`, which is a real provider message id
 * — Cloudflare has none, so `email_log.providerMessageId` is only populated on
 * this transport.
 */
class ResendEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.emailFrom,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    const body = (await res.json().catch(() => null)) as { id?: string; name?: string; message?: string } | null;
    if (!res.ok) {
      throw new Error(`Resend send failed: ${res.status} ${body?.name ?? ''} ${body?.message ?? ''}`.trim());
    }
    return { providerMessageId: body?.id ?? null };
  }
}

/** Local dev / CI default when no provider credential is configured — logs instead of sending. */
class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    console.log(`[email:console] to=${message.to} subject="${message.subject}"`);
    return { providerMessageId: null };
  }
}

/**
 * EMAIL_PROVIDER pins a transport explicitly; otherwise the first configured
 * credential wins, Resend first. The explicit pin exists so a deployment with
 * both keys present (mid-migration) is not ambiguous.
 */
function selectTransport(): EmailTransport {
  switch (env.emailProvider) {
    case 'resend':
      return new ResendEmailTransport();
    case 'cloudflare':
      return new CloudflareEmailTransport();
    case 'console':
      return new ConsoleEmailTransport();
  }
  if (env.resendApiKey) return new ResendEmailTransport();
  if (env.cfEmailApiToken) return new CloudflareEmailTransport();
  return new ConsoleEmailTransport();
}

const transport: EmailTransport = selectTransport();

/**
 * The league's mail gate, read fresh per send so flipping the pause switch in
 * Admin takes effect on the next scheduler tick without a restart. An unknown
 * league suppresses rather than sends — the safe direction for a switch whose
 * whole job is to stop mail.
 */
async function gateSettingsFor(leagueId: number): Promise<EmailGateSettings> {
  const [league] = await db
    .select({ emailPaused: leagues.emailPaused, emailTemplatesEnabled: leagues.emailTemplatesEnabled })
    .from(leagues)
    .where(eq(leagues.id, leagueId))
    .limit(1);
  if (!league) return { emailPaused: true, templatesEnabled: {} };
  return { emailPaused: league.emailPaused, templatesEnabled: league.emailTemplatesEnabled ?? {} };
}

export interface SendOnceParams {
  leagueId: number;
  template: string;
  periodId?: number | null;
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * Skips the pause switch and the template toggles. Only for a send a person
   * just asked for by hand — Admin's send-test-to-me. Never set it from the
   * scheduler.
   */
  bypassPause?: boolean;
}

export type SendResult = 'sent' | 'already-sent' | 'failed' | 'suppressed';

/**
 * Returns 'sent' | 'already-sent' | 'failed' | 'suppressed'. Never throws for
 * a duplicate — that's the idempotency guarantee. A suppressed send still
 * writes its email_log row, so the log shows what would have gone out; the row
 * stays unsent, so the same key sends for real once mail resumes.
 */
export async function sendOnce(params: SendOnceParams): Promise<SendResult> {
  const idempotencyKey = `${params.template}:${params.periodId ?? 'none'}:${params.to}`;
  const [existing] = await db.select().from(emailLog).where(eq(emailLog.idempotencyKey, idempotencyKey)).limit(1);
  if (existing && existing.status === 'sent') return 'already-sent';

  const suppression: SuppressionReason | null = suppressionFor(
    params.template,
    await gateSettingsFor(params.leagueId),
    params.bypassPause ?? false,
  );
  const status = suppression ? ('suppressed' as const) : ('queued' as const);

  const [logRow] = existing
    ? await db.update(emailLog).set({ status }).where(eq(emailLog.id, existing.id)).returning()
    : await db
        .insert(emailLog)
        .values({
          leagueId: params.leagueId,
          template: params.template,
          periodId: params.periodId ?? null,
          recipientEmail: params.to,
          idempotencyKey,
          status,
        })
        .returning();

  if (suppression) {
    console.log(`[email] suppressed (${suppression}) template=${params.template} to=${params.to}`);
    return 'suppressed';
  }

  try {
    const { providerMessageId } = await transport.send({ to: params.to, subject: params.subject, html: params.html, text: params.text });
    await db
      .update(emailLog)
      .set({ status: 'sent', sentAt: new Date(), providerMessageId })
      .where(eq(emailLog.id, logRow!.id));
    return 'sent';
  } catch (err) {
    console.error('[email] send failed', err);
    await db.update(emailLog).set({ status: 'failed' }).where(eq(emailLog.id, logRow!.id));
    return 'failed';
  }
}

/**
 * Bypasses the idempotency log: unlike a standings send, each magic-link
 * request must go out fresh, so `sendOnce`'s per-(template,period,recipient)
 * dedup — designed for the scheduler's period-scoped mail — is the wrong tool
 * here and would silently swallow every request after the first. Going around
 * sendOnce also exempts it from the league's pause switch, which is correct:
 * pausing league mail must not lock everybody out of signing in.
 */
export async function sendMagicLinkEmail(_leagueId: number, to: string, url: string): Promise<void> {
  await transport.send({
    to,
    subject: 'Your WE Auto League sign-in link',
    html: `<p>Click to sign in: <a href="${url}">${url}</a></p><p>This link expires in 15 minutes.</p>`,
    text: `Sign in: ${url}\n\nThis link expires in 15 minutes.`,
  });
}

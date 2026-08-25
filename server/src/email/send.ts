// Every send carries an idempotency key of (template, period, recipient) that
// email_log enforces via a unique index — see CLAUDE.md. Call sendOnce, never
// the transport directly, so a re-fired scheduler job is a no-op rather than
// a duplicate standings email.
import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailLog } from '../db/schema.js';
import { env } from '../env.js';

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
 * Cloudflare Email Sending, REST API. The exact request shape is Cloudflare's
 * to define and changes over their product's lifetime — this client targets
 * their account-scoped send endpoint and bearer-token auth, which is the
 * stable part of the contract. Verify the path/payload against current
 * Cloudflare docs before the first real Phase 8 send; nothing else in the app
 * depends on the shape, only on this function's return type.
 */
class CloudflareEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.cfEmailAccountId}/email/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.cfEmailApiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.cfEmailFrom,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
    });
    if (!res.ok) {
      throw new Error(`Cloudflare email send failed: ${res.status} ${await res.text()}`);
    }
    const body = (await res.json().catch(() => null)) as { result?: { id?: string } } | null;
    return { providerMessageId: body?.result?.id ?? null };
  }
}

/** Local dev / CI default when no Cloudflare token is configured — logs instead of sending. */
class ConsoleEmailTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<{ providerMessageId: string | null }> {
    console.log(`[email:console] to=${message.to} subject="${message.subject}"`);
    return { providerMessageId: null };
  }
}

const transport: EmailTransport = env.cfEmailApiToken ? new CloudflareEmailTransport() : new ConsoleEmailTransport();

export interface SendOnceParams {
  leagueId: number;
  template: string;
  periodId?: number | null;
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Returns 'sent' | 'already-sent' | 'failed'. Never throws for a duplicate — that's the idempotency guarantee. */
export async function sendOnce(params: SendOnceParams): Promise<'sent' | 'already-sent' | 'failed'> {
  const idempotencyKey = `${params.template}:${params.periodId ?? 'none'}:${params.to}`;
  const [existing] = await db.select().from(emailLog).where(eq(emailLog.idempotencyKey, idempotencyKey)).limit(1);
  if (existing && existing.status === 'sent') return 'already-sent';

  const [logRow] = existing
    ? await db.update(emailLog).set({ status: 'queued' }).where(eq(emailLog.id, existing.id)).returning()
    : await db
        .insert(emailLog)
        .values({
          leagueId: params.leagueId,
          template: params.template,
          periodId: params.periodId ?? null,
          recipientEmail: params.to,
          idempotencyKey,
          status: 'queued',
        })
        .returning();

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
 * here and would silently swallow every request after the first.
 */
export async function sendMagicLinkEmail(_leagueId: number, to: string, url: string): Promise<void> {
  await transport.send({
    to,
    subject: 'Your WE Auto League sign-in link',
    html: `<p>Click to sign in: <a href="${url}">${url}</a></p><p>This link expires in 15 minutes.</p>`,
    text: `Sign in: ${url}\n\nThis link expires in 15 minutes.`,
  });
}

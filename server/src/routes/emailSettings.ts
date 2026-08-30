// Admin → Email's control surface: the league pause switch, the per-template
// toggles and timing, and the drafted subject/body overrides. Commissioner
// only — these decide whether 50-odd people get mail.
import { Router } from 'express';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailTemplateOverrides, leagues } from '../db/schema.js';
import { asyncHandler, badRequest, notFound } from '../http.js';
import { requireRole } from '../middleware.js';
import { currentLeague } from '../league.js';
import { writeAudit } from '../audit.js';
import { sendOnce } from '../email/send.js';
import {
  DEFAULT_DRAFTS,
  SAMPLE_PLACEHOLDERS,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATE_KEYS,
  TEMPLATE_LABELS,
  TEMPLATE_PLACEHOLDERS,
  isTemplateKey,
  placeholderNamesIn,
  renderDraft,
  type TemplateDraft,
  type TemplateKey,
} from '../email/overrides.js';

export const emailSettingsRouter = Router();
export const emailTemplatesRouter = Router();

interface EmailSettings {
  emailPaused: boolean;
  templatesEnabled: Record<TemplateKey, boolean>;
  reminderLeadHours: number;
  autoMailStandingsOnPublish: boolean;
}

/** An absent key in the stored jsonb means enabled — normalise to all four for the client. */
function settingsFrom(league: {
  emailPaused: boolean;
  emailTemplatesEnabled: Record<string, boolean>;
  reminderLeadHours: number;
  autoMailStandingsOnPublish: boolean;
}): EmailSettings {
  const templatesEnabled = {} as Record<TemplateKey, boolean>;
  for (const key of TEMPLATE_KEYS) templatesEnabled[key] = league.emailTemplatesEnabled?.[key] !== false;
  return {
    emailPaused: league.emailPaused,
    templatesEnabled,
    reminderLeadHours: league.reminderLeadHours,
    autoMailStandingsOnPublish: league.autoMailStandingsOnPublish,
  };
}

emailSettingsRouter.get(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    res.json({ settings: settingsFrom(league) });
  }),
);

const settingsSchema = z.object({
  emailPaused: z.boolean(),
  templatesEnabled: z.record(z.boolean()),
  /** Capped at a week: a longer lead would fire before the previous window even closed. */
  reminderLeadHours: z.number().int().min(1).max(168),
  autoMailStandingsOnPublish: z.boolean(),
});

emailSettingsRouter.put(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const body = settingsSchema.parse(req.body);
    const unknown = Object.keys(body.templatesEnabled).filter((k) => !isTemplateKey(k));
    if (unknown.length) throw badRequest(`Unknown template key: ${unknown.join(', ')}`);

    const league = await currentLeague();
    const [after] = await db
      .update(leagues)
      .set({
        emailPaused: body.emailPaused,
        emailTemplatesEnabled: body.templatesEnabled,
        reminderLeadHours: body.reminderLeadHours,
        autoMailStandingsOnPublish: body.autoMailStandingsOnPublish,
      })
      .where(eq(leagues.id, league.id))
      .returning();

    await writeAudit({
      actor: req.actor ?? null,
      leagueId: league.id,
      action: 'email_settings.update',
      entityType: 'league',
      entityId: league.id,
      before: settingsFrom(league),
      after: settingsFrom(after!),
    });
    res.json({ settings: settingsFrom(after!) });
  }),
);

// --------------------------------------------------------------- templates --

function parseKey(raw: unknown): TemplateKey {
  if (typeof raw !== 'string' || !isTemplateKey(raw)) throw notFound('Unknown email template');
  return raw;
}

async function overrideRow(leagueId: number, key: TemplateKey) {
  const [row] = await db
    .select()
    .from(emailTemplateOverrides)
    .where(and(eq(emailTemplateOverrides.leagueId, leagueId), eq(emailTemplateOverrides.templateKey, key)))
    .limit(1);
  return row ?? null;
}

emailTemplatesRouter.get(
  '/',
  requireRole('commissioner'),
  asyncHandler(async (_req, res) => {
    const league = await currentLeague();
    const rows = await db.select().from(emailTemplateOverrides).where(eq(emailTemplateOverrides.leagueId, league.id));
    const settings = settingsFrom(league);
    res.json({
      templates: TEMPLATE_KEYS.map((key) => {
        const row = rows.find((r) => r.templateKey === key) ?? null;
        return {
          key,
          label: TEMPLATE_LABELS[key],
          description: TEMPLATE_DESCRIPTIONS[key],
          placeholders: TEMPLATE_PLACEHOLDERS[key],
          enabled: settings.templatesEnabled[key],
          defaultDraft: DEFAULT_DRAFTS[key],
          override: row ? { subject: row.subject, body: row.body, updatedAt: row.updatedAt } : null,
        };
      }),
    });
  }),
);

emailTemplatesRouter.get(
  '/:key',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const key = parseKey(req.params.key);
    const league = await currentLeague();
    const row = await overrideRow(league.id, key);
    res.json({
      template: {
        key,
        label: TEMPLATE_LABELS[key],
        description: TEMPLATE_DESCRIPTIONS[key],
        placeholders: TEMPLATE_PLACEHOLDERS[key],
        enabled: settingsFrom(league).templatesEnabled[key],
        defaultDraft: DEFAULT_DRAFTS[key],
        override: row ? { subject: row.subject, body: row.body, updatedAt: row.updatedAt } : null,
      },
    });
  }),
);

const draftSchema = z.object({
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(20_000),
});

/**
 * A placeholder the template cannot supply would ship to real recipients as a
 * literal `{{typo}}`, so it is rejected at save rather than left to the
 * preview to catch.
 */
function assertPlaceholdersKnown(draft: TemplateDraft, key: TemplateKey): void {
  const allowed = TEMPLATE_PLACEHOLDERS[key];
  const used = [...placeholderNamesIn(draft.subject), ...placeholderNamesIn(draft.body)];
  const unknown = [...new Set(used.filter((name) => !allowed.includes(name)))];
  if (unknown.length) {
    throw badRequest(`Unknown placeholder for ${key}: ${unknown.map((u) => `{{${u}}}`).join(', ')}. Available: ${allowed.join(', ')}`);
  }
}

emailTemplatesRouter.put(
  '/:key',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const key = parseKey(req.params.key);
    const draft = draftSchema.parse(req.body);
    assertPlaceholdersKnown(draft, key);

    const league = await currentLeague();
    const before = await overrideRow(league.id, key);
    const [after] = before
      ? await db
          .update(emailTemplateOverrides)
          .set({ subject: draft.subject, body: draft.body, updatedBy: req.actor!.employeeId, updatedAt: new Date() })
          .where(eq(emailTemplateOverrides.id, before.id))
          .returning()
      : await db
          .insert(emailTemplateOverrides)
          .values({
            leagueId: league.id,
            templateKey: key,
            subject: draft.subject,
            body: draft.body,
            updatedBy: req.actor!.employeeId,
          })
          .returning();

    await writeAudit({
      actor: req.actor ?? null,
      leagueId: league.id,
      action: 'email_template.update',
      entityType: 'email_template_override',
      entityId: after!.id,
      before,
      after,
    });
    res.json({ override: { subject: after!.subject, body: after!.body, updatedAt: after!.updatedAt } });
  }),
);

/** Reverts to the code default in email/templates.ts by dropping the row. */
emailTemplatesRouter.delete(
  '/:key',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const key = parseKey(req.params.key);
    const league = await currentLeague();
    const before = await overrideRow(league.id, key);
    if (!before) throw notFound('This template has no override to revert.');
    await db.delete(emailTemplateOverrides).where(eq(emailTemplateOverrides.id, before.id));
    await writeAudit({
      actor: req.actor ?? null,
      leagueId: league.id,
      action: 'email_template.revert',
      entityType: 'email_template_override',
      entityId: before.id,
      before,
    });
    res.json({ ok: true });
  }),
);

const previewSchema = draftSchema.partial();

/**
 * Renders with sample data. An unsaved draft in the body previews as typed, so
 * the editor can show the result before committing; with no body it previews
 * whatever would actually go out today (the saved override, else the default).
 */
async function draftToPreview(leagueId: number, key: TemplateKey, body: unknown) {
  const supplied = previewSchema.parse(body ?? {});
  if (supplied.subject != null && supplied.body != null) {
    const draft = { subject: supplied.subject, body: supplied.body };
    assertPlaceholdersKnown(draft, key);
    return { draft, source: 'draft' as const };
  }
  const row = await overrideRow(leagueId, key);
  return row
    ? { draft: { subject: row.subject, body: row.body }, source: 'override' as const }
    : { draft: DEFAULT_DRAFTS[key], source: 'default' as const };
}

emailTemplatesRouter.post(
  '/:key/preview',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const key = parseKey(req.params.key);
    const league = await currentLeague();
    const { draft, source } = await draftToPreview(league.id, key, req.body);
    res.json({ source, preview: renderDraft(draft, SAMPLE_PLACEHOLDERS[key]) });
  }),
);

/**
 * Sends the sample render to the acting commissioner's own address, bypassing
 * the pause switch: a person clicking this button is asking for exactly one
 * email to exactly themselves. The timestamped template string keeps the
 * idempotency key unique so a second test actually sends.
 */
emailTemplatesRouter.post(
  '/:key/test-send',
  requireRole('commissioner'),
  asyncHandler(async (req, res) => {
    const key = parseKey(req.params.key);
    const league = await currentLeague();
    const to = req.actor!.email;
    const { draft, source } = await draftToPreview(league.id, key, req.body);
    const rendered = renderDraft(draft, SAMPLE_PLACEHOLDERS[key]);

    const result = await sendOnce({
      leagueId: league.id,
      template: `test-send:${key}:${Date.now()}`,
      to,
      bypassPause: true,
      ...rendered,
    });

    await writeAudit({
      actor: req.actor ?? null,
      leagueId: league.id,
      action: 'email_template.test_send',
      entityType: 'email_template_override',
      after: { templateKey: key, to, source, result },
    });
    if (result === 'failed') throw badRequest('The transport rejected the test send. Check Recent sends and the server log.');
    res.json({ ok: true, to, source });
  }),
);

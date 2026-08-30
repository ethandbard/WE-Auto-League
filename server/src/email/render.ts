// Resolves a league's draft override for one template, falling back to the
// code default in templates.ts. Every caller of sendOnce that mails one of the
// four keyed templates goes through here, so an override reaches the scheduler
// and the manual "send now" path alike.
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailTemplateOverrides } from '../db/schema.js';
import { renderDraft, type PlaceholderMap, type RenderedEmail, type TemplateDraft, type TemplateKey } from './overrides.js';

/** The saved draft for this league + template, or null when the code default still ships. */
export async function draftFor(leagueId: number, key: TemplateKey): Promise<TemplateDraft | null> {
  const [row] = await db
    .select()
    .from(emailTemplateOverrides)
    .where(and(eq(emailTemplateOverrides.leagueId, leagueId), eq(emailTemplateOverrides.templateKey, key)))
    .limit(1);
  return row ? { subject: row.subject, body: row.body } : null;
}

/**
 * `fallback` is the code default, already rendered — computing it either way
 * costs nothing and keeps the default's conditional logic (the standings
 * personal line, say) in one place rather than duplicated as a draft.
 */
export async function renderLeagueEmail(
  leagueId: number,
  key: TemplateKey,
  placeholders: PlaceholderMap,
  fallback: RenderedEmail,
): Promise<RenderedEmail> {
  const draft = await draftFor(leagueId, key);
  return draft ? renderDraft(draft, placeholders) : fallback;
}

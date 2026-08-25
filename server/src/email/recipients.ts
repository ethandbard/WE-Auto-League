// CCs email_recipients rows onto the reminder / late-penalty / training-flag
// sends, mirroring what standingsMail.ts already does for the "standings"
// template. A row with dealershipId set only rides along for that store;
// null rides along for every send of that template league-wide.
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import { emailRecipients } from '../db/schema.js';
import { sendOnce, type SendOnceParams } from './send.js';

export type CcTemplate = 'reminder' | 'late-penalty' | 'training-flag';

export async function ccExtraRecipients(
  leagueId: number,
  ccTemplate: CcTemplate,
  dealershipId: number | null,
  send: Omit<SendOnceParams, 'to'>,
): Promise<void> {
  const rows = await db
    .select()
    .from(emailRecipients)
    .where(
      and(
        eq(emailRecipients.leagueId, leagueId),
        isNull(emailRecipients.revokedAt),
        dealershipId == null ? isNull(emailRecipients.dealershipId) : or(isNull(emailRecipients.dealershipId), eq(emailRecipients.dealershipId, dealershipId)),
      ),
    );
  for (const row of rows) {
    if (!row.templates.includes(ccTemplate)) continue;
    await sendOnce({ ...send, to: row.email });
  }
}

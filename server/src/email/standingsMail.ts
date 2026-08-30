import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { employees, emailRecipients, leagues } from '../db/schema.js';
import { env } from '../env.js';
import { fullStandingsFor, type DecoratedScore } from '../scoring/standings.js';
import { sendOnce, type SendResult } from './send.js';
import { standingsEmail, rankingTableHtml, rankingTableText, type RankingRow } from './templates.js';
import { renderLeagueEmail } from './render.js';

export interface MailStandingsResult {
  recipientCount: number;
  sent: number;
  alreadySent: number;
  failed: number;
  /** Stopped by the league pause switch or the standings toggle — see email/send.ts. */
  suppressed: number;
}

function rankingFrom(rows: DecoratedScore[]): RankingRow[] {
  return rows.map((r) => ({
    position: r.position,
    name: r.employeeName ?? 'Unknown',
    dealershipName: r.dealershipName,
    total: Number(r.total),
  }));
}

function tally(result: MailStandingsResult, status: SendResult) {
  result.recipientCount += 1;
  if (status === 'sent') result.sent += 1;
  else if (status === 'already-sent') result.alreadySent += 1;
  else if (status === 'suppressed') result.suppressed += 1;
  else result.failed += 1;
}

/**
 * Mails standings for one published period. Idempotent per (template, period,
 * recipient) via sendOnce — a scheduler tick and a manual "send now" share
 * the same keys, so a second pass is a no-op for already-delivered copies.
 *
 * Sends: each advisor their row + full advisor board; each manager their row
 * + full manager board; each store manager a copy of the advisor board; any
 * extra recipients subscribed to "standings" both boards (no personal row).
 */
export async function mailStandingsForPeriod(periodId: number): Promise<MailStandingsResult> {
  const counts: MailStandingsResult = { recipientCount: 0, sent: 0, alreadySent: 0, failed: 0, suppressed: 0 };
  const standings = await fullStandingsFor(periodId);
  const { period } = standings;
  const [league] = await db.select().from(leagues).where(eq(leagues.id, period.leagueId)).limit(1);
  if (!league) return counts;
  const leagueId = league.id;

  const advisorRanking = rankingFrom(standings.advisors);
  const managerRanking = rankingFrom(standings.managers);
  const standingsUrl = `${env.appBaseUrl}/standings`;

  async function sendBoard(
    to: string,
    scope: 'advisor' | 'manager',
    recipientName: string,
    row: DecoratedScore | null,
    ranking: RankingRow[],
  ) {
    const data = {
      periodLabel: period.label,
      recipientName,
      position: row?.position ?? null,
      total: row ? Number(row.total) : null,
      scope,
      dealershipName: row?.dealershipName ?? null,
      standingsUrl,
      ranking,
    };
    const board = scope === 'advisor' ? 'Service Advisor Ranking' : 'Manager Ranking';
    const personal =
      data.position != null && data.total != null
        ? {
            text: ` You finished #${data.position} at ${data.total.toFixed(2)} points${data.dealershipName ? `, representing ${data.dealershipName}` : ''}.`,
            html: ` You finished <strong>#${data.position}</strong> at <strong>${data.total.toFixed(2)}</strong> points${data.dealershipName ? `, representing ${data.dealershipName}` : ''}.`,
          }
        : { text: '', html: '' };
    const tpl = await renderLeagueEmail(
      leagueId,
      'standings',
      {
        recipientName,
        periodLabel: period.label,
        board,
        position: data.position != null ? `#${data.position}` : '—',
        total: data.total != null ? data.total.toFixed(2) : '—',
        dealershipName: data.dealershipName ?? '',
        personalLine: personal,
        rankingTable: { text: rankingTableText(ranking), html: rankingTableHtml(ranking) },
        standingsUrl,
      },
      standingsEmail(data),
    );
    const status = await sendOnce({
      leagueId,
      template: `standings:${scope}`,
      periodId: period.id,
      to,
      ...tpl,
    });
    tally(counts, status);
  }

  for (const row of standings.advisors) {
    if (row.employeeId == null) continue;
    const [employee] = await db.select().from(employees).where(eq(employees.id, row.employeeId)).limit(1);
    if (!employee) continue;
    await sendBoard(employee.email, 'advisor', employee.alias ?? employee.name, row, advisorRanking);
  }

  for (const row of standings.managers) {
    if (row.employeeId == null) continue;
    const [employee] = await db.select().from(employees).where(eq(employees.id, row.employeeId)).limit(1);
    if (!employee) continue;
    await sendBoard(employee.email, 'manager', employee.alias ?? employee.name, row, managerRanking);
  }

  const storeManagers = await db
    .select()
    .from(employees)
    .where(and(eq(employees.leagueId, leagueId), eq(employees.role, 'manager'), isNull(employees.archivedAt)));
  for (const manager of storeManagers) {
    await sendBoard(manager.email, 'advisor', manager.alias ?? manager.name, null, advisorRanking);
  }

  const extras = await db
    .select()
    .from(emailRecipients)
    .where(and(eq(emailRecipients.leagueId, leagueId), isNull(emailRecipients.revokedAt)));
  for (const extra of extras) {
    if (!extra.templates.includes('standings')) continue;
    await sendBoard(extra.email, 'advisor', extra.label, null, advisorRanking);
    await sendBoard(extra.email, 'manager', extra.label, null, managerRanking);
  }

  return counts;
}

export interface StandingsEmailData {
  periodLabel: string;
  recipientName: string;
  position: number;
  total: number;
  scope: 'advisor' | 'manager';
  dealershipName: string;
  standingsUrl: string;
}

export function standingsEmail(d: StandingsEmailData): { subject: string; html: string; text: string } {
  const board = d.scope === 'advisor' ? 'Service Advisor Ranking' : 'Manager Ranking';
  const subject = `${d.periodLabel} standings: you finished #${d.position}`;
  const html = `
    <p>Hi ${d.recipientName},</p>
    <p>The ${d.periodLabel} ${board} is final. You finished <strong>#${d.position}</strong> at <strong>${d.total.toFixed(2)}</strong> points, representing ${d.dealershipName}.</p>
    <p><a href="${d.standingsUrl}">View the full standings</a></p>
  `.trim();
  const text = `Hi ${d.recipientName},\n\nThe ${d.periodLabel} ${board} is final. You finished #${d.position} at ${d.total.toFixed(2)} points, representing ${d.dealershipName}.\n\nView the full standings: ${d.standingsUrl}`;
  return { subject, html, text };
}

export interface ReminderEmailData {
  recipientName: string;
  dealershipName: string;
  cutoffLocal: string;
  entryUrl: string;
}

export function reminderEmail(d: ReminderEmailData): { subject: string; html: string; text: string } {
  const subject = `Reminder: ${d.dealershipName}'s numbers are due ${d.cutoffLocal}`;
  const html = `
    <p>Hi ${d.recipientName},</p>
    <p>${d.dealershipName} hasn't filed this window's numbers yet. The cutoff is <strong>${d.cutoffLocal}</strong> — a miss costs the store points.</p>
    <p><a href="${d.entryUrl}">File now</a></p>
  `.trim();
  const text = `Hi ${d.recipientName},\n\n${d.dealershipName} hasn't filed this window's numbers yet. The cutoff is ${d.cutoffLocal} — a miss costs the store points.\n\nFile now: ${d.entryUrl}`;
  return { subject, html, text };
}

export interface LatePenaltyEmailData {
  recipientName: string;
  dealershipName: string;
  windowDate: string;
  penaltyValue: number;
}

export function latePenaltyEmail(d: LatePenaltyEmailData): { subject: string; html: string; text: string } {
  const subject = `${d.dealershipName} missed the ${d.windowDate} submission window`;
  const html = `<p>Hi ${d.recipientName},</p><p>${d.dealershipName} did not file by the ${d.windowDate} cutoff. A <strong>-${d.penaltyValue}</strong> point penalty has been applied.</p>`;
  const text = `Hi ${d.recipientName},\n\n${d.dealershipName} did not file by the ${d.windowDate} cutoff. A -${d.penaltyValue} point penalty has been applied.`;
  return { subject, html, text };
}

export interface TrainingFlagEmailData {
  recipientName: string;
  periodLabel: string;
  penaltyValue: number;
}

export function trainingFlagEmail(d: TrainingFlagEmailData): { subject: string; html: string; text: string } {
  const subject = `${d.periodLabel}: training criteria flagged`;
  const html = `<p>Hi ${d.recipientName},</p><p>Your training criteria was marked incomplete for ${d.periodLabel}. A <strong>-${d.penaltyValue}</strong> point penalty applies to your score.</p>`;
  const text = `Hi ${d.recipientName},\n\nYour training criteria was marked incomplete for ${d.periodLabel}. A -${d.penaltyValue} point penalty applies to your score.`;
  return { subject, html, text };
}

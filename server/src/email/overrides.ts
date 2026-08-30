// The pure half of the email controls: which sends are gated, and how a
// commissioner's draft becomes a rendered subject/html/text. No database and
// no transport here, so both halves are unit-testable — see
// test/emailControls.test.ts. The DB-facing halves are send.ts (the gate) and
// render.ts (override lookup).

export const TEMPLATE_KEYS = ['reminder', 'late-penalty', 'standings', 'training-flag'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export function isTemplateKey(value: string): value is TemplateKey {
  return (TEMPLATE_KEYS as readonly string[]).includes(value);
}

/**
 * `sendOnce`'s `template` carries a discriminator after the key — the window
 * date on a reminder, the board on a standings mail — because it is half of
 * the idempotency key. The part before the first colon is the template key,
 * which is what the toggles are stored against. Returns null for anything
 * outside the four scheduler templates (a test send, say), which the
 * per-template toggles then do not apply to.
 */
export function templateKeyFor(template: string): TemplateKey | null {
  const head = template.split(':')[0] ?? '';
  return isTemplateKey(head) ? head : null;
}

// ------------------------------------------------------------------- gate --

export interface EmailGateSettings {
  emailPaused: boolean;
  /** Absent key means enabled — only an explicit `false` disables a template. */
  templatesEnabled: Record<string, boolean>;
}

export type SuppressionReason = 'league-paused' | 'template-disabled';

/**
 * Whether a send should be suppressed rather than handed to the transport.
 * The league pause applies to everything funnelled through `sendOnce`, not
 * only the four keyed templates, so a future template cannot slip past it by
 * naming itself something new. `bypassPause` is for an explicit human action
 * (Admin's send-test-to-me), never for scheduled mail.
 */
export function suppressionFor(
  template: string,
  settings: EmailGateSettings,
  bypassPause = false,
): SuppressionReason | null {
  if (bypassPause) return null;
  if (settings.emailPaused) return 'league-paused';
  const key = templateKeyFor(template);
  if (key && settings.templatesEnabled[key] === false) return 'template-disabled';
  return null;
}

// --------------------------------------------------------------- rendering --

/**
 * A placeholder's value. A plain string is escaped for the HTML part and used
 * verbatim in the text part; the object form is for values that differ by
 * channel — the standings ranking, which is a `<table>` in one and an indented
 * list in the other.
 */
export type PlaceholderValue = string | { text: string; html: string };
export type PlaceholderMap = Record<string, PlaceholderValue>;

export interface TemplateDraft {
  subject: string;
  /** Plain text with `{{placeholder}}` markers. Blank lines separate paragraphs in the HTML part. */
  body: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

/** Every distinct placeholder name used in a draft, in first-seen order. */
export function placeholderNamesIn(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(PLACEHOLDER_RE)) {
    const name = match[1]!;
    if (!found.includes(name)) found.push(name);
  }
  return found;
}

/**
 * Substitutes `{{name}}` markers. An unknown name is left as its literal
 * marker rather than blanked, so a typo is visible in the preview instead of
 * silently deleting a sentence — `PUT /api/email-templates/:key` rejects one
 * before it can ever reach a real send.
 */
export function substitute(source: string, values: PlaceholderMap, channel: 'text' | 'html'): string {
  return source.replace(PLACEHOLDER_RE, (marker, name: string) => {
    const value = values[name];
    if (value === undefined) return marker;
    if (typeof value === 'string') return channel === 'html' ? escapeHtml(value) : value;
    return channel === 'html' ? value.html : value.text;
  });
}

/** Blank-line-separated paragraphs, single newlines as `<br />`. Applied to already-escaped text. */
function paragraphs(escaped: string): string {
  return escaped
    .split(/\n{2,}/)
    .map((block) => `<p>${block.trim().replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

/**
 * Renders a draft into all three parts. The body is escaped and paragraphed
 * *before* substitution, so a placeholder's HTML value lands as real markup
 * while the surrounding copy the commissioner typed cannot inject any.
 */
export function renderDraft(draft: TemplateDraft, values: PlaceholderMap): RenderedEmail {
  return {
    subject: substitute(draft.subject, values, 'text'),
    text: substitute(draft.body, values, 'text'),
    html: substitute(paragraphs(escapeHtml(draft.body)), values, 'html'),
  };
}

// ------------------------------------------------------ per-template facts --

/**
 * What each template offers a drafter, read off the `*EmailData` interfaces in
 * templates.ts. `PUT /api/email-templates/:key` rejects a draft naming
 * anything outside its list.
 */
export const TEMPLATE_PLACEHOLDERS: Record<TemplateKey, readonly string[]> = {
  reminder: ['recipientName', 'dealershipName', 'cutoffLocal', 'entryUrl'],
  'late-penalty': ['recipientName', 'dealershipName', 'windowDate', 'penaltyValue'],
  standings: [
    'recipientName',
    'periodLabel',
    'board',
    'position',
    'total',
    'dealershipName',
    'personalLine',
    'rankingTable',
    'standingsUrl',
  ],
  'training-flag': ['recipientName', 'periodLabel', 'penaltyValue'],
};

export const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  reminder: 'Pre-deadline reminder',
  'late-penalty': 'Late-submission penalty',
  standings: 'Published standings',
  'training-flag': 'Training criteria flagged',
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKey, string> = {
  reminder: 'Sent to a store manager who has not filed with the cutoff approaching.',
  'late-penalty': 'Sent to a store manager when the scheduler applies a missed-window penalty.',
  standings: 'Sent to every ranked advisor and manager once a period is published.',
  'training-flag': 'Sent to an advisor when a commissioner flags their training criteria.',
};

/**
 * What the draft editor offers as a starting point. This is a transcription of
 * the text part of templates.ts, not its source: the shipped default stays the
 * code function until somebody saves an override, so the two only need to
 * agree closely enough that starting from here is not a surprise.
 */
export const DEFAULT_DRAFTS: Record<TemplateKey, TemplateDraft> = {
  reminder: {
    subject: "Reminder: {{dealershipName}}'s numbers are due {{cutoffLocal}}",
    body: [
      'Hi {{recipientName}},',
      "{{dealershipName}} hasn't filed this window's numbers yet. The cutoff is {{cutoffLocal}} — a miss costs the store points.",
      'File now: {{entryUrl}}',
    ].join('\n\n'),
  },
  'late-penalty': {
    subject: '{{dealershipName}} missed the {{windowDate}} submission window',
    body: [
      'Hi {{recipientName}},',
      '{{dealershipName}} did not file by the {{windowDate}} cutoff. A -{{penaltyValue}} point penalty has been applied.',
    ].join('\n\n'),
  },
  standings: {
    subject: '{{periodLabel}} standings: {{board}}',
    body: [
      'Hi {{recipientName}},',
      'The {{periodLabel}} {{board}} is final.{{personalLine}}',
      '{{rankingTable}}',
      'View the full standings: {{standingsUrl}}',
    ].join('\n\n'),
  },
  'training-flag': {
    subject: '{{periodLabel}}: training criteria flagged',
    body: [
      'Hi {{recipientName}},',
      'Your training criteria was marked incomplete for {{periodLabel}}. A -{{penaltyValue}} point penalty applies to your score.',
    ].join('\n\n'),
  },
};

/** Stand-in values for the preview and the send-test-to-me action. */
export const SAMPLE_PLACEHOLDERS: Record<TemplateKey, PlaceholderMap> = {
  reminder: {
    recipientName: 'Sample Manager',
    dealershipName: 'Toyota PA',
    cutoffLocal: 'Monday, Jun 1, 12:00 PM PDT',
    entryUrl: 'https://auto.example.com/enter',
  },
  'late-penalty': {
    recipientName: 'Sample Manager',
    dealershipName: 'Toyota PA',
    windowDate: '2026-06-01',
    penaltyValue: '2',
  },
  standings: {
    recipientName: 'Sample Advisor',
    periodLabel: '2026-06',
    board: 'Service Advisor Ranking',
    position: '3',
    total: '96.42',
    dealershipName: 'Toyota PA',
    personalLine: {
      text: ' You finished #3 at 96.42 points, representing Toyota PA.',
      html: ' You finished <strong>#3</strong> at <strong>96.42</strong> points, representing Toyota PA.',
    },
    rankingTable: {
      text: '   1. Sample Advisor A (Toyota PA)  104.10\n   2. Sample Advisor B (Honda PA)  99.55\n   3. Sample Advisor (Toyota PA)  96.42',
      html:
        '<table style="border-collapse:collapse;margin-top:12px"><tbody>' +
        '<tr><td style="padding:4px 8px">#1</td><td style="padding:4px 8px">Sample Advisor A</td><td style="padding:4px 8px;text-align:right">104.10</td></tr>' +
        '<tr><td style="padding:4px 8px">#2</td><td style="padding:4px 8px">Sample Advisor B</td><td style="padding:4px 8px;text-align:right">99.55</td></tr>' +
        '<tr><td style="padding:4px 8px">#3</td><td style="padding:4px 8px">Sample Advisor</td><td style="padding:4px 8px;text-align:right">96.42</td></tr>' +
        '</tbody></table>',
    },
    standingsUrl: 'https://auto.example.com/standings',
  },
  'training-flag': {
    recipientName: 'Sample Advisor',
    periodLabel: '2026-06',
    penaltyValue: '25',
  },
};

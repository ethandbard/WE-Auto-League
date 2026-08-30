import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DRAFTS,
  SAMPLE_PLACEHOLDERS,
  TEMPLATE_PLACEHOLDERS,
  placeholderNamesIn,
  renderDraft,
  suppressionFor,
  templateKeyFor,
} from '../src/email/overrides.js';

const running = { emailPaused: false, templatesEnabled: {} };

test('the template key is the part of the idempotency template before the first colon', () => {
  assert.equal(templateKeyFor('reminder:2026-06-01'), 'reminder');
  assert.equal(templateKeyFor('late-penalty:2026-06-01'), 'late-penalty');
  assert.equal(templateKeyFor('standings:advisor'), 'standings');
  assert.equal(templateKeyFor('training-flag'), 'training-flag');
  assert.equal(templateKeyFor('test-send:reminder:1756500000000'), null);
});

test('the league pause suppresses every send, including a template the toggles do not name', () => {
  const paused = { emailPaused: true, templatesEnabled: {} };
  assert.equal(suppressionFor('standings:advisor', paused), 'league-paused');
  assert.equal(suppressionFor('reminder:2026-06-01', paused), 'league-paused');
  assert.equal(suppressionFor('something-new:2026-06', paused), 'league-paused');
});

test('a per-template toggle suppresses only its own template, and only when explicitly false', () => {
  const settings = { emailPaused: false, templatesEnabled: { reminder: false } };
  assert.equal(suppressionFor('reminder:2026-06-01', settings), 'template-disabled');
  assert.equal(suppressionFor('standings:advisor', settings), null);
  // An absent key means enabled — a template that ships later needs no backfill.
  assert.equal(suppressionFor('training-flag', running), null);
});

test('bypassPause is the only way past a pause, and it also clears a disabled template', () => {
  const paused = { emailPaused: true, templatesEnabled: { reminder: false } };
  assert.equal(suppressionFor('reminder:2026-06-01', paused, true), null);
  assert.equal(suppressionFor('reminder:2026-06-01', paused, false), 'league-paused');
});

test('an override substitutes placeholders into all three parts', () => {
  const rendered = renderDraft(
    { subject: 'Numbers due at {{cutoffLocal}}', body: 'Hi {{recipientName}},\n\nFile now: {{entryUrl}}' },
    { recipientName: 'Dana', cutoffLocal: 'noon', entryUrl: 'https://example.com/enter' },
  );
  assert.equal(rendered.subject, 'Numbers due at noon');
  assert.equal(rendered.text, 'Hi Dana,\n\nFile now: https://example.com/enter');
  assert.equal(rendered.html, '<p>Hi Dana,</p>\n<p>File now: https://example.com/enter</p>');
});

test('typed copy is escaped for the HTML part but a channel-specific value is not', () => {
  const rendered = renderDraft(
    { subject: 'x', body: 'Rankings for <b>everyone</b> & friends:\n\n{{rankingTable}}' },
    { rankingTable: { text: '  1. Dana  104.10', html: '<table><tr><td>1</td></tr></table>' } },
  );
  assert.match(rendered.html, /&lt;b&gt;everyone&lt;\/b&gt; &amp; friends/);
  assert.match(rendered.html, /<table><tr><td>1<\/td><\/tr><\/table>/);
  assert.equal(rendered.text, 'Rankings for <b>everyone</b> & friends:\n\n  1. Dana  104.10');
});

test('an unknown placeholder is left as its literal marker, never blanked', () => {
  const rendered = renderDraft({ subject: 'Hi {{nobody}}', body: 'Body {{nobody}}' }, { recipientName: 'Dana' });
  assert.equal(rendered.subject, 'Hi {{nobody}}');
  assert.equal(rendered.text, 'Body {{nobody}}');
});

test('single newlines become line breaks and blank lines become paragraphs', () => {
  const rendered = renderDraft({ subject: 's', body: 'one\ntwo\n\nthree' }, {});
  assert.equal(rendered.html, '<p>one<br />two</p>\n<p>three</p>');
});

test('every default draft uses only placeholders its template can supply, and the samples fill them all', () => {
  for (const [key, draft] of Object.entries(DEFAULT_DRAFTS)) {
    const allowed = TEMPLATE_PLACEHOLDERS[key as keyof typeof TEMPLATE_PLACEHOLDERS];
    const used = [...placeholderNamesIn(draft.subject), ...placeholderNamesIn(draft.body)];
    for (const name of used) {
      assert.ok(allowed.includes(name), `${key} default draft uses {{${name}}}, which it cannot supply`);
    }
    const rendered = renderDraft(draft, SAMPLE_PLACEHOLDERS[key as keyof typeof SAMPLE_PLACEHOLDERS]);
    assert.doesNotMatch(rendered.subject + rendered.text, /\{\{/, `${key} preview left an unsubstituted marker`);
  }
});

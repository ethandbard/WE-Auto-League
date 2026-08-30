import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { usePeriods } from '../../lib/usePeriods';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type {
  EmailLogRow,
  EmailPreview,
  EmailRecipient,
  EmailSettings,
  EmailTemplateKey,
  EmailTemplateSummary,
} from '../../lib/types';

const TEMPLATE_OPTIONS = [
  { id: 'standings', label: 'Standings' },
  { id: 'reminder', label: 'Reminders' },
  { id: 'late-penalty', label: 'Late penalty' },
  { id: 'training-flag', label: 'Training flag' },
] as const;

const INPUT = 'rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm';

function message(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * One template's card: enable toggle, draft editor, preview, and send-test.
 * The draft starts from the saved override, or from the built-in default so
 * there is something to edit rather than an empty box.
 */
function TemplateCard({
  template,
  paused,
  onToggle,
  onChanged,
}: {
  template: EmailTemplateSummary;
  paused: boolean;
  onToggle: (enabled: boolean) => void;
  onChanged: () => void;
}) {
  const start = template.override ?? template.defaultDraft;
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(start.subject);
  const [body, setBody] = useState(start.body);
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const next = template.override ?? template.defaultDraft;
    setSubject(next.subject);
    setBody(next.body);
  }, [template]);

  async function act(what: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await what());
    } catch (err) {
      setError(message(err, 'That did not work.'));
    } finally {
      setBusy(false);
    }
  }

  const save = () =>
    act(async () => {
      await api.put(`/api/email-templates/${template.key}`, { subject, body });
      onChanged();
      return 'Draft saved. It is now what this template sends.';
    });

  const revert = () =>
    act(async () => {
      await api.delete(`/api/email-templates/${template.key}`);
      onChanged();
      return 'Reverted to the built-in template.';
    });

  const runPreview = () =>
    act(async () => {
      setPreview(await api.post<EmailPreview>(`/api/email-templates/${template.key}/preview`, { subject, body }));
      return null;
    });

  const testSend = () =>
    act(async () => {
      const res = await api.post<{ to: string }>(`/api/email-templates/${template.key}/test-send`, { subject, body });
      onChanged();
      return `Test sent to ${res.to}.`;
    });

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-ink">{template.label}</h3>
          <p className="mt-0.5 text-sm text-ink-3">{template.description}</p>
          <p className="mt-1 text-xs text-ink-3">
            {template.override ? (
              <span className="text-brand">Custom draft, edited {formatDate(template.override.updatedAt)}</span>
            ) : (
              'Using the built-in template'
            )}
            {!template.enabled && <span className="ml-2 text-warn">· turned off</span>}
            {template.enabled && paused && <span className="ml-2 text-warn">· held by the pause switch</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-ink">
            <input type="checkbox" checked={template.enabled} onChange={(e) => onToggle(e.target.checked)} />
            Enabled
          </label>
          <Button variant="secondary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Close' : 'Edit draft'}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-hairline pt-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">Subject</span>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">Body — blank lines separate paragraphs</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} className={`${INPUT} font-mono`} />
          </label>
          <p className="text-xs text-ink-3">
            Placeholders:{' '}
            {template.placeholders.map((p) => (
              <code key={p} className="mr-1.5 rounded bg-surface-2 px-1 py-0.5 font-mono text-[11px] text-ink-2">{`{{${p}}}`}</code>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} disabled={busy || !subject || !body}>
              Save draft
            </Button>
            <Button variant="secondary" onClick={runPreview} disabled={busy}>
              Preview
            </Button>
            <Button variant="secondary" onClick={testSend} disabled={busy}>
              Send test to me
            </Button>
            {template.override && (
              <Button variant="danger" onClick={revert} disabled={busy}>
                Revert to default
              </Button>
            )}
          </div>
          {note && <p className="text-sm text-good">{note}</p>}
          {error && <p className="text-sm text-crit">{error}</p>}
          {preview && (
            <div className="rounded-md border border-hairline bg-surface-2 p-3">
              <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                Preview with sample data
              </p>
              <p className="mt-1 text-sm font-medium text-ink">{preview.preview.subject}</p>
              {/* The preview must render as the recipient sees it. renderDraft escapes the
                  drafted copy server-side, so the only markup here is the app's own. */}
              <div
                className="mt-2 rounded border border-hairline bg-surface p-3 text-sm text-ink"
                dangerouslySetInnerHTML={{ __html: preview.preview.html }}
              />
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export function EmailTab() {
  const { periods, selected: period, setSelectedId } = usePeriods();
  const settingsApi = useApi<{ settings: EmailSettings }>('/api/email-settings');
  const templatesApi = useApi<{ templates: EmailTemplateSummary[] }>('/api/email-templates');
  const { data, loading, error, refetch } = useApi<{ emailRecipients: EmailRecipient[] }>('/api/email-recipients');
  const { data: logData, refetch: refetchLog } = useApi<{ emailLog: EmailLogRow[] }>('/api/admin/email-log?pageSize=50');
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [templates, setTemplates] = useState<string[]>(['standings']);
  const [formError, setFormError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [leadHours, setLeadHours] = useState('2');
  const [autoStandings, setAutoStandings] = useState(true);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [timingSaved, setTimingSaved] = useState(false);

  const settings = settingsApi.data?.settings ?? null;

  useEffect(() => {
    if (!settings) return;
    setLeadHours(String(settings.reminderLeadHours));
    setAutoStandings(settings.autoMailStandingsOnPublish);
    setTimingSaved(false);
  }, [settings]);

  /** Every settings write is a full PUT, so a patch merges onto what was loaded. */
  async function saveSettings(patch: Partial<EmailSettings>) {
    if (!settings) return;
    setSettingsError(null);
    try {
      await api.put('/api/email-settings', { ...settings, ...patch });
      settingsApi.refetch();
      templatesApi.refetch();
    } catch (err) {
      setSettingsError(message(err, 'Could not save the email settings.'));
    }
  }

  function toggleTemplate(id: string) {
    setTemplates((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function addRecipient() {
    setFormError(null);
    try {
      await api.post('/api/email-recipients', { label, email, templates });
      setLabel('');
      setEmail('');
      setTemplates(['standings']);
      refetch();
    } catch (err) {
      setFormError(message(err, 'Could not add recipient.'));
    }
  }

  async function revoke(id: number) {
    await api.post(`/api/email-recipients/${id}/revoke`);
    refetch();
  }

  async function sendNow() {
    if (!period) return;
    if (!window.confirm(`Send standings for ${period.label} now? Already-delivered copies will be skipped.`)) return;
    setSending(true);
    setSendResult(null);
    try {
      const result = await api.post<{ recipientCount: number; sent: number; alreadySent: number; failed: number; suppressed: number }>(
        `/api/periods/${period.id}/mail-standings`,
      );
      setSendResult(
        `Sent ${result.sent}, already sent ${result.alreadySent}, suppressed ${result.suppressed}, failed ${result.failed} (${result.recipientCount} total).`,
      );
      refetchLog();
    } catch (err) {
      setSendResult(message(err, 'Send failed.'));
    } finally {
      setSending(false);
    }
  }

  const paused = settings?.emailPaused ?? false;

  return (
    <div className="space-y-8">
      <section>
        {settingsApi.loading && <Loading />}
        {settingsApi.error && <ErrorState message={settingsApi.error} onRetry={settingsApi.refetch} />}
        {settings && (
          <Card
            className={`flex flex-wrap items-center justify-between gap-3 border-2 p-4 ${
              paused ? 'border-warn/40 bg-warn-wash' : 'border-good/30 bg-good-wash'
            }`}
          >
            <div>
              <h2 className={`font-display text-sm font-semibold ${paused ? 'text-warn' : 'text-good'}`}>
                {paused ? 'Automated email is paused' : 'Automated email is running'}
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">
                {paused
                  ? 'Reminders, late-penalty notices, standings, and training flags are logged as suppressed instead of sent. Sign-in links still go out.'
                  : 'Every enabled template sends on schedule. Pause holds all of them at once.'}
              </p>
            </div>
            <Button variant={paused ? 'primary' : 'danger'} onClick={() => saveSettings({ emailPaused: !paused })}>
              {paused ? 'Resume sending' : 'Pause all sending'}
            </Button>
          </Card>
        )}
        {settingsError && <p className="mt-2 text-sm text-crit">{settingsError}</p>}
      </section>

      {settings && (
        <section>
          <h2 className="mb-2 font-display text-sm font-semibold text-ink">Timing</h2>
          <Card className="grid gap-4 p-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-2">Reminder lead time (hours before cutoff)</span>
              <input
                type="number"
                min={1}
                max={168}
                value={leadHours}
                onChange={(e) => {
                  setLeadHours(e.target.value);
                  setTimingSaved(false);
                }}
                className={`${INPUT} font-mono`}
              />
            </label>
            <label className="flex items-center gap-2 self-end pb-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={autoStandings}
                onChange={(e) => {
                  setAutoStandings(e.target.checked);
                  setTimingSaved(false);
                }}
              />
              Mail standings automatically once a period is published
            </label>
            <div className="flex items-center gap-3 sm:col-span-2">
              <Button
                onClick={async () => {
                  await saveSettings({ reminderLeadHours: Number(leadHours), autoMailStandingsOnPublish: autoStandings });
                  setTimingSaved(true);
                }}
                disabled={!leadHours}
              >
                Save timing
              </Button>
              {timingSaved && <span className="text-sm text-good">Saved.</span>}
              <span className="text-xs text-ink-3">"Send standings now" below works whether or not auto-mail is on.</span>
            </div>
          </Card>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold text-ink">Templates</h2>
        {templatesApi.loading && <Loading />}
        {templatesApi.error && <ErrorState message={templatesApi.error} onRetry={templatesApi.refetch} />}
        <div className="space-y-3">
          {(templatesApi.data?.templates ?? []).map((t) => (
            <TemplateCard
              key={t.key}
              template={t}
              paused={paused}
              onToggle={(enabled) =>
                settings &&
                saveSettings({
                  templatesEnabled: { ...settings.templatesEnabled, [t.key as EmailTemplateKey]: enabled },
                })
              }
              onChanged={() => {
                templatesApi.refetch();
                refetchLog();
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold text-ink">Send standings now</h2>
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className={INPUT}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.status})
              </option>
            ))}
          </select>
          <Button onClick={sendNow} disabled={sending || period?.status !== 'published'}>
            {sending ? 'Sending…' : 'Send standings now'}
          </Button>
          {period?.status !== 'published' && <span className="text-xs text-ink-3">Publish the period first.</span>}
          {paused && <span className="text-xs text-warn">Sending is paused — these will be logged as suppressed.</span>}
          {sendResult && <span className="text-sm text-ink-2">{sendResult}</span>}
        </Card>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold text-ink">Additional recipients</h2>
        {loading && <Loading />}
        {error && <ErrorState message={error} onRetry={refetch} />}
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Label</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Email</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Templates</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(data?.emailRecipients ?? []).map((r) => (
                <tr key={r.id} className={`border-b border-hairline last:border-0 ${r.revokedAt ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 text-ink">{r.label}</td>
                  <td className="px-3 py-2 text-ink-2">{r.email}</td>
                  <td className="px-3 py-2 text-ink-2">{r.templates.join(', ')}</td>
                  <td className="px-3 py-2 text-right">
                    {!r.revokedAt && (
                      <button onClick={() => revoke(r.id)} className="text-xs text-crit hover:underline">
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        {formError && <p className="mt-2 text-sm text-crit">{formError}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className={INPUT} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className={INPUT} />
          {TEMPLATE_OPTIONS.map((t) => (
            <label key={t.id} className="flex items-center gap-1 text-xs text-ink-2">
              <input type="checkbox" checked={templates.includes(t.id)} onChange={() => toggleTemplate(t.id)} />
              {t.label}
            </label>
          ))}
          <Button variant="secondary" onClick={addRecipient} disabled={!label || !email || templates.length === 0}>
            Add recipient
          </Button>
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-display text-sm font-semibold text-ink">Recent sends</h2>
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">When</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Template</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">To</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {(logData?.emailLog ?? []).map((row) => (
                <tr key={row.id} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 text-ink-3">{formatDate(row.sentAt ?? row.createdAt)}</td>
                  <td className="px-3 py-2 text-ink">{row.template}</td>
                  <td className="px-3 py-2 text-ink-2">{row.recipientEmail}</td>
                  <td className={`px-3 py-2 ${row.status === 'suppressed' ? 'text-warn' : row.status === 'failed' ? 'text-crit' : 'text-ink-2'}`}>
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

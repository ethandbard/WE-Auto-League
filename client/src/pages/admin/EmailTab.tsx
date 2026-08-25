import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { usePeriods } from '../../lib/usePeriods';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { EmailLogRow, EmailRecipient } from '../../lib/types';

const TEMPLATE_OPTIONS = [
  { id: 'standings', label: 'Standings' },
  { id: 'reminder', label: 'Reminders' },
  { id: 'late-penalty', label: 'Late penalty' },
  { id: 'training-flag', label: 'Training flag' },
] as const;

export function EmailTab() {
  const { periods, selected: period, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<{ emailRecipients: EmailRecipient[] }>('/api/email-recipients');
  const { data: logData, refetch: refetchLog } = useApi<{ emailLog: EmailLogRow[] }>('/api/admin/email-log?pageSize=50');
  const [label, setLabel] = useState('');
  const [email, setEmail] = useState('');
  const [templates, setTemplates] = useState<string[]>(['standings']);
  const [formError, setFormError] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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
      setFormError(err instanceof ApiError ? err.message : 'Could not add recipient.');
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
      const result = await api.post<{ recipientCount: number; sent: number; alreadySent: number; failed: number }>(
        `/api/periods/${period.id}/mail-standings`,
      );
      setSendResult(`Sent ${result.sent}, already sent ${result.alreadySent}, failed ${result.failed} (${result.recipientCount} total).`);
      refetchLog();
    } catch (err) {
      setSendResult(err instanceof ApiError ? err.message : 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-2 font-display text-sm font-semibold text-ink">Send standings now</h2>
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
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
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
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
                  <td className="px-3 py-2 text-ink-2">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}

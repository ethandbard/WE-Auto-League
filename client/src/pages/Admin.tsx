import { useState } from 'react';
import { usePeriods } from '../lib/usePeriods';
import { useApi } from '../lib/useApi';
import { api, ApiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card, Loading, ErrorState, Button } from '../components/ui';
import { formatDate } from '../lib/format';
import type { ApiKey } from '../lib/types';

interface Compliance {
  lateSubmissions: Array<{ dealershipId: number; windowDate: string; submittedAt: string }>;
  trainingFlags: Array<{ id: number; employeeId: number; value: string; reason: string }>;
  storeMinWarnings: Array<{ dealershipId: number; dealershipName: string; eligibleAdvisors: number; minimum: number }>;
  submittedStoreCount: number;
  totalStoreCount: number;
}

export function Admin() {
  const { periods, selected: period, setSelectedId, refetch: refetchPeriods } = usePeriods();
  const { data: compliance, loading, error, refetch } = useApi<Compliance>(period ? `/api/admin/compliance?periodId=${period.id}` : null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function runAction(action: 'recompute' | 'lock' | 'publish') {
    if (!period) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/api/periods/${period.id}/${action}`);
      refetchPeriods();
      refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Compliance & operations"
        actions={
          periods.length > 0 && (
            <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.status})
                </option>
              ))}
            </select>
          )
        }
      />

      {period && (
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <span className="text-sm text-ink-2">
            {period.label} is <span className="font-medium capitalize text-ink">{period.status}</span>
          </span>
          <Button variant="secondary" onClick={() => runAction('recompute')} disabled={busy}>
            Recompute
          </Button>
          <Button variant="secondary" onClick={() => runAction('lock')} disabled={busy || period.status !== 'open'}>
            Lock
          </Button>
          <Button onClick={() => runAction('publish')} disabled={busy || period.status === 'open' || period.status === 'published'}>
            Publish
          </Button>
          {actionError && <span className="text-xs text-crit">{actionError}</span>}
        </Card>
      )}

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {compliance && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">
              Filed this period ({compliance.submittedStoreCount}/{compliance.totalStoreCount} stores)
            </h2>
            <Card className="p-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">Missed windows</p>
              {compliance.lateSubmissions.length === 0 ? (
                <p className="text-sm text-ink-3">None on record.</p>
              ) : (
                <ul className="space-y-1 text-sm text-ink-2">
                  {compliance.lateSubmissions.map((s, i) => (
                    <li key={i}>
                      Store #{s.dealershipId} — window {s.windowDate}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section>
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Manager-eligibility warnings</h2>
            <Card className="p-4">
              {compliance.storeMinWarnings.length === 0 ? (
                <p className="text-sm text-ink-3">Every store meets the minimum.</p>
              ) : (
                <ul className="space-y-1 text-sm text-warn">
                  {compliance.storeMinWarnings.map((w) => (
                    <li key={w.dealershipId}>
                      {w.dealershipName}: {w.eligibleAdvisors} eligible, needs {w.minimum}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section className="lg:col-span-2">
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Training flags</h2>
            <Card className="p-4">
              {compliance.trainingFlags.length === 0 ? (
                <p className="text-sm text-ink-3">None on record.</p>
              ) : (
                <ul className="space-y-1 text-sm text-ink-2">
                  {compliance.trainingFlags.map((f) => (
                    <li key={f.id}>
                      Employee #{f.employeeId} — -{f.value} ({f.reason})
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </div>
      )}

      <ApiKeysSection />
    </div>
  );
}

function ApiKeysSection() {
  const { data, refetch } = useApi<{ apiKeys: ApiKey[] }>('/api/api-keys');
  const [name, setName] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);

  async function create() {
    const res = await api.post<{ key: string }>('/api/api-keys', { name, scopes: ['submit', 'read'] });
    setNewKey(res.key);
    setName('');
    refetch();
  }

  async function revoke(id: number) {
    await api.post(`/api/api-keys/${id}/revoke`);
    refetch();
  }

  return (
    <section>
      <h2 className="mb-2 font-display text-sm font-semibold text-ink">API keys (Phase 7 integration seam)</h2>
      {newKey && (
        <div className="mb-3 rounded-lg border border-warn/30 bg-warn-wash px-4 py-3 text-sm text-warn">
          Save this now — it won't be shown again: <code className="font-mono">{newKey}</code>
        </div>
      )}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline-strong bg-surface-2 text-left">
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Name</th>
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Scopes</th>
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Last used</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(data?.apiKeys ?? []).map((k) => (
              <tr key={k.id} className={`border-b border-hairline last:border-0 ${k.revokedAt ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 text-ink">{k.name}</td>
                <td className="px-3 py-2 text-ink-2">{k.scopes.join(', ')}</td>
                <td className="px-3 py-2 text-ink-3">{k.lastUsedAt ? formatDate(k.lastUsedAt) : 'never'}</td>
                <td className="px-3 py-2 text-right">
                  {!k.revokedAt && (
                    <button onClick={() => revoke(k.id)} className="text-xs text-crit hover:underline">
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <div className="mt-3 flex gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name (e.g. DMS import script)" className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
        <Button variant="secondary" onClick={create} disabled={!name}>
          Create key
        </Button>
      </div>
    </section>
  );
}

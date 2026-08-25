import { useState } from 'react';
import { usePeriods } from '../../lib/usePeriods';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';

interface Compliance {
  lateSubmissions: Array<{ dealershipId: number; windowDate: string; submittedAt: string }>;
  trainingFlags: Array<{ id: number; employeeId: number; value: string; reason: string }>;
  storeMinWarnings: Array<{ dealershipId: number; dealershipName: string; eligibleAdvisors: number; minimum: number }>;
  floaterWarnings: Array<{ employeeId: number; employeeName: string; consecutiveFloaterMonths: number }>;
  submittedStoreCount: number;
  totalStoreCount: number;
}

export function OverviewTab() {
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
    <div className="space-y-6">
      {periods.length > 0 && (
        <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} ({p.status})
            </option>
          ))}
        </select>
      )}

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

          <section>
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Floater warnings</h2>
            <Card className="p-4">
              {compliance.floaterWarnings.length === 0 ? (
                <p className="text-sm text-ink-3">No floater has written two consecutive months without a roster entry.</p>
              ) : (
                <ul className="space-y-1 text-sm text-warn">
                  {compliance.floaterWarnings.map((w) => (
                    <li key={w.employeeId}>
                      {w.employeeName}: {w.consecutiveFloaterMonths} consecutive months as a floater — roster them this month.
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          <section>
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
    </div>
  );
}

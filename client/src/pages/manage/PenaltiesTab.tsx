import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { usePeriods } from '../../lib/usePeriods';
import { useCurrentUser } from '../../lib/useCurrentUser';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import type { Dealership, Penalty } from '../../lib/types';

export function PenaltiesTab() {
  const { actor } = useCurrentUser();
  const { periods, selected: period, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<{ penalties: Penalty[] }>(period ? `/api/penalties?periodId=${period.id}` : null);
  const { data: dealershipsData } = useApi<{ dealerships: Dealership[] }>('/api/dealerships');
  const dealerships = dealershipsData?.dealerships ?? [];

  const [dealershipId, setDealershipId] = useState<number | ''>('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function addPenalty() {
    if (!period || !dealershipId) return;
    setFormError(null);
    try {
      await api.post('/api/penalties', { periodId: period.id, dealershipId, value: Number(value), reason });
      setValue('');
      setReason('');
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not add penalty.');
    }
  }

  async function removePenalty(id: number) {
    await api.delete(`/api/penalties/${id}`);
    refetch();
  }

  const dealershipName = (id: number | null) => dealerships.find((d) => d.id === id)?.alias ?? dealerships.find((d) => d.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Kind</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Store</th>
                <th className="px-3 py-2 text-right font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Value</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Reason</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.penalties.map((p) => (
                <tr key={p.id} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 capitalize text-ink-2">{p.kind.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-ink">{dealershipName(p.dealershipId)}</td>
                  <td className="px-3 py-2 text-right font-mono text-crit">-{p.value}</td>
                  <td className="px-3 py-2 text-ink-3">{p.reason}</td>
                  <td className="px-3 py-2 text-right">
                    {p.kind === 'manual' && actor?.role === 'commissioner' && (
                      <button onClick={() => removePenalty(p.id)} className="text-xs text-crit hover:underline">
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {data.penalties.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-ink-3">
                    No penalties this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}

      {actor?.role === 'commissioner' && (
        <Card className="max-w-md p-4">
          <p className="mb-2 font-display text-sm font-semibold text-ink">Manual penalty</p>
          <div className="space-y-2">
            <select value={dealershipId} onChange={(e) => setDealershipId(Number(e.target.value))} className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              <option value="">Select a store…</option>
              {dealerships.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.alias ?? d.name}
                </option>
              ))}
            </select>
            <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Points" className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
            {formError && <p className="text-xs text-crit">{formError}</p>}
            <Button variant="danger" onClick={addPenalty} disabled={!dealershipId || !value || !reason}>
              Apply penalty
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

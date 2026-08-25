import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { usePeriods } from '../../lib/usePeriods';
import { useCurrentUser } from '../../lib/useCurrentUser';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import type { Category, Dealership } from '../../lib/types';

export function GoalsTab() {
  const { actor } = useCurrentUser();
  const { data: dealershipsData } = useApi<{ dealerships: Dealership[] }>('/api/dealerships');
  const dealerships = dealershipsData?.dealerships ?? [];
  const { periods, selected: period, setSelectedId } = usePeriods();

  const [dealershipId, setDealershipId] = useState<number | null>(null);
  useEffect(() => {
    if (dealershipId !== null) return;
    if (actor?.dealershipId) setDealershipId(actor.dealershipId);
    else if (dealerships.length) setDealershipId(dealerships[0]!.id);
  }, [actor, dealerships, dealershipId]);

  const { data: categoriesData } = useApi<{ categories: Category[] }>('/api/categories');
  const advisorCategories = (categoriesData?.categories ?? []).filter((c) => c.scope === 'advisor');

  const { data: goalsData, loading, error, refetch } = useApi<{ goals: Array<{ categoryId: number; value: string }> }>(
    dealershipId && period ? `/api/goals?periodId=${period.id}&dealershipId=${dealershipId}` : null,
  );

  const [values, setValues] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!goalsData) return;
    setValues(Object.fromEntries(goalsData.goals.map((g) => [g.categoryId, g.value])));
  }, [goalsData]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function save() {
    if (!dealershipId || !period) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put('/api/goals', {
        dealershipId,
        periodId: period.id,
        values: Object.entries(values).filter(([, v]) => v !== '').map(([categoryId, value]) => ({ categoryId: Number(categoryId), value: Number(value) })),
      });
      refetch();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save goals.');
    } finally {
      setSaving(false);
    }
  }

  async function carryForward() {
    const fromLabel = window.prompt('Carry goals forward from which period label? (e.g. 2026-06)');
    const from = periods.find((p) => p.label === fromLabel);
    if (!from || !period) return;
    await api.post('/api/goals/carry-forward', { fromPeriodId: from.id, toPeriodId: period.id });
    refetch();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select value={dealershipId ?? ''} onChange={(e) => setDealershipId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
          {dealerships.map((d) => (
            <option key={d.id} value={d.id}>
              {d.alias ?? d.name}
            </option>
          ))}
        </select>
        <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {actor?.role === 'commissioner' && (
          <Button variant="secondary" onClick={carryForward}>
            Carry forward from…
          </Button>
        )}
      </div>

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      <Card className="max-w-lg divide-y divide-hairline">
        {advisorCategories.map((c) => (
          <label key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
            <span className="text-sm text-ink">{c.label}</span>
            <input
              type="number"
              step="any"
              value={values[c.id] ?? ''}
              onChange={(e) => setValues((prev) => ({ ...prev, [c.id]: e.target.value }))}
              className="w-32 rounded border border-hairline-strong bg-surface px-2 py-1 text-right font-mono text-sm"
            />
          </label>
        ))}
      </Card>
      {saveError && <p className="text-sm text-crit">{saveError}</p>}
      <Button onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save goals'}
      </Button>
    </div>
  );
}

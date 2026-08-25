import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { usePeriods } from '../../lib/usePeriods';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import type { Category } from '../../lib/types';

function ScopeEditor({ scope, categories, periodId, onSaved }: { scope: 'advisor' | 'manager'; categories: Category[]; periodId: number; onSaved: () => void }) {
  const editable = categories.filter((c) => !c.isDerived);
  const [weights, setWeights] = useState<Record<number, string>>({});
  useEffect(() => {
    setWeights(Object.fromEntries(editable.map((c) => [c.id, c.weight != null ? String(c.weight) : ''])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories]);

  const total = Object.values(weights).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api.put('/api/categories/weights', {
        periodId,
        scope,
        weights: editable.map((c) => ({ categoryId: c.id, weight: Number(weights[c.id] || 0) })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save weights.');
    }
  }

  return (
    <Card className="max-w-lg p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-display text-sm font-semibold capitalize text-ink">{scope} weights</p>
        <span className={`font-mono text-sm ${total === 100 ? 'text-good' : 'text-crit'}`}>{total} / 100</span>
      </div>
      <div className="space-y-2">
        {editable.map((c) => (
          <label key={c.id} className="flex items-center justify-between gap-3">
            <span className="text-sm text-ink-2">{c.label}</span>
            <input
              type="number"
              step="any"
              value={weights[c.id] ?? ''}
              onChange={(e) => setWeights((prev) => ({ ...prev, [c.id]: e.target.value }))}
              className="w-24 rounded border border-hairline-strong bg-surface px-2 py-1 text-right font-mono text-sm"
            />
          </label>
        ))}
        {categories.some((c) => c.isDerived) && <p className="text-xs text-ink-3">Team Score is derived and weighted alongside these, but has no direct entry.</p>}
      </div>
      {error && <p className="mt-2 text-xs text-crit">{error}</p>}
      <Button onClick={save} className="mt-3" disabled={total !== 100}>
        Save {scope} weights
      </Button>
    </Card>
  );
}

export function CategoriesTab() {
  const { periods, selected: period, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<{ categories: Category[] }>(period ? `/api/categories?periodId=${period.id}` : null);

  const [key, setKey] = useState('');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<'advisor' | 'manager'>('advisor');
  const [unit, setUnit] = useState<Category['unit']>('count');
  const [createError, setCreateError] = useState<string | null>(null);

  async function createCategory() {
    setCreateError(null);
    try {
      await api.post('/api/categories', { key, label, scope, unit });
      setKey('');
      setLabel('');
      refetch();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Could not create category.');
    }
  }

  return (
    <div className="space-y-6">
      <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && period && (
        <div className="grid gap-6 sm:grid-cols-2">
          <ScopeEditor scope="advisor" categories={data.categories.filter((c) => c.scope === 'advisor')} periodId={period.id} onSaved={refetch} />
          <ScopeEditor scope="manager" categories={data.categories.filter((c) => c.scope === 'manager')} periodId={period.id} onSaved={refetch} />
        </div>
      )}

      <Card className="max-w-md p-4">
        <p className="mb-2 font-display text-sm font-semibold text-ink">Add a category</p>
        <p className="mb-3 text-xs text-ink-3">
          Adding one doesn't change any weights by itself — save the weights above afterward to activate it, restating the whole scope so it still totals 100.
        </p>
        <div className="space-y-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Video Sent %)" className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
          <input
            value={key}
            onChange={(e) => setKey(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
            placeholder="key (camelCase, e.g. videoSentPct)"
            className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm font-mono"
          />
          <div className="flex gap-2">
            <select value={scope} onChange={(e) => setScope(e.target.value as 'advisor' | 'manager')} className="flex-1 rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              <option value="advisor">Advisor</option>
              <option value="manager">Manager</option>
            </select>
            <select value={unit} onChange={(e) => setUnit(e.target.value as Category['unit'])} className="flex-1 rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              <option value="count">Count</option>
              <option value="currency">Currency</option>
              <option value="ratio">Ratio</option>
              <option value="percent">Percent</option>
            </select>
          </div>
          {createError && <p className="text-xs text-crit">{createError}</p>}
          <Button onClick={createCategory} disabled={!key || !label}>
            Add category
          </Button>
        </div>
      </Card>
    </div>
  );
}

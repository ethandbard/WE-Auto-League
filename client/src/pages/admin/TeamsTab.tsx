import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import type { Dealership } from '../../lib/types';

export function TeamsTab() {
  const { data, loading, error, refetch } = useApi<{ dealerships: Dealership[] }>('/api/dealerships?includeArchived=true');
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  async function addTeam() {
    setFormError(null);
    try {
      await api.post('/api/dealerships', { name, alias: alias || undefined });
      setName('');
      setAlias('');
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not add team.');
    }
  }

  async function rename(team: Dealership) {
    const nextName = window.prompt('Store name', team.name);
    if (!nextName) return;
    const nextAlias = window.prompt('Alias (blank to clear)', team.alias ?? '');
    if (nextAlias === null) return;
    await api.patch(`/api/dealerships/${team.id}`, { name: nextName, alias: nextAlias === '' ? null : nextAlias });
    refetch();
  }

  async function toggleArchive(team: Dealership) {
    if (team.archivedAt) await api.post(`/api/dealerships/${team.id}/restore`);
    else await api.post(`/api/dealerships/${team.id}/archive`);
    refetch();
  }

  return (
    <div className="space-y-4">
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline-strong bg-surface-2 text-left">
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Name</th>
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Alias</th>
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {(data?.dealerships ?? []).map((d) => (
              <tr key={d.id} className={`border-b border-hairline last:border-0 ${d.archivedAt ? 'opacity-50' : ''}`}>
                <td className="px-3 py-2 text-ink">{d.name}</td>
                <td className="px-3 py-2 text-ink-2">{d.alias ?? '—'}</td>
                <td className="px-3 py-2 text-ink-3">{d.archivedAt ? 'archived' : 'active'}</td>
                <td className="px-3 py-2 text-right space-x-3">
                  <button onClick={() => rename(d)} className="text-xs text-brand hover:underline">
                    Rename
                  </button>
                  <button onClick={() => toggleArchive(d)} className="text-xs text-crit hover:underline">
                    {d.archivedAt ? 'Restore' : 'Archive'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      {formError && <p className="text-sm text-crit">{formError}</p>}
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Store name" className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
        <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias (optional)" className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
        <Button variant="secondary" onClick={addTeam} disabled={!name}>
          Add team
        </Button>
      </div>
    </div>
  );
}

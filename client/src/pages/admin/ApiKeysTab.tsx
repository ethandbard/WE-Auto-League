import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api } from '../../lib/api';
import { Card, Button } from '../../components/ui';
import { formatDate } from '../../lib/format';
import type { ApiKey } from '../../lib/types';

export function ApiKeysTab() {
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

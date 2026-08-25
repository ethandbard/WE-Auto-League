import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { usePeriods } from '../../lib/usePeriods';
import { useCurrentUser } from '../../lib/useCurrentUser';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import type { Dealership, Employee } from '../../lib/types';

export function RosterTab() {
  const { actor } = useCurrentUser();
  const { data: dealershipsData } = useApi<{ dealerships: Dealership[] }>('/api/dealerships');
  const dealerships = dealershipsData?.dealerships ?? [];
  const { periods, selected: period, setSelectedId } = usePeriods();

  const [dealershipId, setDealershipId] = useState<number | 'unassigned' | null>(null);
  useEffect(() => {
    if (dealershipId !== null) return;
    if (actor?.dealershipId) setDealershipId(actor.dealershipId);
    else if (dealerships.length) setDealershipId(dealerships[0]!.id);
  }, [actor, dealerships, dealershipId]);

  const employeesPath =
    dealershipId === 'unassigned'
      ? '/api/employees?includeArchived=true'
      : dealershipId
        ? `/api/employees?dealershipId=${dealershipId}&includeArchived=true`
        : null;
  const { data, loading, error, refetch } = useApi<{ employees: Employee[] }>(employeesPath);
  const employees = dealershipId === 'unassigned' ? (data?.employees ?? []).filter((e) => e.dealershipId == null) : (data?.employees ?? []);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'advisor' | 'manager'>('advisor');
  const [formError, setFormError] = useState<string | null>(null);

  async function addEmployee() {
    if (dealershipId === null) return;
    setFormError(null);
    try {
      await api.post('/api/employees', {
        dealershipId: dealershipId === 'unassigned' ? null : dealershipId,
        name,
        email,
        role,
        alias: name,
      });
      setName('');
      setEmail('');
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not add employee.');
    }
  }

  async function setParticipation(employeeId: number, status: 'eligible' | 'hidden' | 'terminated') {
    if (!period) return;
    let reason: string | undefined;
    if (status !== 'eligible') {
      reason = window.prompt(`Reason for marking ${status}?`) ?? undefined;
      if (!reason) return;
    }
    const res = await api.put<{ warning: string | null }>(`/api/employees/${employeeId}/participation`, { periodId: period.id, status, reason });
    if (res.warning) window.alert(res.warning);
    refetch();
  }

  async function archive(employee: Employee) {
    if (employee.archivedAt) await api.post(`/api/employees/${employee.id}/restore`);
    else await api.post(`/api/employees/${employee.id}/archive`);
    refetch();
  }

  async function rosterAtStore(employee: Employee) {
    const storeName = window.prompt('Roster at which store? Type the store name or alias.');
    if (!storeName) return;
    const match = dealerships.find(
      (d) => d.name.toLowerCase() === storeName.toLowerCase() || (d.alias && d.alias.toLowerCase() === storeName.toLowerCase()),
    );
    if (!match) {
      window.alert('No store by that name.');
      return;
    }
    await api.patch(`/api/employees/${employee.id}`, { dealershipId: match.id });
    refetch();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <select
          value={dealershipId ?? ''}
          onChange={(e) => setDealershipId(e.target.value === 'unassigned' ? 'unassigned' : Number(e.target.value))}
          className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm"
        >
          {dealerships.map((d) => (
            <option key={d.id} value={d.id}>
              {d.alias ?? d.name}
            </option>
          ))}
          {actor?.role === 'commissioner' && <option value="unassigned">Unassigned (floaters)</option>}
        </select>
        <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
          {periods.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} (participation)
            </option>
          ))}
        </select>
      </div>

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Name</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Role</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Email</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.id} className={`border-b border-hairline last:border-0 ${e.archivedAt ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 font-medium text-ink">{e.alias ?? e.name}</td>
                  <td className="px-3 py-2 capitalize text-ink-2">{e.role}</td>
                  <td className="px-3 py-2 text-ink-3">{e.email}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      {e.role === 'advisor' && !e.archivedAt && (
                        <>
                          <button onClick={() => setParticipation(e.id, 'eligible')} className="text-xs text-good hover:underline">
                            Show
                          </button>
                          <button onClick={() => setParticipation(e.id, 'hidden')} className="text-xs text-warn hover:underline">
                            Hide
                          </button>
                        </>
                      )}
                      {e.dealershipId == null && !e.archivedAt && actor?.role === 'commissioner' && (
                        <button onClick={() => rosterAtStore(e)} className="text-xs text-brand hover:underline">
                          Roster at store
                        </button>
                      )}
                      <button onClick={() => archive(e)} className="text-xs text-crit hover:underline">
                        {e.archivedAt ? 'Restore' : 'Remove'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card className="max-w-md p-4">
        <p className="mb-2 font-display text-sm font-semibold text-ink">Add employee</p>
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name / alias" className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
          <select value={role} onChange={(e) => setRole(e.target.value as 'advisor' | 'manager')} className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
            <option value="advisor">Advisor</option>
            <option value="manager">Manager</option>
          </select>
          {formError && <p className="text-xs text-crit">{formError}</p>}
          <Button onClick={addEmployee} disabled={!name || !email}>
            Add
          </Button>
        </div>
      </Card>
    </div>
  );
}

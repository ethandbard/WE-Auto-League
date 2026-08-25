import { useParams, Link } from 'react-router-dom';
import { usePeriods } from '../lib/usePeriods';
import { useApi } from '../lib/useApi';
import { useCurrentUser } from '../lib/useCurrentUser';
import { PageHeader } from '../components/PageHeader';
import { Card, Loading, ErrorState, PositionBadge } from '../components/ui';
import { formatScore, tierForPosition } from '../lib/format';
import type { Dealership, ScoreRow } from '../lib/types';

interface StoreViewResponse {
  dealership: Dealership;
  manager: ScoreRow | null;
  team: ScoreRow | null;
  advisors: ScoreRow[];
}

export function StoreView() {
  const { actor } = useCurrentUser();
  const { dealershipId } = useParams();
  const { periods, selected, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<StoreViewResponse>(
    actor && selected && dealershipId ? `/api/scores/${selected.id}/dealership/${dealershipId}` : null,
  );

  if (!actor) return <ErrorState message="Sign in to view store standings." />;

  return (
    <div>
      <PageHeader
        eyebrow="Store view"
        title={data?.dealership.alias ?? data?.dealership.name ?? 'Store'}
        actions={
          periods.length > 0 && (
            <select value={selected?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          )
        }
      />

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-3">Manager score</p>
              {data.manager ? (
                <div className="mt-2 flex items-baseline gap-3">
                  {data.manager.position != null && <PositionBadge position={data.manager.position} tier={tierForPosition(data.manager.position, 8)} />}
                  <span className="font-mono text-2xl font-semibold text-ink">{formatScore(data.manager.total)}</span>
                </div>
              ) : (
                <p className="mt-2 text-sm text-ink-3">Not scored yet</p>
              )}
            </Card>
            <Card className="p-5">
              <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-3">Team score</p>
              {data.team ? (
                <p className="mt-2 font-mono text-2xl font-semibold text-ink">{formatScore(data.team.total)}</p>
              ) : (
                <p className="mt-2 text-sm text-ink-3">Not scored yet</p>
              )}
            </Card>
          </div>

          <div>
            <h2 className="mb-3 font-display text-base font-semibold text-ink">Roster</h2>
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                    <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Advisor</th>
                    <th className="px-3 py-2 text-right font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {data.advisors.map((a) => (
                    <tr key={a.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                      <td className="px-3 py-2">
                        <Link to={`/standings/advisor/${a.employeeId}`} className="font-medium text-ink hover:text-brand hover:underline">
                          {a.employeeName}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink">{formatScore(a.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

import { Link } from 'react-router-dom';
import { usePeriods } from '../lib/usePeriods';
import { useApi } from '../lib/useApi';
import { useCurrentUser } from '../lib/useCurrentUser';
import { PageHeader } from '../components/PageHeader';
import { Card, Loading, ErrorState, EmptyState, PositionBadge } from '../components/ui';
import { formatScore, tierForPosition } from '../lib/format';
import type { ScoreRow, StandingsResponse } from '../lib/types';

export function Standings() {
  const { actor } = useCurrentUser();
  const { periods, selected, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<StandingsResponse>(actor && selected ? `/api/scores/${selected.id}/standings` : null);

  if (!actor) return <ErrorState message="Sign in to view standings." />;

  return (
    <div>
      <PageHeader
        eyebrow="Victory Lane"
        title="Standings"
        subtitle={selected ? `${selected.label} · ${selected.status}` : undefined}
        actions={
          periods.length > 0 && (
            <select
              value={selected?.id ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.status})
                </option>
              ))}
            </select>
          )
        }
      />

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && !loading && (
        <div className="space-y-8">
          <Board title="Manager Ranking" rows={data.managers} kind="store" />
          <Board title="Service Advisor Ranking" rows={data.advisors} kind="advisor" />
        </div>
      )}
    </div>
  );
}

function Board({ title, rows, kind }: { title: string; rows: ScoreRow[]; kind: 'advisor' | 'store' }) {
  if (rows.length === 0) {
    return (
      <div>
        <h2 className="mb-3 border-b-2 border-ink pb-2 font-display text-lg font-bold text-ink">{title}</h2>
        <EmptyState title="No scores yet" hint="Recompute this period once numbers have been filed." />
      </div>
    );
  }
  const categoryKeys = Object.keys(rows[0]!.categoryBreakdown).filter((k) => k !== 'advisorCount');

  return (
    <div>
      <h2 className="mb-3 border-b-2 border-ink pb-2 font-display text-lg font-bold text-ink">{title}</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline-strong bg-surface-2 text-left">
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Pos</th>
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">{kind === 'advisor' ? 'Advisor' : 'Manager'}</th>
              <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Store</th>
              {categoryKeys.map((k) => (
                <th key={k} className="px-3 py-2 text-right font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                  {k}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const tier = tierForPosition(row.position ?? rows.length, rows.length);
              const link = kind === 'advisor' ? `/standings/advisor/${row.employeeId}` : `/standings/store/${row.dealershipId}`;
              return (
                <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <PositionBadge position={row.position ?? 0} tier={tier} />
                  </td>
                  <td className="px-3 py-2">
                    <Link to={link} className="font-medium text-ink hover:text-brand hover:underline">
                      {row.employeeName ?? '—'}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{row.dealershipName ?? '—'}</td>
                  {categoryKeys.map((k) => (
                    <td key={k} className="px-3 py-2 text-right font-mono text-ink-2">
                      {row.categoryBreakdown[k]?.toFixed(2) ?? '—'}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right font-mono font-semibold text-ink">{formatScore(row.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

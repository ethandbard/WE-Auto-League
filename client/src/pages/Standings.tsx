import { Link } from 'react-router-dom';
import { usePeriods } from '../lib/usePeriods';
import { useApi } from '../lib/useApi';
import { useCurrentUser } from '../lib/useCurrentUser';
import { Card, Loading, ErrorState, EmptyState, PlateBadge } from '../components/ui';
import { formatScore, plateTierForPosition } from '../lib/format';
import type { ScoreRow, StandingsResponse } from '../lib/types';

export function Standings() {
  const { actor } = useCurrentUser();
  const { periods, selected, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<StandingsResponse>(actor && selected ? `/api/scores/${selected.id}/standings` : null);

  if (!actor) return <ErrorState message="Sign in to view standings." />;

  return (
    <div>
      <div className="mb-2 flex items-stretch overflow-hidden rounded-xl bg-rail">
        <div className="checker-strip w-16 self-stretch bg-[length:18px_18px] bg-[position:0_0,9px_9px] sm:w-20" />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-4">
          <p className="font-display text-2xl font-black uppercase tracking-wide text-white sm:text-3xl">Victory Lane</p>
          {selected && <p className="mt-1 font-display text-[11px] font-semibold uppercase tracking-widest text-white/60">{selected.label} · {selected.status}</p>}
        </div>
        <div className="checker-strip w-16 self-stretch bg-[length:18px_18px] bg-[position:0_0,9px_9px] sm:w-20" />
      </div>

      {periods.length > 0 && (
        <div className="mb-7 flex flex-wrap items-center justify-end gap-2">
          {selected && <ExportLinks periodId={selected.id} />}
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
        </div>
      )}

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && !loading && (
        <div className="space-y-10">
          <Board title="Manager Ranking" rows={data.managers} kind="store" />
          <Board title="Service Advisor Ranking" rows={data.advisors} kind="advisor" />
        </div>
      )}
    </div>
  );
}

/**
 * Plain anchors, not fetch-then-blob: the session cookie (or the Access JWT in
 * production) rides along automatically, and the server's Content-Disposition
 * names the file. Nothing to hold in memory.
 */
function ExportLinks({ periodId }: { periodId: number }) {
  const base = `/api/export/${periodId}/standings`;
  const linkClass = 'rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm text-ink hover:bg-surface-2';
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-3">Export</span>
      <a href={`${base}.xlsx`} className={linkClass}>
        Excel
      </a>
      <a href={`${base}.csv?scope=advisor`} className={linkClass}>
        Advisors CSV
      </a>
      <a href={`${base}.csv?scope=manager`} className={linkClass}>
        Managers CSV
      </a>
    </div>
  );
}

function BandTitle({ title }: { title: string }) {
  return (
    <div className="mb-4 flex items-stretch overflow-hidden rounded-lg bg-rail">
      <div className="checker-strip w-10 self-stretch bg-[length:14px_14px] bg-[position:0_0,7px_7px]" />
      <p className="flex-1 py-2.5 text-center font-display text-sm font-extrabold uppercase tracking-widest text-white">{title}</p>
      <div className="checker-strip w-10 self-stretch bg-[length:14px_14px] bg-[position:0_0,7px_7px]" />
    </div>
  );
}

function Podium({ rows, kind }: { rows: ScoreRow[]; kind: 'advisor' | 'store' }) {
  const top3 = rows.slice(0, 3);
  const p1 = top3.find((r) => r.position === 1);
  const p2 = top3.find((r) => r.position === 2);
  const p3 = top3.find((r) => r.position === 3);
  const ordered = [
    { row: p2, rank: 'P2', h: 96 },
    { row: p1, rank: 'P1', h: 130 },
    { row: p3, rank: 'P3', h: 76 },
  ];
  if (!p1) return null;
  return (
    <div className="mb-6 flex items-end justify-center gap-4">
      {ordered.map(
        ({ row, rank, h }, i) =>
          row && (
            <Link
              key={i}
              to={kind === 'advisor' ? `/standings/advisor/${row.employeeId}` : `/standings/store/${row.dealershipId}`}
              className="w-[150px] text-center sm:w-[190px]"
            >
              <p className="mb-1 font-mono text-xs font-bold text-ink-3">{rank}</p>
              <p className="font-display text-sm font-bold text-ink">{row.employeeName}</p>
              <p className="mb-2 text-xs text-ink-3">{row.dealershipName}</p>
              <div
                className="flex items-start justify-center rounded-t-lg pt-2.5"
                style={{ height: h, background: `var(--color-tier-${plateTierForPosition(row.position ?? 1, rows.length)})` }}
              >
                <span className="font-mono text-lg font-extrabold text-white">{formatScore(row.total)}</span>
              </div>
            </Link>
          ),
      )}
    </div>
  );
}

function Board({ title, rows, kind }: { title: string; rows: ScoreRow[]; kind: 'advisor' | 'store' }) {
  if (rows.length === 0) {
    return (
      <div>
        <BandTitle title={title} />
        <EmptyState title="No scores yet" hint="Recompute this period once numbers have been filed." />
      </div>
    );
  }
  const categoryKeys = Object.keys(rows[0]!.categoryBreakdown).filter((k) => k !== 'advisorCount');

  return (
    <div>
      <BandTitle title={title} />
      <Podium rows={rows} kind={kind} />
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
              const tier = plateTierForPosition(row.position ?? rows.length, rows.length);
              const link = kind === 'advisor' ? `/standings/advisor/${row.employeeId}` : `/standings/store/${row.dealershipId}`;
              return (
                <tr key={row.id} className="border-b border-hairline last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <PlateBadge position={row.position ?? 0} tier={tier} />
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

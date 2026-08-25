import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { usePeriods } from '../lib/usePeriods';
import { useApi } from '../lib/useApi';
import { useCurrentUser } from '../lib/useCurrentUser';
import { PageHeader } from '../components/PageHeader';
import { Card, Loading, ErrorState, PlateBadge, Gauge } from '../components/ui';
import { plateTierForPosition } from '../lib/format';
import type { ScoreRow } from '../lib/types';

interface AdvisorCardResponse {
  score: ScoreRow;
  position: number | null;
  totalAdvisors: number;
  gapToNextPosition: number;
  nextPositionHolder: { employeeId: number | null; total: string } | null;
}

export function AdvisorCard() {
  const { actor } = useCurrentUser();
  const { employeeId } = useParams();
  const { periods, selected, setSelectedId } = usePeriods();
  const { data, loading, error, refetch } = useApi<AdvisorCardResponse>(
    actor && selected && employeeId ? `/api/scores/${selected.id}/advisor/${employeeId}` : null,
  );

  const chartData = data
    ? Object.entries(data.score.categoryBreakdown).map(([category, points]) => ({ category, points }))
    : [];

  if (!actor) return <ErrorState message="Sign in to view advisor cards." />;

  return (
    <div>
      <PageHeader
        eyebrow="Advisor card"
        title={data?.score.employeeName ?? 'Advisor'}
        subtitle={data?.score.dealershipName ?? undefined}
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
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="p-5 text-center lg:col-span-1">
            <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-3">Position</p>
            {data.position != null && (
              <div className="mt-2 flex justify-center">
                <PlateBadge position={data.position} tier={plateTierForPosition(data.position, data.totalAdvisors)} size="lg" />
              </div>
            )}
            <div className="mt-2 flex justify-center">
              <Gauge
                value={Number(data.score.total)}
                max={160}
                tier={data.position != null ? plateTierForPosition(data.position, data.totalAdvisors) : undefined}
                label="Score"
              />
            </div>
            <p className="mt-1 text-xs text-ink-3">of {data.totalAdvisors} scored advisors</p>

            {data.nextPositionHolder && (
              <p className="mt-4 text-sm text-ink-2">
                <span className="font-mono font-semibold text-ink">{data.gapToNextPosition.toFixed(2)}</span> points behind the next position.
              </p>
            )}
            <Link to="/standings" className="mt-4 inline-block text-sm text-brand hover:underline">
              ← Back to standings
            </Link>
          </Card>

          <Card className="p-5 lg:col-span-2">
            <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-ink-3">Points by category</p>
            <div className="mt-3 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-hairline)" vertical={false} />
                  <XAxis dataKey="category" tick={{ fontSize: 11, fill: 'var(--color-ink-3)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--color-ink-3)' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--color-hairline)' }} />
                  <Bar dataKey="points" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {chartData.map((_, i) => (
                      <Cell key={i} fill="var(--color-brand)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

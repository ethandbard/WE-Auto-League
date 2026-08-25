import { Link } from 'react-router-dom';
import { useCurrentUser } from '../lib/useCurrentUser';
import { useApi } from '../lib/useApi';
import { Card, Loading } from '../components/ui';

interface Overview {
  league: { name: string };
  dealershipCount: number;
  employeeCount: number;
  advisorCount: number;
  managerCount: number;
  currentPeriod: { label: string; status: string } | null;
}

export function Home() {
  const { actor, loading } = useCurrentUser();
  const isCommissioner = actor?.role === 'commissioner';
  const { data: overview } = useApi<Overview>(isCommissioner ? '/api/admin/overview' : null);

  if (loading) return <Loading />;

  return (
    <div>
      <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-brand">Victory Lane</p>
      <h1 className="font-display text-3xl font-bold text-ink">WE Auto League</h1>
      <p className="mt-2 max-w-xl text-sm text-ink-2">
        Dealerships file their numbers twice a week. The platform scores and ranks service advisors and stores against monthly goals, and
        publishes standings on schedule.
      </p>

      {!actor && (
        <Card className="mt-6 max-w-md p-5">
          <p className="text-sm text-ink-2">
            Sign in to file numbers, view your card, or manage the league.{' '}
            <Link to="/sign-in" className="font-medium text-brand hover:underline">
              Sign in
            </Link>
          </p>
        </Card>
      )}

      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <QuickLink to="/standings" title="Standings" hint="This period's boards" />
        <QuickLink to="/enter" title="Enter" hint="File this window's numbers" />
        <QuickLink to="/announcements" title="Board" hint="League announcements" />
        {isCommissioner && <QuickLink to="/manage" title="Manage" hint="Roster, goals, categories" />}
      </div>

      {overview && (
        <div className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-4">
          <Stat label="Dealerships" value={overview.dealershipCount} />
          <Stat label="Advisors" value={overview.advisorCount} />
          <Stat label="Managers" value={overview.managerCount} />
          <Stat label="Current period" value={overview.currentPeriod?.label ?? '—'} sub={overview.currentPeriod?.status} />
        </div>
      )}
    </div>
  );
}

function QuickLink({ to, title, hint }: { to: string; title: string; hint: string }) {
  return (
    <Link to={to} className="block rounded-lg border border-hairline bg-surface p-4 transition-colors hover:border-brand/40 hover:bg-brand-wash/40">
      <p className="font-display text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs text-ink-3">{hint}</p>
    </Link>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="font-display text-[10px] font-semibold uppercase tracking-widest text-ink-3">{label}</p>
      <p className="mt-1 font-mono text-xl text-ink">{value}</p>
      {sub && <p className="text-xs capitalize text-ink-3">{sub}</p>}
    </div>
  );
}

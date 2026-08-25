import { NavLink } from 'react-router-dom';
import { useCurrentUser } from '../lib/useCurrentUser';

const NAV = [
  { to: '/', label: 'Home', exact: true },
  { to: '/standings', label: 'Standings' },
  { to: '/enter', label: 'Enter' },
  { to: '/manage', label: 'Manage', roles: ['commissioner', 'manager'] },
  { to: '/announcements', label: 'Board' },
  { to: '/admin', label: 'Admin', roles: ['commissioner'] },
] as const;

export function Sidebar({ open, onNavigate }: { open: boolean; onNavigate: () => void }) {
  const { actor, authProvider, loading, signOut } = useCurrentUser();

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 flex h-full w-64 shrink-0 flex-col border-r border-hairline bg-surface transition-transform duration-200 ease-out md:static md:z-auto md:w-56 md:translate-x-0 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      <div className="px-5 py-5">
        <NavLink to="/" onClick={onNavigate} className="font-display text-[13px] font-bold uppercase tracking-wider text-ink">
          WE Auto<span className="block text-brand">League</span>
        </NavLink>
        <div className="checker-strip mt-3 h-1.5 rounded-sm bg-[length:8px_8px] bg-[position:0_0,4px_4px]" />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {NAV.filter((item) => !('roles' in item) || !item.roles || (actor && (item.roles as readonly string[]).includes(actor.role))).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={'exact' in item ? item.exact : false}
            onClick={onNavigate}
            className={({ isActive }) =>
              `rounded-md px-3 py-2.5 font-display text-[13px] font-medium md:py-2 ${
                isActive ? 'bg-brand-wash text-brand' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-hairline px-4 py-4">
        {loading ? null : actor ? (
          <div>
            <p className="truncate text-sm font-medium text-ink">{actor.name}</p>
            <p className="text-xs capitalize text-ink-3">{actor.role}</p>
            <button onClick={() => void signOut()} className="mt-2 text-xs font-medium text-brand hover:underline">
              Sign out
            </button>
          </div>
        ) : authProvider === 'cloudflare-access' ? (
          <p className="text-xs text-ink-3">Access email is not on the roster.</p>
        ) : (
          <NavLink to="/sign-in" onClick={onNavigate} className="text-sm font-medium text-brand hover:underline">
            Sign in
          </NavLink>
        )}
      </div>
    </aside>
  );
}

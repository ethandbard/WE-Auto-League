import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Home } from './pages/Home';
import { SignIn } from './pages/SignIn';
import { Standings } from './pages/Standings';
import { AdvisorCard } from './pages/AdvisorCard';
import { StoreView } from './pages/StoreView';
import { Enter } from './pages/Enter';
import { Manage } from './pages/Manage';
import { Announcements } from './pages/Announcements';
import { Admin } from './pages/Admin';

export default function App() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex h-full">
      {navOpen && <div className="fixed inset-0 z-30 bg-ink/40 md:hidden" onClick={() => setNavOpen(false)} />}
      <Sidebar open={navOpen} onNavigate={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-hairline bg-surface px-4 py-3 md:hidden">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setNavOpen(true)}
            className="-ml-1 flex h-9 w-9 items-center justify-center rounded-md text-ink hover:bg-surface-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-5 w-5">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <NavLink to="/" className="font-display text-[13px] font-bold uppercase tracking-wider text-ink">
            WE Auto <span className="text-brand">League</span>
          </NavLink>
        </div>
        <main className="relative flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 md:px-8 md:py-8">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/sign-in" element={<SignIn />} />
              {/* The magic-link email points here (see server/src/auth.ts issueMagicLink) — SignIn itself reads the `token` query param. */}
              <Route path="/auth/verify" element={<SignIn />} />
              <Route path="/standings" element={<Standings />} />
              <Route path="/standings/advisor/:employeeId" element={<AdvisorCard />} />
              <Route path="/standings/store/:dealershipId" element={<StoreView />} />
              <Route path="/enter" element={<Enter />} />
              <Route path="/manage" element={<Manage />} />
              <Route path="/announcements" element={<Announcements />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

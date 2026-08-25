import { Navigate, Route, Routes } from 'react-router-dom';
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
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="relative flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-8 py-8">
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
  );
}

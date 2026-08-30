import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useCurrentUser } from '../lib/useCurrentUser';
import { OverviewTab } from './admin/OverviewTab';
import { LeagueSettingsTab } from './admin/LeagueSettingsTab';
import { TeamsTab } from './admin/TeamsTab';
import { RosterTab } from './manage/RosterTab';
import { EmailTab } from './admin/EmailTab';
import { ApiKeysTab } from './admin/ApiKeysTab';
import { AuditTab } from './admin/AuditTab';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'League settings' },
  { id: 'teams', label: 'Teams' },
  { id: 'employees', label: 'Employees' },
  { id: 'email', label: 'Email & communications' },
  { id: 'keys', label: 'API keys' },
  { id: 'audit', label: 'Audit log' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Admin() {
  const { actor } = useCurrentUser();
  const [tab, setTab] = useState<TabId>('overview');

  if (!actor || actor.role !== 'commissioner') {
    return <PageHeader eyebrow="Admin" title="Not authorised" subtitle="Sign in as a commissioner." />;
  }

  return (
    <div>
      <PageHeader eyebrow="Admin" title="League control centre" subtitle="Settings, teams, employees, email, keys, and the audit log." />
      <div className="mb-6 flex flex-wrap gap-1 border-b border-hairline">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 font-display text-sm font-medium ${tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-ink-3 hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'settings' && <LeagueSettingsTab />}
      {tab === 'teams' && <TeamsTab />}
      {tab === 'employees' && <RosterTab />}
      {tab === 'email' && <EmailTab />}
      {tab === 'keys' && <ApiKeysTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  );
}

import { useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { useCurrentUser } from '../lib/useCurrentUser';
import { RosterTab } from './manage/RosterTab';
import { GoalsTab } from './manage/GoalsTab';
import { CategoriesTab } from './manage/CategoriesTab';
import { PenaltiesTab } from './manage/PenaltiesTab';

const TABS = [
  { id: 'roster', label: 'Roster' },
  { id: 'goals', label: 'Goals' },
  { id: 'categories', label: 'Categories', commissionerOnly: true },
  { id: 'penalties', label: 'Penalties' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Manage() {
  const { actor } = useCurrentUser();
  const [tab, setTab] = useState<TabId>('roster');

  if (!actor || (actor.role !== 'commissioner' && actor.role !== 'manager')) {
    return <PageHeader eyebrow="Manage" title="Not authorised" subtitle="Sign in as a manager or commissioner." />;
  }

  return (
    <div>
      <PageHeader eyebrow="Manage" title="Roster, goals, categories, penalties" />
      <div className="mb-6 flex gap-1 border-b border-hairline">
        {TABS.filter((t) => !('commissionerOnly' in t) || actor.role === 'commissioner').map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 font-display text-sm font-medium ${tab === t.id ? 'border-b-2 border-brand text-brand' : 'text-ink-3 hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'roster' && <RosterTab />}
      {tab === 'goals' && <GoalsTab />}
      {tab === 'categories' && actor.role === 'commissioner' && <CategoriesTab />}
      {tab === 'penalties' && <PenaltiesTab />}
    </div>
  );
}

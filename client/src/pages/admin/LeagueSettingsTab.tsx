import { useEffect, useState } from 'react';
import { useApi } from '../../lib/useApi';
import { api, ApiError } from '../../lib/api';
import { Card, Loading, ErrorState, Button } from '../../components/ui';
import type { League } from '../../lib/types';

const WEEKDAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 7, label: 'Sun' },
] as const;

function cutoffInputValue(raw: string): string {
  return raw.length >= 5 ? raw.slice(0, 5) : raw;
}

export function LeagueSettingsTab() {
  const { data, loading, error, refetch } = useApi<{ league: League }>('/api/leagues/current');
  const [timezone, setTimezone] = useState('');
  const [submissionDays, setSubmissionDays] = useState<number[]>([]);
  const [cutoff, setCutoff] = useState('12:00');
  const [latePenaltyValue, setLatePenaltyValue] = useState('2');
  const [latePenaltyStacks, setLatePenaltyStacks] = useState(true);
  const [trainingPenaltyValue, setTrainingPenaltyValue] = useState('25');
  const [graceDays, setGraceDays] = useState('60');
  const [minAdvisors, setMinAdvisors] = useState('2');
  const [floaterRule, setFloaterRule] = useState(true);
  const [attainmentCap, setAttainmentCap] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data?.league) return;
    const league = data.league;
    setTimezone(league.timezone);
    setSubmissionDays(league.submissionDays);
    setCutoff(cutoffInputValue(league.submissionCutoffTime));
    setLatePenaltyValue(String(Number(league.latePenaltyValue)));
    setLatePenaltyStacks(league.latePenaltyStacks);
    setTrainingPenaltyValue(String(Number(league.trainingPenaltyValue)));
    setGraceDays(String(league.eligibilityNewHireGraceDays));
    setMinAdvisors(String(league.eligibilityMinAdvisorsForManager));
    setFloaterRule(league.eligibilityFloaterRuleEnabled);
    setAttainmentCap(league.attainmentCap == null ? '' : String(Number(league.attainmentCap)));
    setSaved(false);
  }, [data]);

  function toggleDay(day: number) {
    setSubmissionDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await api.put('/api/leagues/current', {
        timezone,
        submissionDays,
        submissionCutoffTime: cutoff,
        latePenaltyValue: Number(latePenaltyValue),
        latePenaltyStacks,
        trainingPenaltyValue: Number(trainingPenaltyValue),
        eligibilityNewHireGraceDays: Number(graceDays),
        eligibilityMinAdvisorsForManager: Number(minAdvisors),
        eligibilityFloaterRuleEnabled: floaterRule,
        attainmentCap: attainmentCap === '' ? null : Number(attainmentCap),
      });
      setSaved(true);
      refetch();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <div className="space-y-4">
      <Card className="grid gap-4 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Timezone (IANA)</span>
          <input value={timezone} onChange={(e) => setTimezone(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Cutoff time</span>
          <input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-medium text-ink-2">Submission days</legend>
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((d) => (
              <label key={d.day} className="flex items-center gap-1.5 text-sm text-ink">
                <input type="checkbox" checked={submissionDays.includes(d.day)} onChange={() => toggleDay(d.day)} />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Late penalty</span>
          <input type="number" step="any" value={latePenaltyValue} onChange={(e) => setLatePenaltyValue(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 font-mono text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={latePenaltyStacks} onChange={(e) => setLatePenaltyStacks(e.target.checked)} />
          Late penalty stacks per missed window
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Training penalty</span>
          <input type="number" step="any" value={trainingPenaltyValue} onChange={(e) => setTrainingPenaltyValue(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 font-mono text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">New-hire grace (days)</span>
          <input type="number" value={graceDays} onChange={(e) => setGraceDays(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 font-mono text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Min advisors for manager eligibility</span>
          <input type="number" value={minAdvisors} onChange={(e) => setMinAdvisors(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 font-mono text-sm" />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={floaterRule} onChange={(e) => setFloaterRule(e.target.checked)} />
          Floater roster rule enabled
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Attainment cap (blank = uncapped)</span>
          <input type="number" step="any" value={attainmentCap} onChange={(e) => setAttainmentCap(e.target.value)} className="rounded border border-hairline-strong bg-surface px-2.5 py-1.5 font-mono text-sm" />
        </label>
      </Card>
      {saveError && <p className="text-sm text-crit">{saveError}</p>}
      {saved && <p className="text-sm text-good">Saved.</p>}
      <Button onClick={save} disabled={saving || submissionDays.length === 0}>
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  );
}

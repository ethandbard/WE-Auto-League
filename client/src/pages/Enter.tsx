import { useEffect, useMemo, useRef, useState } from 'react';
import { usePeriods } from '../lib/usePeriods';
import { useApi } from '../lib/useApi';
import { useCurrentUser } from '../lib/useCurrentUser';
import { api, ApiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card, Loading, ErrorState, Button, StatusChip } from '../components/ui';
import type { Category, Dealership, RosterMember } from '../lib/types';

interface CurrentSubmission {
  window: { windowDate: string; cutoffAtUtc: string; isPastCutoff: boolean; nextWindowDate: string; nextCutoffAtUtc: string };
  roster: RosterMember[];
  advisorCategories: Category[];
  managerCategories: Category[];
  advisorValues: Record<number, Record<string, number>>;
  managerValues: Record<string, number>;
  lastSubmission: { submittedAt: string; onTime: boolean; isFinal: boolean } | null;
}

interface PastePreviewResponse {
  parseErrors: string[];
  rowCount: number;
  advisorValues: Array<{ employeeId: number; values: Record<string, number> }>;
  managerValues: Record<string, number>;
  unmatchedAdvisors: string[];
  unmatchedCategories: string[];
}

export function Enter() {
  const { actor } = useCurrentUser();
  const { periods, selected: period, setSelectedId } = usePeriods();
  const { data: dealershipsData } = useApi<{ dealerships: Dealership[] }>('/api/dealerships');
  const dealerships = dealershipsData?.dealerships ?? [];

  const [dealershipId, setDealershipId] = useState<number | null>(null);
  useEffect(() => {
    if (dealershipId !== null) return;
    if (actor?.dealershipId) setDealershipId(actor.dealershipId);
    else if (dealerships.length) setDealershipId(dealerships[0]!.id);
  }, [actor, dealerships, dealershipId]);

  const path = dealershipId && period ? `/api/submissions/current?dealershipId=${dealershipId}&periodId=${period.id}` : null;
  const { data, loading, error, refetch } = useApi<CurrentSubmission>(path);

  const [advisorValues, setAdvisorValues] = useState<Record<number, Record<string, string>>>({});
  const [managerValues, setManagerValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    const av: Record<number, Record<string, string>> = {};
    for (const [empId, values] of Object.entries(data.advisorValues)) {
      av[Number(empId)] = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, String(v)]));
    }
    setAdvisorValues(av);
    setManagerValues(Object.fromEntries(Object.entries(data.managerValues).map(([k, v]) => [k, String(v)])));
    setSaved(false);
  }, [data]);

  const canWrite = actor && (actor.role === 'commissioner' || actor.dealershipId === dealershipId);

  const cutoffLocal = useMemo(() => (data ? new Date(data.window.nextCutoffAtUtc).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null), [data]);

  // --- Paste-from-spreadsheet -------------------------------------------------
  // Reuses the exact same name/category matching the CSV importer uses
  // (server/src/ingestion/tabular.ts), so a manager can copy their DMS
  // report straight out of Excel and paste anywhere in the grid, in
  // whatever column order it happens to be in.
  const [pasting, setPasting] = useState(false);
  const [pasteSummary, setPasteSummary] = useState<{ matched: number; unmatchedAdvisors: string[]; unmatchedCategories: string[]; parseErrors: string[] } | null>(null);

  async function handlePaste(e: React.ClipboardEvent) {
    if (!dealershipId || !period || period.status !== 'open') return;
    const text = e.clipboardData.getData('text');
    if (!text.trim() || !text.includes('\n')) return; // a single-cell paste falls through to normal input behaviour
    e.preventDefault();
    setPasting(true);
    setPasteSummary(null);
    try {
      const preview = await api.post<PastePreviewResponse>('/api/import/preview', { dealershipId, periodId: period.id, csvText: text });
      setAdvisorValues((prev) => {
        const next = { ...prev };
        for (const row of preview.advisorValues) {
          next[row.employeeId] = { ...next[row.employeeId], ...Object.fromEntries(Object.entries(row.values).map(([k, v]) => [k, String(v)])) };
        }
        return next;
      });
      if (Object.keys(preview.managerValues).length) {
        setManagerValues((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(preview.managerValues).map(([k, v]) => [k, String(v)])) }));
      }
      setPasteSummary({
        matched: preview.advisorValues.length,
        unmatchedAdvisors: preview.unmatchedAdvisors,
        unmatchedCategories: preview.unmatchedCategories,
        parseErrors: preview.parseErrors,
      });
    } catch (err) {
      setPasteSummary({ matched: 0, unmatchedAdvisors: [], unmatchedCategories: [], parseErrors: [err instanceof ApiError ? err.message : 'Could not read that paste.'] });
    } finally {
      setPasting(false);
    }
  }

  // --- Spreadsheet-style keyboard navigation ----------------------------------
  const cellRefs = useRef(new Map<string, HTMLInputElement>());
  const setCellRef = (row: number, col: number, el: HTMLInputElement | null) => {
    const key = `${row}-${col}`;
    if (el) cellRefs.current.set(key, el);
    else cellRefs.current.delete(key);
  };
  const focusCell = (row: number, col: number) => {
    const el = cellRefs.current.get(`${row}-${col}`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  function handleGridKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number, rowCount: number, colCount: number) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (row < rowCount - 1) focusCell(row + 1, col);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (row > 0) focusCell(row - 1, col);
        return;
      case 'Enter':
        e.preventDefault();
        if (e.shiftKey) {
          if (row > 0) focusCell(row - 1, col);
        } else if (row < rowCount - 1) {
          focusCell(row + 1, col);
        }
        return;
      case 'ArrowLeft':
        // type="number" inputs don't support selectionStart/End in Chrome (always null),
        // so a "cursor at the edge" check can't gate this — every cell is already its own
        // edit target, so Left/Right just moves like Up/Down does.
        if (col > 0) {
          e.preventDefault();
          focusCell(row, col - 1);
        }
        return;
      case 'ArrowRight':
        if (col < colCount - 1) {
          e.preventDefault();
          focusCell(row, col + 1);
        }
        return;
    }
  }

  async function handleSubmit() {
    if (!dealershipId || !period) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.post('/api/submissions', {
        dealershipId,
        periodId: period.id,
        advisorValues: Object.entries(advisorValues).map(([employeeId, values]) => ({
          employeeId: Number(employeeId),
          values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
        })),
        managerValues: Object.fromEntries(Object.entries(managerValues).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])),
      });
      setSaved(true);
      refetch();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Data entry"
        title="Enter this window's numbers"
        subtitle="Month-to-date running totals — the last submission of the month is the one that scores."
        actions={
          <div className="flex items-center gap-2">
            <select value={dealershipId ?? ''} onChange={(e) => setDealershipId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              {dealerships.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.alias ?? d.name}
                </option>
              ))}
            </select>
            <select value={period?.id ?? ''} onChange={(e) => setSelectedId(Number(e.target.value))} className="rounded-md border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm">
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} ({p.status})
                </option>
              ))}
            </select>
          </div>
        }
      />

      {!actor && <ErrorState message="Sign in to enter numbers." />}
      {actor && !canWrite && <ErrorState message="You're not authorised to enter numbers for this store." />}
      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {data && actor && canWrite && (
        <div className="space-y-4">
          {period?.status !== 'open' ? (
            <div className="rounded-lg border border-warn/30 bg-warn-wash px-4 py-3 text-sm text-warn">This period is {period?.status} — no further submissions are accepted.</div>
          ) : (
            <div className={`rounded-lg border px-4 py-3 text-sm ${data.window.isPastCutoff ? 'border-crit/30 bg-crit-wash text-crit' : 'border-good/30 bg-good-wash text-good'}`}>
              {data.window.isPastCutoff
                ? `Today's cutoff has passed. Next window closes ${cutoffLocal}.`
                : `Next window closes ${cutoffLocal}. Submitting after the cutoff costs the store 2 points.`}
            </div>
          )}
          {data.lastSubmission && (
            <p className="text-xs text-ink-3">
              Last saved {new Date(data.lastSubmission.submittedAt).toLocaleString()} — {data.lastSubmission.onTime ? 'on time' : 'late'}
            </p>
          )}
          {period?.status === 'open' && (
            <p className="text-xs text-ink-3">
              Copy your DMS report (advisor name in the first column, category names across the header) and paste anywhere in the grid below — it matches rows and
              columns by name, in any order. Arrow keys and Enter move between cells like a spreadsheet.
            </p>
          )}
          {pasting && <p className="text-xs text-ink-3">Reading pasted data…</p>}
          {pasteSummary && (
            <div className={`rounded-lg border px-4 py-3 text-sm ${pasteSummary.parseErrors.length ? 'border-crit/30 bg-crit-wash text-crit' : 'border-good/30 bg-good-wash text-good'}`}>
              {pasteSummary.parseErrors.length ? (
                <p>{pasteSummary.parseErrors[0]}</p>
              ) : (
                <p>
                  Pasted {pasteSummary.matched} advisor row{pasteSummary.matched === 1 ? '' : 's'}.
                  {pasteSummary.unmatchedAdvisors.length > 0 && ` No roster match for: ${pasteSummary.unmatchedAdvisors.join(', ')}.`}
                  {pasteSummary.unmatchedCategories.length > 0 && ` Unrecognised column(s): ${pasteSummary.unmatchedCategories.join(', ')}.`}
                </p>
              )}
              <button onClick={() => setPasteSummary(null)} className="mt-1 text-xs font-medium underline">
                Dismiss
              </button>
            </div>
          )}

          <Card className="overflow-x-auto" onPaste={handlePaste}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                  <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Advisor</th>
                  {data.advisorCategories.map((c) => (
                    <th key={c.id} className="px-3 py-2 text-right font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.roster.map((advisor, rowIndex) => (
                  <tr key={advisor.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-ink">{advisor.alias ?? advisor.name}</span>
                        {advisor.status !== 'eligible' && <StatusChip status={advisor.status} />}
                      </div>
                    </td>
                    {data.advisorCategories.map((c, colIndex) => (
                      <td key={c.id} className="px-2 py-1.5 text-right">
                        <input
                          ref={(el) => setCellRef(rowIndex, colIndex, el)}
                          type="number"
                          step="any"
                          disabled={period?.status !== 'open'}
                          value={advisorValues[advisor.id]?.[c.key] ?? ''}
                          onChange={(e) => setAdvisorValues((prev) => ({ ...prev, [advisor.id]: { ...prev[advisor.id], [c.key]: e.target.value } }))}
                          onKeyDown={(e) => handleGridKeyDown(e, rowIndex, colIndex, data.roster.length, data.advisorCategories.length)}
                          className="w-24 rounded border border-hairline-strong bg-surface px-2 py-1 text-right font-mono text-sm outline-none focus:border-brand disabled:bg-surface-2"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <div>
            <h2 className="mb-2 font-display text-sm font-semibold text-ink">Store-level (manager board)</h2>
            <Card className="flex flex-wrap gap-4 p-4">
              {data.managerCategories.map((c) => (
                <label key={c.id} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-2">{c.label}</span>
                  <input
                    type="number"
                    step="any"
                    disabled={period?.status !== 'open'}
                    value={managerValues[c.key] ?? ''}
                    onChange={(e) => setManagerValues((prev) => ({ ...prev, [c.key]: e.target.value }))}
                    className="w-32 rounded border border-hairline-strong bg-surface px-2 py-1 font-mono text-sm outline-none focus:border-brand disabled:bg-surface-2"
                  />
                </label>
              ))}
            </Card>
          </div>

          {saveError && <p className="text-sm text-crit">{saveError}</p>}
          {saved && <p className="text-sm text-good">Saved.</p>}
          <Button onClick={handleSubmit} disabled={saving || period?.status !== 'open'}>
            {saving ? 'Saving…' : 'Save submission'}
          </Button>
        </div>
      )}
    </div>
  );
}

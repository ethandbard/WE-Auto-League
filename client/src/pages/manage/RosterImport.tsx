// Preview-then-commit, the same shape as the entry grid's paste and the XLSX
// upload: nothing is written until a commissioner has seen the exact rows.
// Bulk roster edits can move people between stores, so the preview shows the
// per-field diff rather than just a count.
import { useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useApi } from '../../lib/useApi';
import { Card, Button } from '../../components/ui';
import type { RosterPreview, RosterCommitResult } from '../../lib/types';

/** Illustrative only — the column list itself comes from the server. */
const EXAMPLE_ROW = 'Jem Bard,jem@example.com,Jem,Advisor,Toyota PA,2024-03-01';

export function RosterImport({ onImported }: { onImported: () => void }) {
  const template = useApi<{ expectedColumns: string[] }>('/api/import/roster/template');
  const columns = template.data?.expectedColumns ?? [];
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [result, setResult] = useState<RosterCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function reset() {
    setText('');
    setFile(null);
    setPreview(null);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function send<T>(path: string): Promise<T> {
    if (file) {
      const form = new FormData();
      form.append('file', file);
      return api.postForm<T>(path, form);
    }
    return api.post<T>(path, { text });
  }

  async function runPreview() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await send<RosterPreview>('/api/import/roster/preview'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read that roster.');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      setResult(await send<RosterCommitResult>('/api/import/roster/commit'));
      reset();
      onImported();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not import that roster.');
    } finally {
      setBusy(false);
    }
  }

  const blocked = preview ? preview.errors.length > 0 : true;
  const changeCount = preview ? preview.toCreate.length + preview.toUpdate.length : 0;

  return (
    <Card className="p-4">
      <p className="font-display text-sm font-semibold text-ink">Import roster</p>
      <p className="mt-1 text-xs text-ink-3">
        Paste rows from a spreadsheet, or upload a .csv or .xlsx. Matched on email — an address already on the roster is updated, a
        new one is added. Columns: <span className="font-mono">{columns.join(', ')}</span>. Leave Store blank for a floater.
      </p>

      <div className="mt-3 space-y-2">
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
            setFile(null);
            if (fileInput.current) fileInput.current.value = '';
          }}
          rows={5}
          placeholder={columns.length ? `${columns.join(',')}\n${EXAMPLE_ROW}` : ''}
          className="w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 font-mono text-xs"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setText('');
              setPreview(null);
            }}
            className="text-xs text-ink-2 file:mr-2 file:rounded file:border file:border-hairline-strong file:bg-surface-2 file:px-2 file:py-1 file:text-xs"
          />
          <Button variant="secondary" onClick={runPreview} disabled={busy || (!text.trim() && !file)}>
            {busy ? 'Reading…' : 'Preview'}
          </Button>
          {preview && (
            <Button onClick={commit} disabled={busy || blocked || changeCount === 0}>
              {changeCount === 0 ? 'Nothing to import' : `Import ${changeCount} row${changeCount === 1 ? '' : 's'}`}
            </Button>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-crit">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-good">
          Imported: {result.created} added, {result.updated} updated, {result.unchanged} already current.
        </p>
      )}

      {preview && (
        <div className="mt-3 space-y-2 border-t border-hairline pt-3">
          <p className="text-xs text-ink-2">
            <span className="font-mono font-semibold">{preview.toCreate.length}</span> to add ·{' '}
            <span className="font-mono font-semibold">{preview.toUpdate.length}</span> to update ·{' '}
            <span className="font-mono font-semibold">{preview.unchanged}</span> unchanged
          </p>

          {preview.errors.length > 0 && (
            <div className="rounded border border-crit/30 bg-crit-wash p-2">
              <p className="text-xs font-semibold text-crit">Fix these before importing:</p>
              <ul className="mt-1 space-y-0.5">
                {preview.errors.slice(0, 12).map((e, i) => (
                  <li key={i} className="text-xs text-crit">
                    {e}
                  </li>
                ))}
                {preview.errors.length > 12 && <li className="text-xs text-crit">…and {preview.errors.length - 12} more.</li>}
              </ul>
            </div>
          )}

          {preview.toCreate.length > 0 && (
            <div>
              <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Will be added</p>
              <ul className="mt-1 space-y-0.5">
                {preview.toCreate.map((r) => (
                  <li key={r.email} className="text-xs text-ink-2">
                    {/* A new row falls back to what the server will store when the file omits the column. */}
                    <span className="font-medium text-ink">{r.name}</span> · {r.email} · {r.role ?? 'advisor'} ·{' '}
                    {r.dealershipName ?? 'unassigned'}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.toUpdate.length > 0 && (
            <div>
              <p className="font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Will be updated</p>
              <ul className="mt-1 space-y-0.5">
                {preview.toUpdate.map((r) => (
                  <li key={r.email} className="text-xs text-ink-2">
                    <span className="font-medium text-ink">{r.name}</span> · {r.changes.join(' · ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

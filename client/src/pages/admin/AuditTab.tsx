import { useState } from 'react';
import { useApi } from '../../lib/useApi';
import { toQueryString } from '../../lib/api';
import { Card, Loading, ErrorState, EmptyState, Button } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import type { AuditLogRow, Pagination } from '../../lib/types';

const INPUT = 'rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm';

const PAGE_SIZE = 50;

/** The entity types writes are recorded against today, for the filter dropdown. */
const ENTITY_TYPES = ['period', 'submission', 'penalty', 'employee', 'dealership', 'category', 'goal', 'announcement', 'league', 'api_key', 'email_recipient', 'email_template'];

/** Read-only view of `audit_log`. Nothing here writes — the trail is the record of every other write. */
export function AuditTab() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');

  const query = toQueryString({ page, pageSize: PAGE_SIZE, entityType, action: action.trim() });
  const { data, loading, error, refetch } = useApi<{ auditLog: AuditLogRow[]; pagination: Pagination }>(`/api/admin/audit-log${query}`);

  const rows = data?.auditLog ?? [];
  const pagination = data?.pagination;

  function change(next: () => void) {
    setPage(1);
    next();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={entityType} onChange={(e) => change(() => setEntityType(e.target.value))} className={INPUT}>
          <option value="">All entities</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <input
          value={action}
          onChange={(e) => change(() => setAction(e.target.value))}
          placeholder="Action (e.g. penalty.waive)"
          className={`${INPUT} font-mono`}
        />
        {(entityType || action) && (
          <Button
            variant="secondary"
            onClick={() =>
              change(() => {
                setEntityType('');
                setAction('');
              })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title="No audit entries" hint="Nothing matches these filters yet." />
      )}

      {rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hairline-strong bg-surface-2 text-left">
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">When</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Actor</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Action</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Entity</th>
                <th className="px-3 py-2 font-display text-[11px] font-semibold uppercase tracking-wide text-ink-2">Provenance</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-hairline last:border-0">
                  <td className="px-3 py-2 text-ink-3">{formatDateTime(row.createdAt)}</td>
                  <td className="px-3 py-2 text-ink-2">{row.actorName ?? <span className="text-ink-3">system / key</span>}</td>
                  <td className="px-3 py-2 font-mono text-xs text-ink">{row.action}</td>
                  <td className="px-3 py-2 text-ink-2">
                    {row.entityType}
                    {row.entityId != null && <span className="text-ink-3"> #{row.entityId}</span>}
                  </td>
                  <td className="px-3 py-2 text-ink-3">{row.provenance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pagination && pagination.total > 0 && (
        <div className="flex items-center gap-3 text-sm text-ink-3">
          <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={pagination.page <= 1}>
            Previous
          </Button>
          <span>
            {pagination.from}–{pagination.to} of {pagination.total}
          </span>
          <Button
            variant="secondary"
            onClick={() => setPage((p) => p + 1)}
            disabled={pagination.page >= pagination.totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </section>
  );
}

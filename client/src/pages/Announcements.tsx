import { useState } from 'react';
import { useApi } from '../lib/useApi';
import { useCurrentUser } from '../lib/useCurrentUser';
import { api, ApiError } from '../lib/api';
import { PageHeader } from '../components/PageHeader';
import { Card, Loading, ErrorState, EmptyState, Button } from '../components/ui';
import { formatDateTime } from '../lib/format';
import type { Announcement } from '../lib/types';

export function Announcements() {
  const { actor } = useCurrentUser();
  const { data, loading, error, refetch } = useApi<{ announcements: Announcement[] }>(actor ? '/api/announcements' : null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  async function post() {
    setPosting(true);
    setPostError(null);
    try {
      await api.post('/api/announcements', { title, body, audience: 'all' });
      setTitle('');
      setBody('');
      refetch();
    } catch (err) {
      setPostError(err instanceof ApiError ? err.message : 'Could not post.');
    } finally {
      setPosting(false);
    }
  }

  async function markRead(id: number) {
    await api.post(`/api/announcements/${id}/read`);
    refetch();
  }

  if (!actor) return <ErrorState message="Sign in to see the message board." />;

  return (
    <div>
      <PageHeader eyebrow="Communicate" title="Message board" />

      {(actor.role === 'commissioner' || actor.role === 'manager') && (
        <Card className="mb-6 max-w-lg p-4">
          <p className="mb-2 font-display text-sm font-semibold text-ink">Post an announcement</p>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="mb-2 w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message" rows={3} className="mb-2 w-full rounded border border-hairline-strong bg-surface px-2.5 py-1.5 text-sm" />
          {postError && <p className="mb-2 text-xs text-crit">{postError}</p>}
          <Button onClick={post} disabled={posting || !title || !body}>
            {posting ? 'Posting…' : 'Post'}
          </Button>
        </Card>
      )}

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={refetch} />}
      {data && data.announcements.length === 0 && <EmptyState title="No announcements yet" hint="Posts from the commissioner and managers will show up here." />}
      <div className="space-y-3">
        {data?.announcements.map((a) => (
          <Card key={a.id} className={`p-4 ${a.read ? '' : 'border-l-4 border-l-brand'}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-sm font-semibold text-ink">{a.title}</p>
                <p className="mt-1 text-sm text-ink-2">{a.body}</p>
                <p className="mt-2 text-xs text-ink-3">{formatDateTime(a.createdAt)}</p>
              </div>
              {!a.read && (
                <button onClick={() => markRead(a.id)} className="shrink-0 text-xs font-medium text-brand hover:underline">
                  Mark read
                </button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

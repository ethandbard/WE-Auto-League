import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useCurrentUser } from '../lib/useCurrentUser';
import { Card, Button } from '../components/ui';

export function SignIn() {
  const { requestLink, verify, actor, authProvider, loading } = useCurrentUser();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const tokenFromUrl = params.get('token');

  useEffect(() => {
    if (loading || authProvider === 'cloudflare-access') return;
    if (tokenFromUrl && !verifying) {
      setVerifying(true);
      verify(tokenFromUrl)
        .then(() => navigate('/'))
        .catch(() => setError('This link is invalid or has expired. Request a new one.'));
    }
  }, [tokenFromUrl, verify, navigate, verifying, loading, authProvider]);

  if (loading) {
    return <p className="text-sm text-ink-2">Signing you in…</p>;
  }

  if (actor) {
    navigate('/');
    return null;
  }

  if (authProvider === 'cloudflare-access') {
    return (
      <div className="max-w-sm">
        <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-brand">Sign in</p>
        <h1 className="font-display text-2xl font-bold text-ink">WE Auto League</h1>
        <p className="mt-2 text-sm text-ink-2">This site signs you in through Cloudflare Access, not email.</p>
        <p className="mt-1 text-sm text-ink-2">Reload to restore a still-valid Access session. If you signed out, complete the PIN on the next page.</p>
        <Card className="mt-6 p-5">
          <Button type="button" className="w-full" onClick={() => window.location.assign('/')}>
            Reload
          </Button>
        </Card>
      </div>
    );
  }

  if (tokenFromUrl) {
    return <p className="text-sm text-ink-2">Signing you in…</p>;
  }

  return (
    <div className="max-w-sm">
      <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-brand">Sign in</p>
      <h1 className="font-display text-2xl font-bold text-ink">WE Auto League</h1>
      <p className="mt-2 text-sm text-ink-2">Enter your league email. The app sends a sign-in link; there is no password.</p>

      <Card className="mt-6 p-5">
        {sent ? (
          <div>
            <p className="text-sm text-ink">Check your email for a sign-in link.</p>
            {devLink && (
              <a href={devLink} className="mt-3 block break-all text-xs text-brand hover:underline">
                Dev mode — no email transport configured, click to continue: {devLink}
              </a>
            )}
          </div>
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError(null);
              try {
                const res = await requestLink(email);
                setSent(true);
                setDevLink(res.devLink ?? null);
              } catch {
                setError('Something went wrong. Try again.');
              }
            }}
          >
            <label className="block text-xs font-medium text-ink-2">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-hairline-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
              placeholder="you@dealership.com"
            />
            {error && <p className="mt-2 text-xs text-crit">{error}</p>}
            <Button type="submit" className="mt-4 w-full">
              Send sign-in link
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}

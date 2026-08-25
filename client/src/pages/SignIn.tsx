import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEffect } from 'react';
import { useCurrentUser } from '../lib/useCurrentUser';
import { Card, Button } from '../components/ui';

export function SignIn() {
  const { requestLink, verify, actor } = useCurrentUser();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const tokenFromUrl = params.get('token');

  useEffect(() => {
    if (tokenFromUrl && !verifying) {
      setVerifying(true);
      verify(tokenFromUrl)
        .then(() => navigate('/'))
        .catch(() => setError('This link is invalid or has expired. Request a new one.'));
    }
  }, [tokenFromUrl, verify, navigate, verifying]);

  if (actor) {
    navigate('/');
    return null;
  }

  if (tokenFromUrl) {
    return <p className="text-sm text-ink-2">Signing you in…</p>;
  }

  return (
    <div className="max-w-sm">
      <p className="font-display text-[11px] font-semibold uppercase tracking-widest text-brand">Sign in</p>
      <h1 className="font-display text-2xl font-bold text-ink">WE Auto League</h1>
      <p className="mt-2 text-sm text-ink-2">Enter your league email — we'll send a link to sign in, no password needed.</p>

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

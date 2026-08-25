import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Actor, AuthProvider } from './types';

interface CurrentUserContextValue {
  actor: Actor | null;
  authProvider: AuthProvider;
  loading: boolean;
  requestLink: (email: string) => Promise<{ devLink?: string }>;
  verify: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [authProvider, setAuthProvider] = useState<AuthProvider>('session');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await api.get<{ actor: Actor | null; authProvider: AuthProvider }>('/api/auth/me');
    setActor(res.actor);
    setAuthProvider(res.authProvider);
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const requestLink = useCallback(async (email: string) => {
    const res = await api.post<{ ok: boolean; devLink?: string }>('/api/auth/request-link', { email });
    return { devLink: res.devLink };
  }, []);

  const verify = useCallback(
    async (token: string) => {
      const res = await api.post<{ actor: Actor }>('/api/auth/verify', { token });
      setActor(res.actor);
    },
    [],
  );

  const signOut = useCallback(async () => {
    const res = await api.post<{ ok: boolean; accessLogoutUrl?: string }>('/api/auth/logout');
    setActor(null);
    if (res.accessLogoutUrl) {
      window.location.assign(res.accessLogoutUrl);
    }
  }, []);

  return (
    <CurrentUserContext.Provider value={{ actor, authProvider, loading, requestLink, verify, signOut }}>
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used within CurrentUserProvider');
  return ctx;
}

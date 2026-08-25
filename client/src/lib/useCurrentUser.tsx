import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from './api';
import type { Actor } from './types';

interface CurrentUserContextValue {
  actor: Actor | null;
  loading: boolean;
  requestLink: (email: string) => Promise<{ devLink?: string }>;
  verify: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await api.get<{ actor: Actor | null }>('/api/auth/me');
    setActor(res.actor);
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
    await api.post('/api/auth/logout');
    setActor(null);
  }, []);

  return <CurrentUserContext.Provider value={{ actor, loading, requestLink, verify, signOut }}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser(): CurrentUserContextValue {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) throw new Error('useCurrentUser must be used within CurrentUserProvider');
  return ctx;
}

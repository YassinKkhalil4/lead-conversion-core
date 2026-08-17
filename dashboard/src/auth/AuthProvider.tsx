import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError } from '@/api/client';
import * as api from '@/api/endpoints';
import { clearToken, saveToken } from '@/api/session';
import { clearPersistedCache } from '@/query/client';
import type { User } from '@/api/types';

type Status = 'restoring' | 'authenticated' | 'anonymous';

interface AuthValue {
  status: Status;
  user: User | null;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('restoring');
  const [user, setUser] = useState<User | null>(null);

  const restore = useCallback(async () => {
    try {
      const result = await api.me();
      setUser(result.user);
      setStatus('authenticated');
    } catch (error) {
      // An expired or missing session is the normal anonymous path. Losing the
      // network is not: staying "restoring" forever would strand the user, so
      // they are sent to sign-in either way and the screen explains why.
      if (error instanceof ApiError && !error.isAuthFailure && !error.isOffline) {
        // eslint-disable-next-line no-console
        console.warn('Session restore failed', error.code);
      }
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const signIn = useCallback(async ({ email, password }: { email: string; password: string }) => {
    const result = await api.login({ email, password });
    await saveToken(result.token);
    setUser(result.user);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The local session is cleared regardless; a failed revoke must not trap
      // someone in a signed-in state on a shared device.
    }
    await clearToken();
    await clearPersistedCache();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthValue>(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

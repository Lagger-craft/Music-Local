import { useCallback, useEffect, useState } from 'react';
import { api, setUnauthorizedHandler, ApiError } from '../api';
import type { AuthResponse, User } from '../types';

export type AuthStatus = 'loading' | 'anon' | 'authed';

/**
 * Cookie-based session state: GET /api/auth/me on boot, login/logout,
 * and a global 401 handler that returns the app to the login screen.
 */
export function useAuth() {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);

  // Any API 401 anywhere drops us back to the login screen.
  const handleUnauthorized = useCallback(() => {
    setUser(null);
    setStatus('anon');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(handleUnauthorized);
    return () => setUnauthorizedHandler(null);
  }, [handleUnauthorized]);

  // Boot: check for an existing session cookie.
  useEffect(() => {
    let cancelled = false;
    api<AuthResponse>('/api/auth/me', { skipUnauthorized: true })
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setStatus('authed');
      })
      .catch(() => {
        if (cancelled) return;
        setUser(null);
        setStatus('anon');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Returns an error message on failure, null on success. */
  const login = useCallback(
    async (username: string, password: string): Promise<string | null> => {
      try {
        const res = await api<AuthResponse>('/api/auth/login', {
          method: 'POST',
          body: { username, password },
          skipUnauthorized: true,
        });
        setUser(res.user);
        setStatus('authed');
        return null;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return 'Invalid username or password.';
        }
        if (err instanceof ApiError && err.status === 429) {
          return 'Too many failed attempts. Try again later.';
        }
        return err instanceof Error ? err.message : 'Login failed.';
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    await api<void>('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setUser(null);
    setStatus('anon');
  }, []);

  return { status, user, login, logout };
}

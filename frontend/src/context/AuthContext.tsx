import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  apiClient,
  AUTH_TOKEN_STORAGE_KEY,
  registerUnauthorizedHandler,
  useGet,
  usePost,
} from '../functions/axios';
import type { ApiError } from '../types/axios';
import type { AuthUser, LoginResponse } from '../types/auth';

interface AuthContextValue {
  /** null when logged out (the default — REQUIRE_AUTH is off out of the box,
   * so most of this app's usage never sets this at all). */
  user: AuthUser | null;
  /** True only while a *stored* token's validity is still being confirmed
   * against GET /api/auth/me/ (e.g. right after a page refresh) — never true
   * when there was no stored token to begin with. */
  initializing: boolean;
  loggingIn: boolean;
  loginError: ApiError | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Slice 9.1 — Authentication. Owns the DRF auth token (persisted in
 * localStorage under `AUTH_TOKEN_STORAGE_KEY`, read by the axios request
 * interceptor) and the current user, if any. A stored token is re-checked
 * against `/api/auth/me/` on mount rather than trusted blindly — a stale or
 * server-revoked token shouldn't silently render as "logged in" until some
 * unrelated request happens to 401 first.
 *
 * There is no proactive route guard here: since every endpoint stays open
 * until a deployment turns `REQUIRE_AUTH` on, gating pages client-side would
 * just duplicate logic the backend already owns. Instead, `registerUnauthorizedHandler`
 * hooks into the shared axios instance's response interceptor so *any* 401
 * from *any* request (not just this provider's own) clears the stored
 * token/user and redirects to `/login` — the same reactive path whether
 * REQUIRE_AUTH was already on at load or gets turned on later.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
  );
  const [user, setUser] = useState<AuthUser | null>(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(() => {
      clearAuth();
      // Slice 10.1's /shared/... links are meant to work with no account at
      // all — a visitor there could still 401 (e.g. an unrelated stale/
      // revoked token left over from a previous session on this browser),
      // but bouncing them to /login would defeat the entire point of a
      // read-only share link. Just drop the bad token quietly instead of
      // redirecting away from a page that never needed auth in the first
      // place.
      if (!window.location.pathname.startsWith('/shared/')) {
        navigate('/login');
      }
    });
  }, [clearAuth, navigate]);

  const {
    data: me,
    loading: initializing,
    error: meError,
  } = useGet<AuthUser>(token ? '/api/auth/me/' : null);

  useEffect(() => {
    if (me) {
      setUser(me);
    }
  }, [me]);

  useEffect(() => {
    // A stored token that no longer resolves (revoked, or the user row was
    // deleted) shouldn't linger — the 401 response interceptor would also
    // catch this on the next request, but clearing it as soon as /me/ itself
    // fails avoids a redundant round-trip.
    if (meError) {
      clearAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meError]);

  const {
    execute: loginRequest,
    loading: loggingIn,
    error: loginError,
  } = usePost<LoginResponse, { username: string; password: string }>('/api/auth/login/');

  const login = useCallback(
    async (username: string, password: string) => {
      const result = await loginRequest({ username, password });
      if (!result) {
        return false;
      }
      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, result.token);
      setToken(result.token);
      setUser(result.user);
      return true;
    },
    [loginRequest],
  );

  const logout = useCallback(() => {
    // Best-effort: the token is cleared client-side regardless of whether
    // this call succeeds, so a network hiccup never traps the user "logged
    // in" with no way out.
    apiClient.post('/api/auth/logout/').catch(() => {});
    clearAuth();
  }, [clearAuth]);

  return (
    <AuthContext.Provider value={{ user, initializing, loggingIn, loginError, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- intentional: hook co-located with its provider.
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

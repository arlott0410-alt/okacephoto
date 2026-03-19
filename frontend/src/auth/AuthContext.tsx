import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiLogin, apiMe, apiLogout } from "../api/client";

type AuthState = {
  loading: boolean;
  loggedIn: boolean;
  error: string | null;
  adminLabel?: string;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function useAuth() {
  const v = useContext(AuthContext);
  if (!v) throw new Error("AuthContext missing");
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminLabel, setAdminLabel] = useState<string | undefined>(undefined);

  async function refresh() {
    setError(null);
    try {
      const me = await apiMe();
      setLoggedIn(!!me.loggedIn);
      setAdminLabel(me.adminLabel);
    } catch {
      setLoggedIn(false);
      setAdminLabel(undefined);
    }
  }

  useEffect(() => {
    void refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(password: string) {
    setError(null);
    try {
      await apiLogin(password);
      await refresh();
    } catch (e: any) {
      const msg =
        e?.body?.error ? String(e.body.error) : e?.message ? String(e.message) : "Login failed";
      setError(msg);
      setLoggedIn(false);
      throw e;
    }
  }

  async function logout() {
    setError(null);
    try {
      await apiLogout();
    } finally {
      await refresh();
    }
  }

  const value = useMemo<AuthState>(
    () => ({
      loading,
      loggedIn,
      error,
      adminLabel,
      login,
      logout,
      refresh
    }),
    [loading, loggedIn, error, adminLabel]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}


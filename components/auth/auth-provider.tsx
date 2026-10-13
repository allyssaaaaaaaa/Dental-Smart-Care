"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  DEMO_USERS,
  ROLE_HOME,
  SESSION_COOKIE,
  parseSession,
  serializeSession,
  type Role,
  type Session,
} from "@/lib/auth";

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  login: (role: Role, next?: string) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`));
  return match?.[1] ?? null;
}

let listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setSessionCookie(session: Session | null) {
  if (session) {
    document.cookie = `${SESSION_COOKIE}=${serializeSession(session)}; Path=/; Max-Age=604800; SameSite=Lax`;
  } else {
    document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  emit();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const rawSession = useSyncExternalStore(subscribe, readCookie, () => null);
  const session = useMemo(() => parseSession(rawSession), [rawSession]);

  const login = useCallback(
    (role: Role, next?: string) => {
      setSessionCookie(DEMO_USERS[role]);
      router.push(next && next.startsWith(`/${role}`) ? next : ROLE_HOME[role]);
      router.refresh();
    },
    [router],
  );

  const logout = useCallback(() => {
    setSessionCookie(null);
    router.push("/");
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({ session, ready: true, login, logout }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

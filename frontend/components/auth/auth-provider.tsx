"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { ROLE_HOME, roleFromPath, sessionFromUser, type Session } from "@/lib/auth";

type AuthContextValue = {
  session: Session | null;
  ready: boolean;
  login: (email: string, password: string, next?: string) => Promise<void>;
  register: (details: RegistrationDetails, next?: string) => Promise<void>;
  logout: () => void;
};

type RegistrationDetails = {
  fullName: string;
  email: string;
  phone: string;
  password: string;
};

type AuthResponse = {
  token?: string;
  user?: {
    id: number;
    role: string;
    fullName: string;
    title: string;
    email: string;
    patientCode?: string | null;
  };
  error?: { message?: string; details?: Record<string, string> };
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readAuthResponse(response: Response): Promise<AuthResponse> {
  const data = (await response.json()) as AuthResponse;
  if (!response.ok) {
    const message = data.error?.message ?? "Authentication failed. Please try again.";
    const details = data.error?.details ? Object.values(data.error.details).join(". ") : "";
    throw new Error(details ? `${message}: ${details}` : message);
  }
  return data;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const authRevision = useRef(0);

  const acceptAuthResponse = useCallback(async (response: Response, next?: string) => {
    const data = await readAuthResponse(response);
    const user = data.user && sessionFromUser(data.user);
    if (!user) throw new Error("This account type is not allowed to sign in.");
    setSession(user);
    const destination = next && (next === `/${user.role}` || next.startsWith(`/${user.role}/`))
      ? next
      : ROLE_HOME[user.role];
    router.replace(destination);
    router.refresh();
  }, [router]);

  const login = useCallback(
    async (email: string, password: string, next?: string) => {
      authRevision.current += 1;
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      await acceptAuthResponse(response, next);
    },
    [acceptAuthResponse],
  );

  const register = useCallback(
    async (details: RegistrationDetails, next?: string) => {
      authRevision.current += 1;
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(details),
      });
      await acceptAuthResponse(response, next);
    },
    [acceptAuthResponse],
  );

  const logout = useCallback(() => {
    void (async () => {
      try {
        authRevision.current += 1;
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error("Could not sign out. Please try again.");
        setSession(null);
        router.replace("/");
        router.refresh();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not sign out. Please try again.");
      }
    })();
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const revision = authRevision.current;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401) return null;
        const data = await readAuthResponse(response);
        return data.user ? sessionFromUser(data.user) : null;
      })
      .then((current) => {
        if (!cancelled && revision === authRevision.current) setSession(current);
      })
      .catch((error: unknown) => {
        if (!cancelled && revision === authRevision.current) {
          toast.error(error instanceof Error ? error.message : "Could not verify your session.");
        }
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const requiredRole = roleFromPath(pathname);
    if (!requiredRole) return;
    if (!session) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    if (session.role !== requiredRole) {
      router.replace(ROLE_HOME[session.role]);
      return;
    }
    if (pathname === "/clerk" || pathname.startsWith("/clerk/") ||
        pathname === "/dentist" || pathname.startsWith("/dentist/")) {
      router.replace("/admin");
    }
  }, [pathname, ready, router, session]);

  const value = useMemo(
    () => ({ session, ready, login, register, logout }),
    [session, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

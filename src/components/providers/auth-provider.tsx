"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import { bootstrapAnonymousSession, type AnonymousSession } from "@/lib/client/session";

interface AuthContextValue {
  user: AnonymousSession | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AnonymousSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        const session = await bootstrapAnonymousSession();
        if (!cancelled) {
          setUser(session);
          setError(null);
        }
      } catch (bootstrapError) {
        console.error("Anonymous session bootstrap failed", bootstrapError);
        if (!cancelled) {
          setError(
            bootstrapError instanceof Error
              ? bootstrapError.message
              : "セッション初期化に失敗しました",
          );
          setUser(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
    }),
    [error, loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

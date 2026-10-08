"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { messages } from "@/messages/pt-BR";
import { authService, type AuthService, type CurrentUser } from "@/services/authService";
import { ApiProblemError } from "@/services/httpClient";
import { onSessionEvent } from "@/services/sessionEvents";
import styles from "./AuthProvider.module.scss";

export interface AuthContextValue {
  user: CurrentUser;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  children: ReactNode;
  /** When true (default), users with a pending mandatory change go to /change-password. */
  enforcePasswordChange?: boolean;
  service?: Pick<AuthService, "me" | "logout">;
}

/**
 * Loads the current user and guards the subtree (SPEC-003): anonymous users
 * go to /login, expired sessions go to /login with the reason, and pending
 * mandatory password changes go to /change-password.
 */
export function AuthProvider({ children, enforcePasswordChange = true, service = authService }: AuthProviderProps) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);

  const load = useCallback(async () => {
    try {
      const me = await service.me();
      if (enforcePasswordChange && me.mustChangePassword) {
        router.replace("/change-password");
        return;
      }
      setUser(me);
    } catch (error) {
      // Session-expired problems are handled by the session event listener.
      if (!(error instanceof ApiProblemError && error.type === "session-expired")) {
        router.replace("/login");
      }
    }
  }, [enforcePasswordChange, router, service]);

  useEffect(() => {
    // Initial load on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(
    () =>
      onSessionEvent((event) => {
        setUser(null);
        if (event.kind === "session-expired") {
          router.replace(`/login?reason=${encodeURIComponent(event.reason)}`);
        } else {
          router.replace("/change-password");
        }
      }),
    [router],
  );

  const logout = useCallback(async () => {
    try {
      await service.logout();
    } catch {
      // Leave locally anyway: the server session expires on its own (SPEC-003 RN-07).
    }
    setUser(null);
    router.replace("/login?reason=LOGOUT");
  }, [router, service]);

  if (!user) {
    return (
      <p className={styles.loading} role="status">
        {messages.auth.loadingSession}
      </p>
    );
  }

  return <AuthContext.Provider value={{ user, refresh: load, logout }}>{children}</AuthContext.Provider>;
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/Button/Button";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import styles from "./AppShell.module.scss";

/** Frame of the signed-in area: user identity, navigation and logout. */
export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className={styles.shell}>
      <nav className={styles.bar} aria-label="Conta">
        <div className={styles.identity}>
          <span className={styles.name}>{user.name ?? user.email}</span>
          <span className={styles.role}>{messages.home.role[user.role] ?? user.role}</span>
        </div>
        <div className={styles.actions}>
          {(user.role === "TEACHER" || user.role === "ADMIN") && (
            <Link href="/app/classes" className={styles.link}>
              {messages.classes.title}
            </Link>
          )}
          <Link href="/app/profile/security" className={styles.link}>
            {messages.home.security}
          </Link>
          <Button variant="secondary" onClick={() => void logout()}>
            {messages.auth.logout}
          </Button>
        </div>
      </nav>
      {children}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useMemo } from "react";
import { BrandMark } from "@/components/BrandMark/BrandMark";
import { Button } from "@/components/Button/Button";
import { UserBadge } from "@/components/UserBadge/UserBadge";
import { useAuth } from "@/hooks/useAuth";
import { useIdentity } from "@/hooks/useIdentity";
import { messages } from "@/messages/pt-BR";
import { getStudentProfile } from "@/services/studentService";
import styles from "./AppShell.module.scss";

/**
 * Frame of the signed-in area. The bar follows the pattern of the study screen
 * (SPEC-015, SPEC-016): the logo of the university and the platform at the left,
 * the navigation, and the signed-in user (photo, name and RA or role) with the way
 * out at the right.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  // The session is already known here, so only the student profile (RA and photo) is read.
  const sources = useMemo(() => ({ me: async () => user, studentProfile: () => getStudentProfile() }), [user]);
  const loaded = useIdentity(sources);
  const identity = { ...(loaded ?? { name: user.name || user.email }), detail: messages.home.role[user.role] ?? user.role };

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <BrandMark href="/app" />
        <nav className={styles.nav} aria-label="Conta">
          {(user.role === "TEACHER" || user.role === "ADMIN") && (
            <>
              <Link href="/app/classes" className={styles.link}>
                {messages.classes.title}
              </Link>
              <Link href="/app/students" className={styles.link}>
                {messages.students.title}
              </Link>
              <Link href="/app/modules" className={styles.link}>
                {messages.modules.title}
              </Link>
            </>
          )}
          <Link href="/app/profile/security" className={styles.link}>
            {messages.home.security}
          </Link>
        </nav>
        <div className={styles.account}>
          <UserBadge identity={identity} />
          <Button variant="secondary" onClick={() => void logout()}>
            {messages.auth.logout}
          </Button>
        </div>
      </header>
      {children}
    </div>
  );
}

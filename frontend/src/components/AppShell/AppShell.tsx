"use client";

import Link from "next/link";
import { useMemo } from "react";
import { BrandMark } from "@/components/BrandMark/BrandMark";
import { AccountMenu } from "@/components/AccountMenu/AccountMenu";
import { useAuth } from "@/hooks/useAuth";
import { useIdentity } from "@/hooks/useIdentity";
import { messages } from "@/messages/pt-BR";
import { getStudentProfile } from "@/services/studentService";
import styles from "./AppShell.module.scss";

/**
 * Frame of the signed-in area. The bar follows the pattern of the study screen
 * (SPEC-015, SPEC-016): the logo of the university and the platform at the left,
 * the navigation, and the account menu of the signed-in user (SPEC-026) at the right.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  // The session is already known here, so only the student profile (RA and photo) is read.
  const sources = useMemo(() => ({ me: async () => user, studentProfile: () => getStudentProfile() }), [user]);
  const loaded = useIdentity(sources);
  const account = { name: loaded?.name || user.name || user.email, email: user.email, role: user.role, avatarUrl: loaded?.avatarUrl };

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
          {user.role === "ADMIN" && (
            <Link href="/app/admin/conformidade" className={styles.link}>
              {messages.conformance.nav}
            </Link>
          )}
          <Link href="/app/profile/security" className={styles.link}>
            {messages.home.security}
          </Link>
        </nav>
        <div className={styles.account}>
          <AccountMenu user={account} logout={logout} />
        </div>
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

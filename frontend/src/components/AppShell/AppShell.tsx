"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/BrandMark/BrandMark";
import { AccountMenu } from "@/components/AccountMenu/AccountMenu";
import { LiveNowBanner } from "@/components/LiveNowBanner/LiveNowBanner";
import { useAuth } from "@/hooks/useAuth";
import { useIdentity } from "@/hooks/useIdentity";
import { messages } from "@/messages/pt-BR";
import { getStudentProfile } from "@/services/studentService";
import styles from "./AppShell.module.scss";

/**
 * Frame of the signed-in area. The bar follows the pattern of the study screen
 * (SPEC-015, SPEC-016): the logo of the university and the platform at the left,
 * the navigation, and the account menu of the signed-in user (SPEC-026) at the right.
 * On mobile viewports (< 768px), navigation is collapsed into a drawer (SPEC-043).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // The student who is already in the live room does not need the way in (SPEC-067 CA-09).
  const inLiveRoom = /^\/app\/classes\/[^/]+\/live(\/|$)/.test(pathname ?? "");

  const isRouteActive = (href: string) => {
    if (!pathname) return false;
    if (href === "/app") return pathname === "/app";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  // The session is already known here, so only the student profile (RA and photo) is read.
  const sources = useMemo(() => ({ me: async () => user, studentProfile: () => getStudentProfile() }), [user]);
  const loaded = useIdentity(sources);
  const account = { name: loaded?.name || user.name || user.email, email: user.email, role: user.role, avatarUrl: loaded?.avatarUrl };

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <BrandMark href="/app" />
        <button
          type="button"
          className={styles.mobileToggle}
          aria-label={mobileMenuOpen ? messages.shell.closeMenu : messages.shell.openMenu}
          aria-expanded={mobileMenuOpen}
          aria-controls="app-mobile-nav"
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          )}
        </button>
        <nav className={styles.nav} aria-label="Conta">
          {(user.role === "TEACHER" || user.role === "ADMIN") && (
            <>
              <Link
                href="/app/classes"
                className={`${styles.link} ${isRouteActive("/app/classes") ? styles.active : ""}`}
                aria-current={isRouteActive("/app/classes") ? "page" : undefined}
              >
                {messages.classes.title}
              </Link>
              <Link
                href="/app/students"
                className={`${styles.link} ${isRouteActive("/app/students") ? styles.active : ""}`}
                aria-current={isRouteActive("/app/students") ? "page" : undefined}
              >
                {messages.students.title}
              </Link>
              <Link
                href="/app/modules"
                className={`${styles.link} ${isRouteActive("/app/modules") ? styles.active : ""}`}
                aria-current={isRouteActive("/app/modules") ? "page" : undefined}
              >
                {messages.modules.title}
              </Link>
            </>
          )}
          {user.role === "ADMIN" && (
            <>
              <Link
                href="/app/admin/conformidade"
                className={`${styles.link} ${isRouteActive("/app/admin/conformidade") ? styles.active : ""}`}
                aria-current={isRouteActive("/app/admin/conformidade") ? "page" : undefined}
              >
                {messages.conformance.nav}
              </Link>
              <Link
                href="/app/admin/holidays"
                className={`${styles.link} ${isRouteActive("/app/admin/holidays") ? styles.active : ""}`}
                aria-current={isRouteActive("/app/admin/holidays") ? "page" : undefined}
              >
                {messages.schedule.holidays.nav}
              </Link>
            </>
          )}
          <Link
            href="/app/calendar"
            className={`${styles.link} ${isRouteActive("/app/calendar") ? styles.active : ""}`}
            aria-current={isRouteActive("/app/calendar") ? "page" : undefined}
          >
            {messages.schedule.page.nav}
          </Link>
          <Link
            href="/app/profile/security"
            className={`${styles.link} ${isRouteActive("/app/profile/security") ? styles.active : ""}`}
            aria-current={isRouteActive("/app/profile/security") ? "page" : undefined}
          >
            {messages.home.security}
          </Link>
        </nav>
        <div className={styles.account}>
          <AccountMenu user={account} logout={logout} />
        </div>
      </header>
      {mobileMenuOpen && (
        <div className={styles.mobileBackdrop} onClick={() => setMobileMenuOpen(false)}>
          <nav
            id="app-mobile-nav"
            className={styles.mobileNav}
            aria-label={messages.shell.mobileNavAriaLabel}
            onClick={(e) => e.stopPropagation()}
          >
            {(user.role === "TEACHER" || user.role === "ADMIN") && (
              <>
                <Link
                  href="/app/classes"
                  className={`${styles.mobileLink} ${isRouteActive("/app/classes") ? styles.mobileActive : ""}`}
                  aria-current={isRouteActive("/app/classes") ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {messages.classes.title}
                </Link>
                <Link
                  href="/app/students"
                  className={`${styles.mobileLink} ${isRouteActive("/app/students") ? styles.mobileActive : ""}`}
                  aria-current={isRouteActive("/app/students") ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {messages.students.title}
                </Link>
                <Link
                  href="/app/modules"
                  className={`${styles.mobileLink} ${isRouteActive("/app/modules") ? styles.mobileActive : ""}`}
                  aria-current={isRouteActive("/app/modules") ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {messages.modules.title}
                </Link>
              </>
            )}
            {user.role === "ADMIN" && (
              <>
                <Link
                  href="/app/admin/conformidade"
                  className={`${styles.mobileLink} ${isRouteActive("/app/admin/conformidade") ? styles.mobileActive : ""}`}
                  aria-current={isRouteActive("/app/admin/conformidade") ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {messages.conformance.nav}
                </Link>
                <Link
                  href="/app/admin/holidays"
                  className={`${styles.mobileLink} ${isRouteActive("/app/admin/holidays") ? styles.mobileActive : ""}`}
                  aria-current={isRouteActive("/app/admin/holidays") ? "page" : undefined}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {messages.schedule.holidays.nav}
                </Link>
              </>
            )}
            <Link
              href="/app/calendar"
              className={`${styles.mobileLink} ${isRouteActive("/app/calendar") ? styles.mobileActive : ""}`}
              aria-current={isRouteActive("/app/calendar") ? "page" : undefined}
              onClick={() => setMobileMenuOpen(false)}
            >
              {messages.schedule.page.nav}
            </Link>
            <Link
              href="/app/profile/security"
              className={`${styles.mobileLink} ${isRouteActive("/app/profile/security") ? styles.mobileActive : ""}`}
              aria-current={isRouteActive("/app/profile/security") ? "page" : undefined}
              onClick={() => setMobileMenuOpen(false)}
            >
              {messages.home.security}
            </Link>
          </nav>
        </div>
      )}
      {user.role === "STUDENT" && !inLiveRoom && <LiveNowBanner />}
      <div className={styles.content}>{children}</div>
    </div>
  );
}

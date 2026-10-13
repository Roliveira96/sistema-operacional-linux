"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountMenu } from "@/components/AccountMenu/AccountMenu";
import { BrandMark } from "@/components/BrandMark/BrandMark";
import { Button } from "@/components/Button/Button";
import { useIdentity, type IdentitySources } from "@/hooks/useIdentity";
import { messages } from "@/messages/pt-BR";
import { authService } from "@/services/authService";
import styles from "./NavbarPublic.module.scss";

export interface NavbarPublicProps {
  /** Where the session is read from; the real services by default. */
  identity?: IdentitySources;
  /** Ends the session on the server. */
  logout?: () => Promise<unknown>;
}

/**
 * Top bar of the public pages. It knows the session: a signed-in user sees a link to
 * their area and the account menu (SPEC-026), never the sign-in and sign-up
 * buttons; a visitor sees the buttons; while the session is read, neither.
 * On mobile viewports (< 768px), navigation is collapsed into a drawer (SPEC-043).
 */
export function NavbarPublic({ identity: sources, logout = () => authService.logout() }: NavbarPublicProps = {}) {
  const router = useRouter();
  const identity = useIdentity(sources);
  const [signedOut, setSignedOut] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const user = signedOut ? null : identity;

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  const leave = async () => {
    try {
      await logout();
    } catch {
      // Leave locally anyway: the server session expires on its own (SPEC-003 RN-07).
    }
    setSignedOut(true);
    router.refresh();
  };

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <BrandMark href="/" />

        <nav className={styles.nav} aria-label={messages.public.nav.ariaLabel}>
          <Link href="/" className={styles.navLink}>
            {messages.public.nav.home}
          </Link>
          <Link href="/materials" className={styles.navLink}>
            {messages.public.nav.materials}
          </Link>
          <Link href="/simulations" className={styles.navLink}>
            {messages.public.nav.simulations}
          </Link>
        </nav>

        <div className={styles.actions}>
          {user === null && (
            <>
              <Button variant="secondary" className={styles.loginBtn} onClick={() => router.push("/login")}>
                {messages.public.nav.login}
              </Button>
              <Button variant="primary" className={styles.registerBtn} onClick={() => router.push("/register")}>
                {messages.public.nav.register}
              </Button>
            </>
          )}
          {user && (
            <>
              <Button variant="primary" className={styles.registerBtn} onClick={() => router.push("/app")}>
                {messages.public.nav.myArea}
              </Button>
              <AccountMenu user={user} logout={leave} />
            </>
          )}
        </div>

        <button
          type="button"
          className={styles.mobileToggle}
          aria-label={mobileMenuOpen ? messages.public.nav.closeMenu : messages.public.nav.openMenu}
          aria-expanded={mobileMenuOpen}
          aria-controls="public-mobile-nav"
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
      </div>

      {mobileMenuOpen && (
        <div className={styles.mobileBackdrop} onClick={() => setMobileMenuOpen(false)}>
          <nav
            id="public-mobile-nav"
            className={styles.mobileNav}
            aria-label={messages.public.nav.mobileAriaLabel}
            onClick={(e) => e.stopPropagation()}
          >
            <Link href="/" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
              {messages.public.nav.home}
            </Link>
            <Link href="/materials" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
              {messages.public.nav.materials}
            </Link>
            <Link href="/simulations" className={styles.mobileNavLink} onClick={() => setMobileMenuOpen(false)}>
              {messages.public.nav.simulations}
            </Link>
            <div className={styles.mobileActions}>
              {user === null && (
                <>
                  <Button
                    variant="secondary"
                    className={styles.mobileBtn}
                    onClick={() => {
                      setMobileMenuOpen(false);
                      router.push("/login");
                    }}
                  >
                    {messages.public.nav.login}
                  </Button>
                  <Button
                    variant="primary"
                    className={styles.mobileBtn}
                    onClick={() => {
                      setMobileMenuOpen(false);
                      router.push("/register");
                    }}
                  >
                    {messages.public.nav.register}
                  </Button>
                </>
              )}
              {user && (
                <Button
                  variant="primary"
                  className={styles.mobileBtn}
                  onClick={() => {
                    setMobileMenuOpen(false);
                    router.push("/app");
                  }}
                >
                  {messages.public.nav.myArea}
                </Button>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

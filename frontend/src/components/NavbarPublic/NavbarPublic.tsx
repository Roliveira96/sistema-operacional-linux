"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/Button/Button";
import { UserBadge } from "@/components/UserBadge/UserBadge";
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
 * Top bar of the public pages. It knows the session: a signed-in user sees their
 * photo and name, a link to their area and a way out, never the sign-in and sign-up
 * buttons; a visitor sees the buttons; while the session is read, neither.
 */
export function NavbarPublic({ identity: sources, logout = () => authService.logout() }: NavbarPublicProps = {}) {
  const router = useRouter();
  const identity = useIdentity(sources);
  const [signedOut, setSignedOut] = useState(false);
  const user = signedOut ? null : identity;

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
        <div className={styles.brandGroup}>
          <Link href="/" className={styles.brandLink} aria-label={`${messages.public.nav.brand} - ${messages.public.nav.institution}`}>
            <div className={styles.logoBadge}>
              <Image src="/utfpr-logo.svg" alt={messages.public.nav.logoAlt} width={78} height={22} className={styles.logo} unoptimized />
            </div>
            <div className={styles.brandText}>
              <span className={styles.brandTitle}>{messages.public.nav.brand}</span>
            </div>
          </Link>
        </div>

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
              <UserBadge identity={user} />
              <Button variant="primary" className={styles.registerBtn} onClick={() => router.push("/app")}>
                {messages.public.nav.myArea}
              </Button>
              <Button variant="secondary" className={styles.loginBtn} onClick={() => void leave()}>
                {messages.public.nav.logout}
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

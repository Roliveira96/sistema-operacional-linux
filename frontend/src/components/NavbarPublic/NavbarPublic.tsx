"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./NavbarPublic.module.scss";

export function NavbarPublic() {
  const router = useRouter();

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        <div className={styles.brandGroup}>
          <Link href="/" className={styles.brandLink} aria-label={`${messages.public.nav.brand} - ${messages.public.nav.institution}`}>
            <div className={styles.logoBadge} aria-hidden="true">
              <span className={styles.badgeText}>{messages.public.nav.institution}</span>
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
          <Button
            variant="secondary"
            className={styles.loginBtn}
            onClick={() => router.push("/login")}
          >
            {messages.public.nav.login}
          </Button>
          <Button
            variant="primary"
            className={styles.registerBtn}
            onClick={() => router.push("/register")}
          >
            {messages.public.nav.register}
          </Button>
        </div>
      </div>
    </header>
  );
}

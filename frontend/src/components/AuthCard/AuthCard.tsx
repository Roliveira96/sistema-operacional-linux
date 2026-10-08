import type { ReactNode } from "react";
import styles from "./AuthCard.module.scss";

/** Centered card used by every authentication screen. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className={styles.card} aria-labelledby="auth-card-title">
      <header className={styles.header}>
        <h1 id="auth-card-title" className={styles.title}>
          {title}
        </h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

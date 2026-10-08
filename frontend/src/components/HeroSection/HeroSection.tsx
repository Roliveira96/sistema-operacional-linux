import Link from "next/link";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./HeroSection.module.scss";

export interface HeroSectionProps {
  onPrimaryClick?: () => void;
  onSecondaryClick?: () => void;
}

export function HeroSection({ onPrimaryClick, onSecondaryClick }: HeroSectionProps) {
  return (
    <section className={styles.hero} aria-labelledby="hero-heading">
      <div className={styles.container}>
        <div className={styles.content}>
          <div className={styles.badge}>{messages.public.hero.badge}</div>

          <h1 id="hero-heading" className={styles.title}>
            {messages.public.hero.title}
          </h1>

          <p className={styles.subtitle}>{messages.public.hero.subtitle}</p>

          <div className={styles.actions}>
            {onPrimaryClick ? (
              <Button variant="primary" onClick={onPrimaryClick}>
                {messages.public.hero.ctaPrimary}
              </Button>
            ) : (
              <Link href="/materials" className={styles.linkWrapper}>
                <Button variant="primary">{messages.public.hero.ctaPrimary}</Button>
              </Link>
            )}

            {onSecondaryClick ? (
              <Button variant="secondary" onClick={onSecondaryClick}>
                {messages.public.hero.ctaSecondary}
              </Button>
            ) : (
              <Link href="/simulations" className={styles.linkWrapper}>
                <Button variant="secondary">{messages.public.hero.ctaSecondary}</Button>
              </Link>
            )}
          </div>
        </div>

        <div className={styles.terminalWrapper}>
          <div className={styles.terminalWindow}>
            <div className={styles.terminalHeader}>
              <div className={styles.windowControls} aria-hidden="true">
                <span className={`${styles.dot} ${styles.dotClose}`} />
                <span className={`${styles.dot} ${styles.dotMinimize}`} />
                <span className={`${styles.dot} ${styles.dotMaximize}`} />
              </div>
              <span className={styles.terminalTitle}>{messages.public.hero.terminalTitle}</span>
            </div>

            <div className={styles.terminalBody}>
              <div className={styles.commandLine}>
                <span className={styles.prompt}>terminal@utfpr-lab:~$</span>
                <span className={styles.command}>ls -la /utfpr/so</span>
              </div>
              <div className={styles.output}>
                <div>total 24</div>
                <div>drwxr-xr-x 2 prof prof 4096 out  8 modulos/</div>
                <div>-rwxr-xr-x 1 prof prof 8192 out  8 exame-pratico*</div>
              </div>

              <div className={styles.commandLine}>
                <span className={styles.prompt}>terminal@utfpr-lab:~$</span>
                <span className={styles.command}>./exame-pratico --check</span>
              </div>
              <div className={`${styles.output} ${styles.outputSuccess}`}>
                [OK] VFS inicializado. Validador pronto no servidor.
              </div>

              <div className={styles.commandLine}>
                <span className={styles.prompt}>terminal@utfpr-lab:~$</span>
                <span className={styles.cursor} aria-hidden="true" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

import { messages } from "@/messages/pt-BR";
import styles from "./FooterPublic.module.scss";

export function FooterPublic() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.primaryColumn}>
          <div className={styles.brandTitle}>{messages.public.nav.brand}</div>
          <p className={styles.institution}>{messages.public.footer.campus}</p>
          <p className={styles.course}>{messages.public.footer.course}</p>
        </div>

        <div className={styles.academicColumn}>
          <p className={styles.advisorship}>{messages.public.footer.advisorship}</p>
          <p className={styles.author}>{messages.public.footer.author}</p>
          <p className={styles.tccNotice}>{messages.public.footer.tccNotice}</p>
        </div>
      </div>

      <div className={styles.bottomBar}>
        <div className={styles.bottomContainer}>
          <small className={styles.copyright}>
            © {new Date().getFullYear()} {messages.public.footer.allRightsReserved}
          </small>
        </div>
      </div>
    </footer>
  );
}

import { HealthStatus } from "@/components/HealthStatus/HealthStatus";
import { messages } from "@/messages/pt-BR";
import styles from "./page.module.scss";

/** Platform status page (SPEC-004 health check). */
export default function StatusPage() {
  return (
    <div className={styles.page}>
      <div>
        <h1 className={styles.title}>{messages.app.name}</h1>
        <p className={styles.tagline}>{messages.app.tagline}</p>
      </div>
      <HealthStatus />
    </div>
  );
}

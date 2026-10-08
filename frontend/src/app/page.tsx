import { HealthStatus } from "@/components/HealthStatus/HealthStatus";
import { messages } from "@/messages/pt-BR";
import styles from "./page.module.scss";

/** Provisional home page: shows the platform health until real modules exist. */
export default function HomePage() {
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

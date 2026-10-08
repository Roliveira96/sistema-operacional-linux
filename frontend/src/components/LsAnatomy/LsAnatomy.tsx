import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./LsAnatomy.module.scss";

/** Annotated "ls -l" line, like the legacy widget. */
export function LsAnatomy() {
  const m = contentMessages.anatomy;
  return (
    <div className={styles.anatomy}>
      <p className={styles.title}>🔬 {m.title}</p>
      <pre className={styles.line}>
        {m.parts.map(([value, part], i) => (
          <span key={i} className={styles[part]} data-n={i + 1}>
            {value}
            {i >= 3 ? " " : ""}
          </span>
        ))}
      </pre>
      <ol className={styles.legend}>
        {m.parts.map(([, part, description], i) => (
          <li key={i} className={styles[part]}>
            {description}
          </li>
        ))}
      </ol>
    </div>
  );
}

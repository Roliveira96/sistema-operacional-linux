import type { ReactNode } from "react";
import styles from "./Alert.module.scss";

export type AlertTone = "info" | "success" | "warning" | "danger";

/** Inline message. Errors and warnings are announced immediately. */
export function Alert({ tone = "info", children }: { tone?: AlertTone; children: ReactNode }) {
  const urgent = tone === "danger" || tone === "warning";
  return (
    <div className={`${styles.alert} ${styles[tone]}`} role={urgent ? "alert" : "status"}>
      {children}
    </div>
  );
}

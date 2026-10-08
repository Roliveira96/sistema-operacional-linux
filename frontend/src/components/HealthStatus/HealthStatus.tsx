"use client";

import { useCallback, useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { fetchHealth, type HealthReport } from "@/services/healthService";
import { NetworkError } from "@/services/httpClient";
import styles from "./HealthStatus.module.scss";

type State =
  | { kind: "loading" }
  | { kind: "loaded"; report: HealthReport }
  | { kind: "error"; message: string };

const statusClass: Record<string, string | undefined> = {
  HEALTHY: styles.healthy,
  DEGRADED: styles.degraded,
  UNHEALTHY: styles.unhealthy,
};

/** Shows the platform health reported by GET /api/v1/health. */
export function HealthStatus({ load = fetchHealth }: { load?: () => Promise<HealthReport> }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      setState({ kind: "loaded", report: await load() });
    } catch (error) {
      const message = error instanceof NetworkError ? messages.health.networkError : messages.health.unexpectedError;
      setState({ kind: "error", message });
    }
  }, [load]);

  useEffect(() => {
    // Initial fetch on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  return (
    <section className={styles.card} aria-labelledby="health-title" aria-busy={state.kind === "loading"}>
      <header className={styles.header}>
        <h2 id="health-title" className={styles.title}>
          {messages.health.title}
        </h2>
        {state.kind === "loaded" && (
          <span className={`${styles.badge} ${statusClass[state.report.status] ?? ""}`}>
            {messages.health.status[state.report.status]}
          </span>
        )}
      </header>

      {state.kind === "loading" && <p className={styles.muted}>{messages.health.loading}</p>}

      {state.kind === "error" && (
        <p role="alert" className={styles.error}>
          {state.message}
        </p>
      )}

      {state.kind === "loaded" && (
        <>
          <ul className={styles.list}>
            {state.report.components.map((component) => (
              <li key={component.name} className={styles.item}>
                <span className={`${styles.dot} ${statusClass[component.status] ?? ""}`} aria-hidden="true" />
                <span className={styles.name}>{messages.health.components[component.name] ?? component.name}</span>
                <span className={styles.muted}>{messages.health.status[component.status]}</span>
                <span className={styles.latency}>{messages.health.latency(component.latencyMs)}</span>
              </li>
            ))}
          </ul>
          {state.report.version && (
            <p className={styles.meta}>
              {messages.health.version}: <code>{state.report.version}</code>
            </p>
          )}
        </>
      )}

      <button type="button" className={styles.retry} onClick={() => void refresh()} disabled={state.kind === "loading"}>
        {messages.health.retry}
      </button>
    </section>
  );
}

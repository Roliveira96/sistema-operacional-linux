"use client";

import { useEffect, useMemo, useState } from "react";
import { signalName } from "@/engine/processes/signals";
import type { EndedEntry, ProcessEntry, ProcessSnapshot } from "@/engine/processes/snapshot";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./ProcessPanel.module.scss";

const m = contentMessages.topic.processes;

/** How long a process the signal ended stays on the panel, so the effect of a kill can be seen. */
const ENDED_VISIBLE_MS = 12_000;

/** What the panel needs of the terminal: the processes, the way `ps` and `top` read them (SPEC-029 RN-06). */
export interface ProcessSource {
  processes?: () => ProcessSnapshot | { processos: unknown[]; encerrados: unknown[] };
}

interface Row {
  entry: ProcessEntry;
  depth: number;
}

/** The processes in the order of the tree: each one under its parent, the parents that are not on the list first. */
function inTreeOrder(entries: ProcessEntry[]): Row[] {
  const pids = new Set(entries.map((e) => e.pid));
  const children = new Map<number, ProcessEntry[]>();
  const roots: ProcessEntry[] = [];
  for (const entry of [...entries].sort((a, b) => a.pid - b.pid)) {
    if (pids.has(entry.ppid) && entry.ppid !== entry.pid) children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry]);
    else roots.push(entry);
  }
  const rows: Row[] = [];
  const walk = (entry: ProcessEntry, depth: number) => {
    rows.push({ entry, depth });
    for (const child of children.get(entry.pid) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return rows;
}

const signalText = (signal: number) => `${signal} (${signalName(signal) ?? "?"})`;

/**
 * A read-only view of the processes of the machine, alive: who is running, sleeping or stopped, with the priority and the parent of each, and
 * the ones a signal has just ended with the signal that did it (SPEC-029 entrega B). It reads the same table that `ps` and `top` read.
 */
export function ProcessPanel({ source, intervalMs = 500 }: { source: ProcessSource | null; intervalMs?: number }) {
  const [snapshot, setSnapshot] = useState<ProcessSnapshot>({ processos: [], encerrados: [] });
  const [recent, setRecent] = useState<{ entry: EndedEntry; at: number }[]>([]);

  useEffect(() => {
    if (!source?.processes) return;
    const seen = new Set<string>();
    const poll = () => {
      const now = Date.now();
      const next = source.processes!() as ProcessSnapshot;
      setSnapshot(next);
      // An ended process is told once, when it first shows, and stays for a while.
      const fresh = next.encerrados.filter((e) => !seen.has(`${e.pid}:${e.sinal}`));
      for (const e of fresh) seen.add(`${e.pid}:${e.sinal}`);
      setRecent((current) => [...current.filter((r) => now - r.at < ENDED_VISIBLE_MS), ...fresh.map((entry) => ({ entry, at: now }))].slice(-8));
    };
    // The ones that had already ended when the panel opened are history, not news.
    for (const e of (source.processes() as ProcessSnapshot).encerrados) seen.add(`${e.pid}:${e.sinal}`);
    // The first reading comes right away, then it follows the machine.
    const first = window.setTimeout(poll, 0);
    const timer = window.setInterval(poll, intervalMs);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [source, intervalMs]);

  const rows = useMemo(() => inTreeOrder(snapshot.processos), [snapshot.processos]);
  const showEnded = recent.filter((r) => !snapshot.processos.some((p) => p.pid === r.entry.pid));

  return (
    <section className={styles.panel} aria-label={m.title}>
      <header className={styles.head}>
        <h3 className={styles.title}>
          <span aria-hidden="true">🧭</span> {m.title}
        </h3>
        <span className={styles.count}>{m.count(rows.length)}</span>
      </header>
      {rows.length === 0 && showEnded.length === 0 ? (
        <p className={styles.empty}>{m.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{m.caption}</caption>
            <thead>
              <tr>
                <th scope="col">{m.columns.pid}</th>
                <th scope="col">{m.columns.ppid}</th>
                <th scope="col">{m.columns.user}</th>
                <th scope="col">{m.columns.state}</th>
                <th scope="col">{m.columns.nice}</th>
                <th scope="col">{m.columns.command}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ entry, depth }) => (
                <tr key={entry.pid} data-state={entry.estado}>
                  <td>{entry.pid}</td>
                  <td>{entry.ppid}</td>
                  <td>{entry.usuario}</td>
                  <td>
                    <span className={`${styles.badge} ${entry.estado === "T" ? styles.stopped : styles.sleeping}`}>
                      <span aria-hidden="true">{entry.estado === "T" ? "⏸️" : "💤"}</span> {m.states[entry.estado === "T" ? "T" : "S"]}
                    </span>
                  </td>
                  <td>{entry.nice}</td>
                  <td className={styles.command}>
                    {depth > 0 && <span aria-hidden="true">{"  ".repeat(depth - 1)}└─ </span>}
                    <code>{entry.comando}</code>
                  </td>
                </tr>
              ))}
              {showEnded.map(({ entry }) => (
                <tr key={`ended-${entry.pid}-${entry.sinal}`} data-state="ended">
                  <td>{entry.pid}</td>
                  <td>—</td>
                  <td>—</td>
                  <td>
                    <span className={`${styles.badge} ${styles.ended}`}>
                      <span aria-hidden="true">⏹️</span> {m.ended(signalText(entry.sinal))}
                    </span>
                  </td>
                  <td>—</td>
                  <td className={styles.command}>
                    <code>{entry.comando}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.legend}>{m.legend}</p>
    </section>
  );
}

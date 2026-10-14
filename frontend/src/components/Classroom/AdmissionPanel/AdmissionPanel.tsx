"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { AdmissionEntry } from "@/services/classroomService";
import styles from "./AdmissionPanel.module.scss";

const m = messages.classroom.admission;

export interface AdmissionPanelProps {
  waiting: AdmissionEntry[];
  admitted: AdmissionEntry[];
  onAccept(studentId: string): void;
  onAcceptAll(): void;
  /** Declines who waits, or removes who is in the class. */
  onRemove(studentId: string): void;
}

/** The clock of the panel, so the waits go up while it stays open. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

/** The waiting room and the list of who is in the class, for the teacher (SPEC-054 CA-06). */
export function AdmissionPanel({ waiting, admitted, onAccept, onAcceptAll, onRemove }: AdmissionPanelProps) {
  const now = useMinuteClock();
  const [seen, setSeen] = useState(() => waiting.map((w) => w.studentId));
  const [arrival, setArrival] = useState<string | null>(null);
  const known = waiting.map((w) => w.studentId);
  if (known.some((id) => !seen.includes(id))) {
    const fresh = waiting.find((w) => !seen.includes(w.studentId));
    setSeen(known);
    setArrival(fresh?.name ?? null);
  } else if (known.length !== seen.length) {
    setSeen(known);
  }

  const waited = (entry: AdmissionEntry) =>
    entry.requestedAt ? m.since(Math.max(0, Math.floor((now - new Date(entry.requestedAt).getTime()) / 60_000))) : null;

  return (
    <section className={styles.panel} aria-labelledby="admission-title">
      <h2 id="admission-title" className={styles.title}>
        {m.title}
      </h2>
      {arrival && (
        <p className={styles.arrival} role="status">
          {m.newArrival(arrival)}
        </p>
      )}

      {waiting.length === 0 ? (
        <p className={styles.muted}>{m.empty}</p>
      ) : (
        <>
          <ul className={styles.list} aria-label={m.waitingList}>
            {waiting.map((entry) => (
              <li key={entry.studentId} className={styles.item}>
                <span className={styles.who}>
                  <span className={styles.name}>{entry.name}</span>
                  {waited(entry) && <span className={styles.muted}>{waited(entry)}</span>}
                </span>
                <span className={styles.actions}>
                  <Button variant="secondary" size="sm" aria-label={m.accept(entry.name)} onClick={() => onAccept(entry.studentId)}>
                    {m.acceptShort}
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={m.decline(entry.name)} onClick={() => onRemove(entry.studentId)}>
                    {m.declineShort}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <Button variant="primary" size="sm" onClick={onAcceptAll}>
            {m.acceptAll}
          </Button>
        </>
      )}

      <p className={styles.count}>{m.accepted(admitted.length)}</p>
      {admitted.length > 0 && (
        <ul className={styles.list} aria-label={m.inClassList}>
          {admitted.map((entry) => (
            <li key={entry.studentId} className={styles.item}>
              <span className={styles.name}>{entry.name}</span>
              <Button variant="ghost" size="sm" aria-label={m.remove(entry.name)} onClick={() => onRemove(entry.studentId)}>
                {m.removeShort}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

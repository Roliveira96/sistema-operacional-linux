"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { formatDateTime, formatScore } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AttemptRow } from "@/services/assessmentService";
import styles from "./AssessmentAttempts.module.scss";

const t = messages.assessments.attempts;

export interface AssessmentAttemptsProps {
  maxScore: number;
  load: () => Promise<{ items: AttemptRow[]; serverNow: string }>;
}

/** The attempts of the exam for the teacher (SPEC-090 CA-15): who entered, the situation, the instants and the preliminary score. */
export function AssessmentAttempts({ maxScore, load }: AssessmentAttemptsProps) {
  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    load().then(
      (got) => {
        if (!alive) return;
        setRows(got.items);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [load, round]);

  return (
    <section className={styles.section}>
      <div className={styles.head}>
        <h2 className={styles.heading}>{t.title}</h2>
        <Button variant="secondary" onClick={() => setRound((n) => n + 1)}>
          {t.refresh}
        </Button>
      </div>
      {failed && <p role="alert">{t.loadError}</p>}
      {rows && rows.length === 0 && <p className={styles.text}>{t.empty}</p>}
      {rows && rows.length > 0 && (
        <div className={styles.scroll}>
        <table aria-label={t.title} className={styles.table}>
          <thead>
            <tr>
              {Object.values(t.columns).map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.attemptId}>
                <td>{r.studentName}</td>
                <td>{r.academicId}</td>
                <td>{t.status[r.status] ?? r.status}</td>
                <td>{formatDateTime(r.startedAt)}</td>
                <td>{r.submittedAt ? formatDateTime(r.submittedAt) : "—"}</td>
                <td>{r.preliminaryScore === undefined ? "—" : t.score(formatScore(r.preliminaryScore), formatScore(maxScore), r.pendingItems ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
    </section>
  );
}

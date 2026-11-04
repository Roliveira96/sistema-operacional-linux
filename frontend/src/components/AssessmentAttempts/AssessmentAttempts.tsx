"use client";

import { useEffect, useState } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { ChatThread } from "@/components/ExamChat/ExamChat";
import { formatDateTime, formatScore } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AttemptRow, ExamChatMessage } from "@/services/assessmentService";
import styles from "./AssessmentAttempts.module.scss";

const t = messages.assessments.attempts;
const c = messages.assessments.chat;

export interface AssessmentAttemptsProps {
  maxScore: number;
  load: () => Promise<{ items: AttemptRow[]; serverNow: string }>;
  /** The whole conversation of an attempt (SPEC-093 RN-07); without it the column has no button. */
  loadChat?: (attemptId: string) => Promise<{ messages: ExamChatMessage[] }>;
}

/** The attempts of the exam for the teacher (SPEC-090 CA-15): who entered, the situation, the instants and the preliminary score. */
export function AssessmentAttempts({ maxScore, load, loadChat }: AssessmentAttemptsProps) {
  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  // the conversation open in the dialog, read only (SPEC-093 CA-09)
  const [reading, setReading] = useState<{ row: AttemptRow; list: ExamChatMessage[] | null; failed: boolean } | null>(null);
  const readChat = (row: AttemptRow) => {
    if (!loadChat) return;
    setReading({ row, list: null, failed: false });
    loadChat(row.attemptId).then(
      (got) => setReading((now) => (now?.row === row ? { ...now, list: got.messages } : now)),
      () => setReading((now) => (now?.row === row ? { ...now, failed: true } : now)),
    );
  };
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
                <td>
                  {loadChat && (r.chatCount ?? 0) > 0 ? (
                    <Button variant="secondary" onClick={() => readChat(r)}>
                      {c.attemptButton(r.chatCount!)}
                    </Button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {reading && (
        <AssessmentDialog title={c.attemptTitle(reading.row.studentName)} onClose={() => setReading(null)}>
          {reading.failed ? (
            <p role="alert">{c.loadError}</p>
          ) : reading.list === null ? (
            <p role="status">{c.loading}</p>
          ) : (
            <ChatThread viewer="record" studentName={reading.row.studentName} messages={reading.list} />
          )}
          <div className={dialog.actions}>
            <Button variant="secondary" onClick={() => setReading(null)}>
              {c.close}
            </Button>
          </div>
        </AssessmentDialog>
      )}
    </section>
  );
}

"use client";

import { useId } from "react";
import { Button } from "@/components/Button/Button";
import { formatPeriod, formatScore, needsClearanceWarning, situationOf } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AssessmentSummary } from "@/services/assessmentService";
import styles from "./AssessmentList.module.scss";

const m = messages.assessments;

export interface AssessmentListProps {
  status: "loading" | "error" | "ready";
  items: AssessmentSummary[];
  onNew: () => void;
  onRetry: () => void;
  onView: (assessment: AssessmentSummary) => void;
  onEdit: (assessment: AssessmentSummary) => void;
  onPreview: (assessment: AssessmentSummary) => void;
  onReschedule: (assessment: AssessmentSummary) => void;
  onCancel: (assessment: AssessmentSummary) => void;
  /** The clock of the server, which says whether an exam is about to start (SPEC-076 RN-13). */
  serverNow?: string;
  /** Clears everybody who waits, and opens the screen of the clearances; the warning shows each button only when it is given. */
  onApproveAll?: (assessment: AssessmentSummary) => void;
  onClearances?: (assessment: AssessmentSummary) => void;
}

/** Why the actions of the row are off, in text: a canceled one is only read, an ended one cannot be rescheduled (SPEC-075 CA-23). */
function reasonOf(a: AssessmentSummary): string | null {
  if (a.status === "CANCELED") return m.list.canceled;
  return a.phase === "ENDED" ? m.list.ended : null;
}

/** The list of the assessments of the class for the teacher (SPEC-075 section 3.1): one row each, with the actions the phase allows. */
export function AssessmentList({ status, items, onNew, onRetry, onView, onEdit, onPreview, onReschedule, onCancel, serverNow, onApproveAll, onClearances }: AssessmentListProps) {
  const baseId = useId();
  const newButton = (
    <Button variant="primary" onClick={onNew}>
      {m.list.new}
    </Button>
  );

  if (status === "loading") {
    return (
      <div className={styles.box}>
        <div className={styles.top}>{newButton}</div>
        <p role="status" className={styles.muted}>
          {m.list.loading}
        </p>
      </div>
    );
  }
  if (status === "error") {
    return (
      <div className={styles.box}>
        <div className={styles.top}>{newButton}</div>
        <div role="alert" className={styles.problem}>
          <span>{m.list.loadError}</span>
          <Button variant="secondary" onClick={onRetry}>
            {m.retry}
          </Button>
        </div>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className={styles.box}>
        <div className={styles.top}>{newButton}</div>
        <p className={styles.muted}>{m.list.empty}</p>
      </div>
    );
  }

  return (
    <div className={styles.box}>
      <div className={styles.top}>{newButton}</div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              {m.list.columns.map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((a) => {
              const reason = reasonOf(a);
              const canceled = a.status === "CANCELED";
              const reasonId = `${baseId}-${a.id}`;
              const off = (disabled: boolean) => ({ disabled, "aria-describedby": disabled ? reasonId : undefined });
              const waiting = a.status === "SCHEDULED" && a.modality === "IN_PERSON" && a.requiresClearance ? a.clearanceCounts.pending : 0;
              return [
                <tr key={a.id} data-canceled={canceled ? "true" : undefined}>
                  <td>{m.type[a.type]}</td>
                  <td>
                    <span>{m.modality[a.modality]}</span>
                    {waiting > 0 && <span className={styles.waiting}>{m.list.awaiting(waiting)}</span>}
                  </td>
                  <td className={styles.title}>{canceled ? <s>{a.title}</s> : a.title}</td>
                  <td>{formatPeriod(a.startsAt, a.endsAt)}</td>
                  <td>
                    <span className={styles.phase} data-phase={canceled ? "CANCELED" : a.phase}>
                      {situationOf(a)}
                    </span>
                  </td>
                  <td>{formatScore(a.maxScore)}</td>
                  <td>{m.composition[a.composition]}</td>
                  <td>{a.eligibleStudents}</td>
                  <td>
                    <div className={styles.actions}>
                      <Button variant="secondary" aria-label={`${m.list.actions.view} ${a.title}`} onClick={() => onView(a)}>
                        {m.list.actions.view}
                      </Button>
                      <Button variant="secondary" aria-label={`${m.list.actions.edit} ${a.title}`} onClick={() => onEdit(a)} {...off(canceled)}>
                        {m.list.actions.edit}
                      </Button>
                      <Button variant="secondary" aria-label={`${m.list.actions.preview} ${a.title}`} onClick={() => onPreview(a)}>
                        {m.list.actions.preview}
                      </Button>
                      <Button variant="secondary" aria-label={`${m.list.actions.reschedule} ${a.title}`} onClick={() => onReschedule(a)} {...off(reason !== null)}>
                        {m.list.actions.reschedule}
                      </Button>
                      <Button variant="danger" aria-label={`${m.list.actions.cancel} ${a.title}`} onClick={() => onCancel(a)} {...off(canceled)}>
                        {m.list.actions.cancel}
                      </Button>
                    </div>
                    {reason && (
                      <p id={reasonId} className={styles.reason}>
                        {reason}
                      </p>
                    )}
                  </td>
                </tr>,
                needsClearanceWarning(a, serverNow) && (
                  <tr key={`${a.id}-warning`}>
                    <td colSpan={m.list.columns.length}>
                      <div role="status" className={styles.warning}>
                        <span>{m.list.warning(a.title, a.clearanceCounts.pending)}</span>
                        {onApproveAll && (
                          <Button variant="primary" onClick={() => onApproveAll(a)}>
                            {m.list.approveAll}
                          </Button>
                        )}
                        {onClearances && (
                          <Button variant="secondary" onClick={() => onClearances(a)}>
                            {m.list.seeClearances}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

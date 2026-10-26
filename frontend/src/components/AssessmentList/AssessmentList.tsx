"use client";

import Link from "next/link";
import { useId } from "react";
import { Button } from "@/components/Button/Button";
import { ActionMenu } from "@/components/ContentTab/ActionMenu";
import { formatPeriod, formatScore, groupBySituation, needsClearanceWarning, needsStartWarning, situationOf } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AssessmentSummary } from "@/services/assessmentService";
import styles from "./AssessmentList.module.scss";

const m = messages.assessments;

export interface AssessmentListProps {
  status: "loading" | "error" | "ready";
  items: AssessmentSummary[];
  /** The address of the page of an assessment: the title of each row is the link to it. */
  hrefOf: (assessment: AssessmentSummary) => string;
  onNew: () => void;
  onRetry: () => void;
  onEdit: (assessment: AssessmentSummary) => void;
  onPreview: (assessment: AssessmentSummary) => void;
  onReschedule: (assessment: AssessmentSummary) => void;
  onCancel: (assessment: AssessmentSummary) => void;
  /** Clears everybody who waits, and opens the screen of the clearances; the warning shows each button only when it is given. */
  onApproveAll?: (assessment: AssessmentSummary) => void;
  onClearances?: (assessment: AssessmentSummary) => void;
  /** Opens the start of the exam, from the warning that it can be started (SPEC-083 D-06). */
  onStart?: (assessment: AssessmentSummary) => void;
}

/** Why the actions of the row are off, in text: a canceled one is only read, an ended one cannot be rescheduled (SPEC-075 CA-23). */
function reasonOf(a: AssessmentSummary): string | null {
  if (a.status === "CANCELED") return m.list.canceled;
  return a.phase === "ENDED" ? m.list.ended : null;
}

/**
 * The list of the assessments of the class for the teacher (SPEC-080): sections by situation, one row each with the title as the link, Editar in
 * view and the other actions in the menu Mais ações. A narrow screen shows each one as a card.
 */
export function AssessmentList({ status, items, hrefOf, onNew, onRetry, onEdit, onPreview, onReschedule, onCancel, onApproveAll, onClearances, onStart }: AssessmentListProps) {
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

  const [, periodColumn, situationColumn, studentsColumn, actionsColumn] = m.list.columns as [string, string, string, string, string];

  return (
    <div className={styles.box}>
      <div className={styles.top}>{newButton}</div>
      {groupBySituation(items).map(({ situation, items: group }) => {
        const headingId = `${baseId}-${situation}`;
        return (
          <section key={situation} className={styles.section} aria-labelledby={headingId}>
            <h2 id={headingId} className={styles.sectionTitle}>
              {`${m.list.sections[situation]} (${group.length})`}
            </h2>
            <div className={styles.scroll}>
              <table className={styles.table} aria-labelledby={headingId}>
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
                  {group.map((a) => {
                    const reason = reasonOf(a);
                    const canceled = a.status === "CANCELED";
                    const reasonId = `${baseId}-${a.id}`;
                    const waiting = a.status === "SCHEDULED" && a.modality === "IN_PERSON" && a.requiresClearance ? a.clearanceCounts.pending : 0;
                    return [
                      <tr key={a.id} data-canceled={canceled ? "true" : undefined}>
                        <td className={styles.main}>
                          <Link href={hrefOf(a)} className={styles.titleLink}>
                            {canceled ? <s>{a.title}</s> : a.title}
                          </Link>
                          <span className={styles.details}>{m.list.details(m.type[a.type] ?? a.type, m.modality[a.modality] ?? a.modality, formatScore(a.maxScore))}</span>
                          {waiting > 0 && <span className={styles.waiting}>{m.list.awaiting(waiting)}</span>}
                          {reason && (
                            <p id={reasonId} className={styles.reason}>
                              {reason}
                            </p>
                          )}
                        </td>
                        <td data-label={periodColumn}>{formatPeriod(a.startsAt, a.endsAt)}</td>
                        <td data-label={situationColumn}>
                          <span className={styles.phase} data-phase={canceled ? "CANCELED" : a.phase}>
                            {situationOf(a)}
                          </span>
                        </td>
                        <td data-label={studentsColumn}>{a.eligibleStudents}</td>
                        <td className={styles.actions} data-label={actionsColumn}>
                          <Button
                            variant="secondary"
                            aria-label={`${m.list.actions.edit} ${a.title}`}
                            onClick={() => onEdit(a)}
                            disabled={canceled}
                            aria-describedby={canceled ? reasonId : undefined}
                          >
                            {m.list.actions.edit}
                          </Button>
                          <ActionMenu
                            wide
                            floating
                            label={m.list.moreLabel(a.title)}
                            text={m.list.moreText}
                            actions={[
                              { key: "preview", label: m.list.actions.preview, onSelect: () => onPreview(a) },
                              {
                                key: "reschedule",
                                label: m.list.actions.reschedule,
                                onSelect: () => onReschedule(a),
                                disabled: reason !== null,
                                describedBy: reason ? reasonId : undefined,
                              },
                              {
                                key: "cancel",
                                label: m.list.actions.cancel,
                                onSelect: () => onCancel(a),
                                danger: true,
                                disabled: canceled,
                                describedBy: canceled ? reasonId : undefined,
                              },
                            ]}
                          />
                        </td>
                      </tr>,
                      needsStartWarning(a) && onStart && (
                        <tr key={`${a.id}-start`}>
                          <td colSpan={m.list.columns.length}>
                            <div role="status" className={styles.warning}>
                              <span>{m.list.canStart(a.title)}</span>
                              <Button variant="primary" onClick={() => onStart(a)}>
                                {m.list.start}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ),
                      needsClearanceWarning(a) && (
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
          </section>
        );
      })}
    </div>
  );
}

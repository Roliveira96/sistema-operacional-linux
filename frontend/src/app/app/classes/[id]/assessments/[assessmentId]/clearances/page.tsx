"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { ClearanceRejectDialog } from "@/components/ClearanceRejectDialog/ClearanceRejectDialog";
import { useRouteParams } from "@/hooks/useRouteParams";
import { formatMoment } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import {
  assessmentService,
  describeAssessmentError,
  type AssessmentDetail,
  type ClearanceInput,
  type ClearanceItem,
  type ClearanceList,
} from "@/services/assessmentService";
import shared from "../../page.module.scss";
import styles from "./page.module.scss";

const m = messages.assessments.clearances;

/**
 * The clearances of the students of an in-person assessment (SPEC-076 section 3.1): the eligible students with their state, the counters, the way to
 * clear everybody who waits, and to clear or refuse one by one, the refusal with an optional reason. With the assessment ended, canceled or not
 * requiring the clearance, the screen only reads, and says why.
 */
export default function ClearancesPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;

  const [list, setList] = useState<ClearanceList | null>(null);
  const [assessment, setAssessment] = useState<AssessmentDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [refusing, setRefusing] = useState<ClearanceItem | null>(null);

  useEffect(() => {
    if (!classId || !assessmentId) return;
    let alive = true;
    Promise.all([assessmentService.clearances(classId, assessmentId), assessmentService.get(classId, assessmentId)]).then(
      ([clearances, detail]) => {
        if (!alive) return;
        setList(clearances);
        setAssessment(detail as AssessmentDetail);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, attempt]);

  const back = (
    <Link href={`/app/classes/${classId}/assessments/${assessmentId}`} className={shared.back}>
      {messages.assessments.back.toAssessment}
    </Link>
  );

  /** Sends a decision and shows the list that the server answers; a failure is for whoever asked to read. */
  const decide = async (input: ClearanceInput) => {
    setList(await assessmentService.decideClearances(classId!, assessmentId!, input));
  };
  const run = async (input: ClearanceInput) => {
    setProblem(null);
    try {
      await decide(input);
    } catch (cause) {
      setProblem(describeAssessmentError(cause));
    }
  };

  const heading = <h1 className={shared.title}>{m.title}</h1>;
  if (failed) {
    return (
      <main className={shared.container}>
        {back}
        {heading}
        <div className={shared.problem}>
          <span role="alert">{m.loadError}</span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {messages.assessments.retry}
          </Button>
        </div>
      </main>
    );
  }
  if (!list || !assessment) {
    return (
      <main className={shared.container}>
        {back}
        {heading}
        <p role="status" className={shared.muted}>
          {m.loading}
        </p>
      </main>
    );
  }

  const readOnly = assessment.status === "CANCELED" ? m.canceled : assessment.phase === "ENDED" ? m.ended : !list.requiresClearance ? m.notRequired : null;
  // before the teacher starts the exam the list is only read, and every decision is off with the reason tied to it (SPEC-083 RN-04)
  const notStarted = !readOnly && !assessment.startedAt;
  const lockedBy = notStarted ? "not-started" : undefined;

  return (
    <main className={shared.container}>
      {back}
      {heading}
      <p className={shared.text}>{assessment.title}</p>
      {readOnly && <p className={shared.notice}>{readOnly}</p>}
      {notStarted && (
        <p id="not-started" className={shared.notice}>
          {m.notStarted}{" "}
          <Link href={`/app/classes/${classId}/assessments/${assessmentId}`}>{m.toAssessment}</Link>
        </p>
      )}
      {problem && (
        <p role="alert" className={shared.problem}>
          {problem}
        </p>
      )}

      <dl className={styles.counts}>
        {(["pending", "approved", "rejected"] as const).map((key) => (
          <div key={key}>
            <dt>{m.counts[key]}</dt>
            <dd>{list.counts[key]}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.toolbar}>
        {!readOnly && (
          <Button variant="primary" disabled={list.counts.pending === 0 || notStarted} aria-describedby={notStarted ? "not-started" : undefined} onClick={() => void run({ action: "APPROVE_ALL" })}>
            {m.approveAll}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {m.refresh}
        </Button>
      </div>

      {list.items.length === 0 ? (
        <p className={shared.muted}>{m.empty}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                {m.columns.map((name) => (
                  <th key={name} scope="col">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.items.map((it) => (
                <tr key={it.studentId}>
                  <td className={styles.name}>{it.name}</td>
                  <td>{it.academicId}</td>
                  <td>
                    <span className={styles.status} data-status={it.status}>
                      {m.status[it.status]}
                    </span>
                  </td>
                  <td>{it.status === "REJECTED" ? it.rejectionReason || m.noReason : ""}</td>
                  <td>{it.clearedByName && it.clearedAt ? m.decidedBy(it.clearedByName, formatMoment(it.clearedAt)) : ""}</td>
                  <td>
                    {!readOnly && (
                      <div className={styles.actions}>
                        <Button
                          variant="secondary"
                          aria-label={m.approve(it.name)}
                          disabled={it.status === "APPROVED" || notStarted}
                          aria-describedby={lockedBy}
                          onClick={() => void run({ action: "UPDATE", students: [{ studentId: it.studentId, status: "APPROVED" }] })}
                        >
                          {m.approveLabel}
                        </Button>
                        <Button variant="danger" aria-label={m.reject(it.name)} disabled={it.status === "REJECTED" || notStarted} aria-describedby={lockedBy} onClick={() => setRefusing(it)}>
                          {m.rejectLabel}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {refusing && (
        <ClearanceRejectDialog
          student={refusing.name}
          onClose={() => setRefusing(null)}
          onConfirm={async (reason) => {
            await decide({ action: "UPDATE", students: [{ studentId: refusing.studentId, status: "REJECTED", ...(reason ? { rejectionReason: reason } : {}) }] });
            setRefusing(null);
          }}
        />
      )}
    </main>
  );
}

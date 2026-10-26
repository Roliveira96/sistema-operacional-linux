"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AssessmentCancelDialog } from "@/components/AssessmentCancelDialog/AssessmentCancelDialog";
import { AssessmentList } from "@/components/AssessmentList/AssessmentList";
import { AssessmentRescheduleDialog } from "@/components/AssessmentRescheduleDialog/AssessmentRescheduleDialog";
import { AssessmentStartDialog } from "@/components/AssessmentStartDialog/AssessmentStartDialog";
import { Button } from "@/components/Button/Button";
import { useAuth } from "@/hooks/useAuth";
import { formatPeriod, situationOf } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import { assessmentService, describeAssessmentError, type AssessmentBase, type AssessmentSummary, type RescheduleInput } from "@/services/assessmentService";
import styles from "./ClassAssessments.module.scss";

const m = messages.assessments;

type Dialog = { kind: "reschedule" | "cancel" | "start"; assessment: AssessmentSummary };

/**
 * The assessments of the class, the content of the tab Avaliações of the page of the class (SPEC-082, SPEC-075 section 3.1): the teacher and the
 * administrator get the list with its actions; the student gets what is public of the assessments they are eligible for, each one a link to its
 * page. It reads the list when it opens, so the page of the class does not read it while another tab is open.
 */
export function ClassAssessments({ classId }: { classId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const isStudent = user.role === "STUDENT";
  const id = classId;

  const [items, setItems] = useState<Array<AssessmentSummary | AssessmentBase>>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [reload, setReload] = useState(0);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    assessmentService.list(id).then(
      (result) => {
        if (!alive) return;
        setItems(result.items);
        setStatus("ready");
      },
      () => alive && setStatus("error"),
    );
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const retry = () => {
    setStatus("loading");
    setReload((n) => n + 1);
  };
  const base = `/app/classes/${id}/assessments`;
  /** Clears everybody who waits, from the warning of the list (SPEC-076 RN-13); it says why when the server refuses. */
  const approveAll = async (assessment: AssessmentSummary) => {
    setProblem(null);
    try {
      await assessmentService.decideClearances(id, assessment.id, { action: "APPROVE_ALL" });
      setReload((n) => n + 1);
    } catch (cause) {
      setProblem(describeAssessmentError(cause));
    }
  };
  const confirm = async (act: () => Promise<unknown>) => {
    await act();
    setDialog(null);
    setReload((n) => n + 1); // the list is read again, without going back to "loading"
  };

  return (
    <div className={styles.box}>
      {isStudent ? (
        status === "loading" ? (
          <p role="status" className={styles.muted}>
            {m.list.loading}
          </p>
        ) : status === "error" ? (
          <div role="alert" className={styles.problem}>
            <span>{m.list.loadError}</span>
            <Button variant="secondary" onClick={retry}>
              {m.retry}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className={styles.muted}>{m.list.empty}</p>
        ) : (
          <ul className={styles.cards}>
            {items.map((a) => (
              <li key={a.id} className={styles.card}>
                <span className={styles.kind}>{m.type[a.type]}</span>
                <Link href={`${base}/${a.id}`} className={styles.cardTitle}>
                  {a.status === "CANCELED" ? <s>{a.title}</s> : a.title}
                </Link>
                <span>{formatPeriod(a.startsAt, a.endsAt)}</span>
                <span className={styles.situation}>{situationOf(a)}</span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          {problem && (
            <p role="alert" className={styles.problem}>
              {problem}
            </p>
          )}
          <AssessmentList
            status={status}
            items={items as AssessmentSummary[]}
            onApproveAll={(a) => void approveAll(a)}
            onClearances={(a) => router.push(`${base}/${a.id}/clearances`)}
            onNew={() => router.push(`${base}/new`)}
            onRetry={retry}
            hrefOf={(a) => `${base}/${a.id}`}
            onEdit={(a) => router.push(`${base}/${a.id}/edit`)}
            onPreview={(a) => router.push(`${base}/${a.id}?preview=1`)}
            onReschedule={(assessment) => setDialog({ kind: "reschedule", assessment })}
            onCancel={(assessment) => setDialog({ kind: "cancel", assessment })}
            onStart={(assessment) => setDialog({ kind: "start", assessment })}
          />
          {dialog?.kind === "reschedule" && (
            <AssessmentRescheduleDialog
              assessment={dialog.assessment}
              onClose={() => setDialog(null)}
              onConfirm={(input: RescheduleInput) => confirm(() => assessmentService.reschedule(id, dialog.assessment.id, input))}
            />
          )}
          {dialog?.kind === "start" && (
            <AssessmentStartDialog
              assessment={dialog.assessment}
              onClose={() => setDialog(null)}
              onConfirm={() => confirm(() => assessmentService.start(id, dialog.assessment.id))}
            />
          )}
          {dialog?.kind === "cancel" && (
            <AssessmentCancelDialog
              assessment={dialog.assessment}
              onClose={() => setDialog(null)}
              onConfirm={(reason) => confirm(() => assessmentService.cancel(id, dialog.assessment.id, reason))}
            />
          )}
        </>
      )}
    </div>
  );
}

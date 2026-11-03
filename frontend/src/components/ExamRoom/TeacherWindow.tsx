"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/Button/Button";
import { useAuth } from "@/hooks/useAuth";
import { useRouteParams } from "@/hooks/useRouteParams";
import { messages } from "@/messages/pt-BR";
import { assessmentService, describeAssessmentError, type AssessmentDetail } from "@/services/assessmentService";
import styles from "@/app/app/classes/[id]/assessments/page.module.scss";
import own from "@/app/app/classes/[id]/assessments/[assessmentId]/simulate/page.module.scss";

const m = messages.assessments;

type Params = Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string };

/**
 * A window of the teacher and of the administrator over the whole screen, for the room of the exam and the clock for the class (SPEC-091, SPEC-092):
 * it loads the assessment and draws the children with it. A student goes back to the assessment.
 */
export function TeacherWindow({ params, children }: { params: Params; children: (classId: string, assessment: AssessmentDetail) => ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const isStudent = user.role === "STUDENT";
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;
  const backHref = `/app/classes/${classId}/assessments/${assessmentId}`;
  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (isStudent && classId && assessmentId) router.replace(backHref);
  }, [isStudent, classId, assessmentId, backHref, router]);

  useEffect(() => {
    if (!classId || !assessmentId || isStudent) return;
    let alive = true;
    assessmentService.get(classId, assessmentId).then(
      (got) => {
        if (!alive) return;
        setDetail(got as AssessmentDetail);
        setError(null);
      },
      (cause) => alive && setError(describeAssessmentError(cause)),
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, isStudent, round]);

  if (!classId || !assessmentId || isStudent) return null;
  return (
    <main className={own.window}>
      {error && (
        <div className={`${styles.problem} ${own.inset}`}>
          <span role="alert">{error}</span>
          <Button variant="secondary" onClick={() => setRound((n) => n + 1)}>
            {m.retry}
          </Button>
        </div>
      )}
      {!error && !detail && (
        <p role="status" className={`${styles.muted} ${own.inset}`}>
          {m.page.loading}
        </p>
      )}
      {detail && children(classId, detail)}
    </main>
  );
}

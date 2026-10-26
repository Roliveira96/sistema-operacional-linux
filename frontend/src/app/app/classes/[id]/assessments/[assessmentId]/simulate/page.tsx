"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AssessmentSimulator } from "@/components/AssessmentSimulator/AssessmentSimulator";
import { Button } from "@/components/Button/Button";
import { useAuth } from "@/hooks/useAuth";
import { useRouteParams } from "@/hooks/useRouteParams";
import { messages } from "@/messages/pt-BR";
import { assessmentService, describeAssessmentError, type AssessmentDetail } from "@/services/assessmentService";
import styles from "../../page.module.scss";
import own from "./page.module.scss";

const m = messages.assessments;

/**
 * The simulator of the exam (SPEC-081, SPEC-087): the teacher and the administrator go through the assessment as a student, in the window of the
 * exam, which covers the whole window without the menu of the platform. It only reads; the student has no simulator and goes back to the assessment.
 */
export default function SimulatePage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const isStudent = user.role === "STUDENT";
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;
  const backHref = `/app/classes/${classId}/assessments/${assessmentId}`;

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const loadPreview = useCallback(() => assessmentService.preview(classId!, assessmentId!), [classId, assessmentId]);
  const checkQuestion = useCallback((questionId: string, snapshot: unknown) => assessmentService.checkQuestion(classId!, assessmentId!, questionId, snapshot), [classId, assessmentId]);
  const loadScenario = useCallback((questionId: string) => assessmentService.questionScenario(classId!, assessmentId!, questionId), [classId, assessmentId]);
  /** Leaving closes the tab the simulator opened in; when the browser keeps the tab open, the page goes to the assessment instead (SPEC-087 D-01). */
  const exit = useCallback(() => {
    window.close();
    if (!window.closed) router.replace(backHref);
  }, [router, backHref]);

  useEffect(() => {
    if (isStudent && classId && assessmentId) router.replace(backHref);
  }, [isStudent, classId, assessmentId, backHref, router]);

  useEffect(() => {
    if (!classId || !assessmentId || isStudent) return;
    let alive = true;
    assessmentService.get(classId, assessmentId).then(
      (loaded) => {
        if (!alive) return;
        setDetail(loaded as AssessmentDetail);
        setError(null);
      },
      (cause) => alive && setError(describeAssessmentError(cause)),
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, isStudent, attempt]);

  if (!classId || !assessmentId || isStudent) return null;

  return (
    <main className={own.window}>
      <h1 className={own.srOnly}>{m.simulator.title}</h1>
      {error && (
        <div className={`${styles.problem} ${own.inset}`}>
          <span role="alert">{error}</span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {m.retry}
          </Button>
          <Button variant="secondary" onClick={exit}>
            {m.simulator.exit}
          </Button>
        </div>
      )}
      {!error && !detail && (
        <p role="status" className={styles.muted}>
          {m.page.loading}
        </p>
      )}
      {detail && <AssessmentSimulator detail={detail} load={loadPreview} loadScenario={loadScenario} checkQuestion={checkQuestion} onExit={exit} />}
    </main>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { ExamRunner } from "@/components/ExamRunner/ExamRunner";
import { useAuth } from "@/hooks/useAuth";
import { useRouteParams } from "@/hooks/useRouteParams";
import { messages } from "@/messages/pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import { assessmentService, describeAssessmentError, type StudentAttempt } from "@/services/assessmentService";
import styles from "../../page.module.scss";
import own from "../simulate/page.module.scss";

const m = messages.assessments;
const t = m.take;

/** Why the exam cannot be entered, in the words of the student (SPEC-090 RN-01). */
function reasonOf(cause: unknown): string {
  if (cause instanceof ApiProblemError && t.errors[cause.type]) return t.errors[cause.type]!;
  return describeAssessmentError(cause);
}

/**
 * The window of the exam of the student (SPEC-090): it enters the attempt, which the server creates the first time and gives back the next ones, and
 * shows it over the whole window, as the simulator does. The teacher and the administrator have no attempt and go back to the assessment.
 */
export default function TakePage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const isStudent = user.role === "STUDENT";
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;
  const backHref = `/app/classes/${classId}/assessments/${assessmentId}`;

  const [attempt, setAttempt] = useState<StudentAttempt | null>(null);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!isStudent && classId && assessmentId) router.replace(backHref);
  }, [isStudent, classId, assessmentId, backHref, router]);

  useEffect(() => {
    if (!classId || !assessmentId || !isStudent) return;
    let alive = true;
    assessmentService.get(classId, assessmentId).then(
      (got) => alive && setTitle(got.title),
      () => {},
    );
    assessmentService.enterAttempt(classId, assessmentId).then(
      (got) => {
        if (!alive) return;
        setAttempt(got);
        setError(null);
      },
      (cause) => alive && setError(reasonOf(cause)),
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, isStudent, round]);

  const save = useCallback((position: number, answer: unknown) => assessmentService.saveAnswer(classId!, assessmentId!, position, answer), [classId, assessmentId]);
  const check = useCallback((position: number, snapshot: unknown) => assessmentService.checkAnswer(classId!, assessmentId!, position, snapshot), [classId, assessmentId]);
  const submit = useCallback(() => assessmentService.submitAttempt(classId!, assessmentId!), [classId, assessmentId]);

  if (!classId || !assessmentId || !isStudent) return null;

  return (
    <main className={own.window}>
      <h1 className={own.srOnly}>{t.title}</h1>
      {error && (
        <div className={`${styles.problem} ${own.inset}`}>
          <span role="alert">{error}</span>
          <Button variant="secondary" onClick={() => setRound((n) => n + 1)}>
            {m.retry}
          </Button>
        </div>
      )}
      {!error && !attempt && (
        <p role="status" className={`${styles.muted} ${own.inset}`}>
          {t.loading}
        </p>
      )}
      {attempt && <ExamRunner attempt={attempt} title={title} save={save} check={check} submit={submit} />}
    </main>
  );
}

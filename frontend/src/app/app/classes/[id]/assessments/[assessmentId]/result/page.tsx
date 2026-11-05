"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ResultView } from "@/components/AssessmentResult/AssessmentResult";
import { useAuth } from "@/hooks/useAuth";
import { useRouteParams } from "@/hooks/useRouteParams";
import { messages } from "@/messages/pt-BR";
import { assessmentService, type StudentResult } from "@/services/assessmentService";
import styles from "../../page.module.scss";

const t = messages.assessments.result;

/** The correction of the exam of the student, once the grades are published (SPEC-098 CA-06); the teacher goes back to the assessment. */
export default function ResultPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const isStudent = user.role === "STUDENT";
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;
  const backHref = `/app/classes/${classId}/assessments/${assessmentId}`;
  const [title, setTitle] = useState("");
  const [result, setResult] = useState<StudentResult | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!isStudent && classId && assessmentId) router.replace(backHref);
  }, [isStudent, classId, assessmentId, backHref, router]);

  useEffect(() => {
    if (!isStudent || !classId || !assessmentId) return;
    let alive = true;
    assessmentService.get(classId, assessmentId).then(
      (got) => alive && setTitle(got.title),
      () => {},
    );
    assessmentService.myResult(classId, assessmentId).then(
      (got) => alive && setResult(got),
      () => alive && setMissing(true),
    );
    return () => {
      alive = false;
    };
  }, [isStudent, classId, assessmentId]);

  if (!isStudent || !classId || !assessmentId) return null;
  return (
    <main className={`${styles.container} ${styles.narrow}`}>
      <Link href={backHref} className={styles.back}>
        {t.back}
      </Link>
      <h1 className={styles.title}>{title || t.title}</h1>
      {missing && <p className={styles.text}>{t.notPublished}</p>}
      {!missing && !result && (
        <p role="status" className={styles.muted}>
          {t.loading}
        </p>
      )}
      {result && <ResultView result={result} />}
    </main>
  );
}

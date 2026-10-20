"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AssessmentForm } from "@/components/AssessmentForm/AssessmentForm";
import { Button } from "@/components/Button/Button";
import { useRouteParams } from "@/hooks/useRouteParams";
import { formInitialOf } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import { assessmentService, type AssessmentDetail, type AssessmentPatch, type QuestionQuery } from "@/services/assessmentService";
import { classService } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import styles from "../../page.module.scss";

const m = messages.assessments;

interface Ready {
  detail: AssessmentDetail;
  modules: { id: string; title: string }[];
  students: { id: string; name: string; academicId?: string }[];
}

/**
 * The edit of an assessment (SPEC-075 section 3.1). A started one locks the composition (the form knows it from `frozen`); the notes go by their
 * own route and only when they changed (RN-13); a canceled one is only read.
 */
export default function EditAssessmentPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const router = useRouter();
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;

  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!classId || !assessmentId) return;
    let alive = true;
    Promise.all([assessmentService.get(classId, assessmentId), moduleService.listModules({ classId, limit: 100 }), classService.listMembers(classId, "ACTIVE")]).then(
      ([detail, modules, members]) => {
        if (!alive) return;
        setFailed(false);
        setReady({
          detail: detail as AssessmentDetail,
          modules: modules.items.map((mod) => ({ id: mod.id, title: mod.title })),
          students: members.map((mb) => ({ id: mb.userId, name: mb.userName ?? mb.userEmail, academicId: mb.userAcademicId })),
        });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [classId, assessmentId, attempt]);

  const loadQuestions = useCallback((query: QuestionQuery) => assessmentService.eligibleQuestions(classId!, query), [classId]);
  const detailHref = `/app/classes/${classId}/assessments/${assessmentId}`;

  return (
    <main className={`${styles.container} ${styles.narrow}`}>
      <Link href={detailHref} className={styles.back}>
        {m.back.toAssessment}
      </Link>
      <h1 className={styles.title}>{m.page.editTitle}</h1>
      {failed ? (
        <div role="alert" className={styles.problem}>
          <span>{m.page.loadError}</span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {m.retry}
          </Button>
        </div>
      ) : !ready ? (
        <p role="status" className={styles.muted}>
          {m.page.loading}
        </p>
      ) : ready.detail.status === "CANCELED" ? (
        <p className={styles.notice}>{m.page.canceledReadOnly}</p>
      ) : (
        <AssessmentForm
          mode="edit"
          modules={ready.modules}
          students={ready.students}
          initial={formInitialOf(ready.detail)}
          frozen={ready.detail.frozen}
          loadQuestions={loadQuestions}
          onSubmit={async (value) => {
            const { teacherPrivateNotes, ...rest } = value;
            await assessmentService.update(classId!, assessmentId!, rest as AssessmentPatch);
            if (teacherPrivateNotes !== (ready.detail.teacherPrivateNotes ?? "")) await assessmentService.saveNotes(classId!, assessmentId!, teacherPrivateNotes);
            router.push(detailHref);
          }}
          onCancel={() => router.push(detailHref)}
        />
      )}
    </main>
  );
}

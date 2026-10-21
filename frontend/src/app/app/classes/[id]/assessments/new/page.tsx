"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AssessmentForm, type AssessmentFormInitial } from "@/components/AssessmentForm/AssessmentForm";
import { Button } from "@/components/Button/Button";
import { useRouteParams } from "@/hooks/useRouteParams";
import { messages } from "@/messages/pt-BR";
import { assessmentService, type AssessmentInput, type QuestionQuery } from "@/services/assessmentService";
import { classService } from "@/services/classService";
import { moduleService } from "@/services/moduleService";
import { scheduleService } from "@/services/scheduleService";
import styles from "../page.module.scss";

const m = messages.assessments;

interface Ready {
  modules: { id: string; title: string }[];
  students: { id: string; name: string; academicId?: string }[];
  initial?: AssessmentFormInitial;
}

/**
 * A new assessment (SPEC-075 section 3.1). With ?sessionId=, it is made from a lesson of the class: the start, end, title (the topic) and
 * module of the lesson come filled and editable, and the lesson itself does not change (CA-25).
 */
export default function NewAssessmentPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const router = useRouter();
  const sessionId = useSearchParams().get("sessionId");
  const id = useRouteParams(params)?.id ?? null;

  const [ready, setReady] = useState<Ready | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    Promise.all([
      moduleService.listModules({ classId: id, limit: 100 }),
      classService.listMembers(id, "ACTIVE"),
      sessionId ? scheduleService.getDiary(id, sessionId) : Promise.resolve(null),
    ]).then(
      ([modules, members, diary]) => {
        if (!alive) return;
        setFailed(false);
        setReady({
          modules: modules.items.map((mod) => ({ id: mod.id, title: mod.title })),
          students: members.map((mb) => ({ id: mb.userId, name: mb.userName ?? mb.userEmail, academicId: mb.userAcademicId })),
          initial: diary
            ? {
                classSessionId: sessionId!,
                ...(diary.content.topic ? { title: diary.content.topic } : {}),
                ...(diary.content.module ? { moduleId: diary.content.module.id } : {}),
                startsAt: diary.session.startsAt,
                endsAt: diary.session.endsAt,
              }
            : undefined,
        });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [id, sessionId, attempt]);

  const loadQuestions = useCallback((query: QuestionQuery) => assessmentService.eligibleQuestions(id!, query), [id]);

  return (
    <main className={`${styles.container} ${styles.narrow}`}>
      <Link href={`/app/classes/${id}/assessments`} className={styles.back}>
        {m.back.toList}
      </Link>
      <h1 className={styles.title}>{m.page.newTitle}</h1>
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
      ) : ready.modules.length === 0 ? (
        <p className={styles.notice}>
          {m.page.noModule} <Link href={`/app/classes/${id}/settings`}>{m.page.noModuleLink}</Link>
        </p>
      ) : (
        <AssessmentForm
          mode="create"
          modules={ready.modules}
          students={ready.students}
          initial={ready.initial}
          loadQuestions={loadQuestions}
          onSubmit={async (value) => {
            // A new assessment takes everything the form gathers.
            const created = await assessmentService.create(id!, value as AssessmentInput);
            router.push(`/app/classes/${id}/assessments/${created.id}`);
          }}
          onCancel={() => router.push(`/app/classes/${id}/assessments`)}
        />
      )}
    </main>
  );
}

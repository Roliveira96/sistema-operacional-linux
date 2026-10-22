"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AssessmentAccessNotice } from "@/components/AssessmentAccessNotice/AssessmentAccessNotice";
import { AssessmentCard } from "@/components/AssessmentCard/AssessmentCard";
import { AssessmentHistory } from "@/components/AssessmentHistory/AssessmentHistory";
import { AssessmentPreview, DrawRulesTable } from "@/components/AssessmentPreview/AssessmentPreview";
import { Button } from "@/components/Button/Button";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { useAuth } from "@/hooks/useAuth";
import { useRouteParams } from "@/hooks/useRouteParams";
import { formatPeriod, formatScore, situationOf } from "@/lib/assessment";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { messages } from "@/messages/pt-BR";
import { assessmentService, describeAssessmentError, type AssessmentDetail, type AssessmentPublic } from "@/services/assessmentService";
import styles from "../page.module.scss";

const m = messages.assessments;
const p = m.page;

/**
 * An assessment (SPEC-075 section 3.1). The student gets the card, with the countdown. The teacher and the administrator get its data, the
 * instructions, their private notes, the questions or the rules of the draw, the history, and the way to edit it and to preview it with the
 * answers; rescheduling and canceling live in the list.
 */
export default function AssessmentPage({ params }: { params: Promise<{ id: string; assessmentId: string }> | { id: string; assessmentId: string } }) {
  const { user } = useAuth();
  const isStudent = user.role === "STUDENT";
  const route = useRouteParams(params);
  const classId = route?.id ?? null;
  const assessmentId = route?.assessmentId ?? null;
  const preview = useSearchParams().get("preview") === "1";

  const [detail, setDetail] = useState<AssessmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [asked, setAsked] = useState(false);
  // The preview opens when the address asks for it or when the teacher presses the button; the student never has one.
  const showPreview = !isStudent && (preview || asked);

  const loadPublic = useCallback(async () => (await assessmentService.get(classId!, assessmentId!)) as AssessmentPublic, [classId, assessmentId]);
  const loadAccess = useCallback(() => assessmentService.myAccess(classId!, assessmentId!), [classId, assessmentId]);
  const loadPreview = useCallback(() => assessmentService.preview(classId!, assessmentId!), [classId, assessmentId]);

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

  const back = (
    <Link href={`/app/classes/${classId}/assessments`} className={styles.back}>
      {m.back.toList}
    </Link>
  );

  if (!classId || !assessmentId) return null;

  if (isStudent) {
    return (
      <main className={`${styles.container} ${styles.narrow}`}>
        {back}
        <AssessmentCard load={loadPublic} />
        <AssessmentAccessNotice load={loadAccess} />
      </main>
    );
  }

  if (error) {
    return (
      <main className={`${styles.container} ${styles.narrow}`}>
        {back}
        <div className={styles.problem}>
          <span role="alert">{error}</span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {m.retry}
          </Button>
        </div>
      </main>
    );
  }
  if (!detail) {
    return (
      <main className={`${styles.container} ${styles.narrow}`}>
        {back}
        <p role="status" className={styles.muted}>
          {p.loading}
        </p>
      </main>
    );
  }

  const canceled = detail.status === "CANCELED";
  const counts = detail.clearanceCounts;
  const facts: [string, string][] = [
    [p.facts.type, m.type[detail.type] ?? ""],
    [p.facts.modality, m.modality[detail.modality] ?? ""],
    [p.facts.phase, situationOf(detail)],
    [p.facts.period, formatPeriod(detail.startsAt, detail.endsAt)],
    [p.facts.maxScore, formatScore(detail.maxScore)],
    [p.facts.module, detail.moduleTitle],
    [p.facts.composition, m.composition[detail.composition] ?? ""],
    [p.facts.audience, m.audience[detail.audience] ?? ""],
    [p.facts.eligible, String(detail.eligibleStudents)],
    [p.facts.createdBy, detail.createdByName],
  ];

  return (
    <main className={`${styles.container} ${styles.narrow}`}>
      {back}
      <h1 className={styles.title}>{canceled ? <s>{detail.title}</s> : detail.title}</h1>
      {canceled && (
        <p className={styles.notice}>
          <strong>{m.canceledBanner}</strong> {detail.cancelReason}
        </p>
      )}
      <div className={styles.actions}>
        {!canceled && (
          <ButtonLink href={`/app/classes/${classId}/assessments/${assessmentId}/edit`} variant="primary">
            {p.edit}
          </ButtonLink>
        )}
        <Button variant="secondary" onClick={() => setAsked(true)}>
          {p.preview}
        </Button>
        <ButtonLink href={`/app/classes/${classId}/assessments/${assessmentId}/simulate`} variant="secondary">
          {p.simulate}
        </ButtonLink>
        {detail.modality === "IN_PERSON" && detail.requiresClearance && (
          <ButtonLink href={`/app/classes/${classId}/assessments/${assessmentId}/clearances`} variant="secondary">
            {p.clearances}
          </ButtonLink>
        )}
      </div>
      {detail.modality === "IN_PERSON" && detail.requiresClearance && <p className={styles.text}>{p.clearanceCounts(counts.pending, counts.approved, counts.rejected)}</p>}

      <dl className={styles.facts}>
        {facts.map(([term, value]) => (
          <div key={term} className={styles.fact}>
            <dt>{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <section className={styles.section}>
        <h2 className={styles.heading}>{p.instructions}</h2>
        {detail.description ? (
          // HTML that the server filtered when the instructions were saved (SPEC-077 RN-01).
          <div className={styles.richText} dangerouslySetInnerHTML={{ __html: detail.description }} />
        ) : (
          <p className={styles.text}>—</p>
        )}
      </section>
      <section className={styles.section}>
        <h2 className={styles.heading}>{p.privateNotes}</h2>
        <p className={styles.text}>{detail.teacherPrivateNotes || p.noNotes}</p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.heading}>{p.questions}</h2>
        {detail.composition === "DRAW" ? (
          <DrawRulesTable rules={detail.drawRules} />
        ) : (
          <ul className={styles.plain} aria-label={p.questions}>
            {detail.items.map((item) => (
              <li key={item.questionId}>
                {item.title} · {(authoringMessages.questionKinds.label as Record<string, string>)[item.kind] ?? item.kind} · {m.difficulty[item.difficulty]} · {m.points(formatScore(item.weight))}
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.audience === "SELECTED" && (
        <section className={styles.section}>
          <h2 className={styles.heading}>{p.students}</h2>
          <ul className={styles.plain}>
            {detail.students.map((s) => (
              <li key={s.studentId}>
                {s.name} ({s.academicId})
              </li>
            ))}
          </ul>
        </section>
      )}

      {showPreview && (
        <section className={styles.section}>
          <h2 className={styles.heading}>{p.previewTitle}</h2>
          <AssessmentPreview load={loadPreview} />
        </section>
      )}

      <AssessmentHistory events={detail.events} />
    </main>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatScore } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import {
  assessmentService,
  type AssessmentDetail,
  type AttemptRow,
  type Review,
} from "@/services/assessmentService";
import styles from "./ExamReview.module.scss";
import { ReviewAttempt } from "./ReviewAttempt";

const t = messages.assessments.review;

type Filter = "all" | "pending" | "done";
const FILTERS: Filter[] = ["all", "pending", "done"];
const matches: Record<Filter, (r: AttemptRow) => boolean> = {
  all: () => true,
  pending: (r) => !r.reviewed,
  done: (r) => !!r.reviewed,
};
/** Who delivered the exam: delivered, out of time or ended by the teacher; never who did not come nor an attempt in progress (SPEC-097 RN-01). */
const delivered = (r: AttemptRow) =>
  r.status === "SUBMITTED" ||
  r.status === "TIME_EXPIRED" ||
  r.status === "ENDED_BY_TEACHER";

export interface ExamReviewProps {
  classId: string;
  assessment: AssessmentDetail;
}

/**
 * The correction of the exam (SPEC-097): the students who delivered, to review or reviewed, with the filter; the teacher picks one and corrects the
 * attempt beside the list.
 */
export function ExamReview({ classId, assessment }: ExamReviewProps) {
  const id = assessment.id;
  const [rows, setRows] = useState<AttemptRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    assessmentService.attempts(classId, id).then(
      (got) => alive && setRows(got.items.filter(delivered)),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [classId, id]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    assessmentService.review(classId, id, selected).then(
      (got) => alive && setReview(got),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [classId, id, selected]);

  /** The review of a student concluded: she is marked reviewed and the next one to review opens, in the order of the list (CA-07). */
  const finished = (done: Review) => {
    const next = (rows ?? []).find(
      (r) => !r.reviewed && r.attemptId !== done.attemptId,
    );
    setRows(
      (list) =>
        list?.map((r) =>
          r.attemptId === done.attemptId
            ? { ...r, reviewed: true, finalScore: done.finalScore }
            : r,
        ) ?? null,
    );
    if (next) {
      setReview(null);
      setSelected(next.attemptId!);
    } else setReview(done);
  };

  const all = rows ?? [];
  const reviewed = all.filter((r) => r.reviewed).length;
  const shown = all.filter(matches[filter]);

  return (
    <div className={styles.review}>
      <header className={styles.header}>
        <Link
          href={`/app/classes/${classId}/assessments/${id}`}
          className={styles.back}
        >
          {t.back}
        </Link>
        <div className={styles.titles}>
          <p className={styles.kicker}>{t.title}</p>
          <h1 className={styles.title}>{assessment.title}</h1>
        </div>
        {rows && (
          <p className={styles.progress}>{t.progress(reviewed, all.length)}</p>
        )}
      </header>
      {failed && <p role="alert">{t.loadError}</p>}

      <div className={styles.body}>
        <aside className={styles.students}>
          <div className={styles.pills} role="group" aria-label={t.filter}>
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={styles.pill}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {t.pill(t.filters[f] ?? f, all.filter(matches[f]).length)}
              </button>
            ))}
          </div>
          {rows && all.length === 0 && <p className={styles.muted}>{t.none}</p>}
          <ul className={styles.list} aria-label={t.students}>
            {shown.map((r) => (
              <li key={r.attemptId}>
                <button
                  type="button"
                  className={styles.student}
                  aria-pressed={selected === r.attemptId}
                  onClick={() => {
                    setReview(null);
                    setSelected(r.attemptId!);
                  }}
                >
                  <span className={styles.name}>{r.studentName}</span>
                  <span className={styles.meta}>
                    {r.academicId} ·{" "}
                    {formatScore(r.finalScore ?? r.preliminaryScore ?? 0)}
                  </span>
                  <span
                    className={`${styles.tag} ${r.reviewed ? styles.done : ""}`}
                  >
                    {r.reviewed ? t.reviewed : t.toReview}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className={styles.attempt} aria-live="polite">
          {!selected && <p className={styles.muted}>{t.pick}</p>}
          {selected && !review && !failed && (
            <p className={styles.muted}>{t.loading}</p>
          )}
          {review && (
            <ReviewAttempt
              key={review.attemptId}
              classId={classId}
              assessmentId={id}
              maxScore={assessment.maxScore}
              review={review}
              onChange={setReview}
              onFinished={finished}
            />
          )}
        </section>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AnswerOf, VerdictTag } from "@/components/ExamRoom/StudentAnswers";
import { formatScore } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { StudentResult } from "@/services/assessmentService";
import styles from "./AssessmentResult.module.scss";

const t = messages.assessments.result;

/**
 * The published grade in the detail of the assessment (SPEC-098 CA-05): the grade, the note to the student and the way to the correction. Before
 * the publication, and to who did not come, the server has no result and nothing shows.
 */
export function ResultSummary({ href, load }: { href: string; load: () => Promise<StudentResult> }) {
  const [result, setResult] = useState<StudentResult | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (got) => alive && setResult(got),
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [load]);
  if (!result) return null;
  return (
    <section className={styles.summary}>
      <p className={styles.grade}>{t.grade(formatScore(result.finalScore), formatScore(result.maxScore))}</p>
      {result.studentNote && (
        <div className={styles.note}>
          <p className={styles.noteTitle}>{t.note}</p>
          <p className={styles.noteText}>{result.studentNote}</p>
        </div>
      )}
      <Link href={href} className={styles.open}>
        {t.open}
      </Link>
    </section>
  );
}

/** The correction the student reads (SPEC-098 CA-06): each question with the answer, the right one of the objective kinds, the points and the reason. */
export function ResultView({ result }: { result: StudentResult }) {
  return (
    <div className={styles.view}>
      <p className={styles.grade}>{t.grade(formatScore(result.finalScore), formatScore(result.maxScore))}</p>
      {result.studentNote && (
        <div className={styles.note}>
          <p className={styles.noteTitle}>{t.note}</p>
          <p className={styles.noteText}>{result.studentNote}</p>
        </div>
      )}
      {result.items.map((item) => (
        <article key={item.position} className={styles.question} aria-label={t.item(item.position, item.title)}>
          <div className={styles.head}>
            <span className={styles.number} aria-hidden="true">
              {item.position}
            </span>
            <p className={styles.title}>{item.title}</p>
            <VerdictTag item={item} />
          </div>
          {/* html the server filtered when the question was saved */}
          <div className={styles.statement} dangerouslySetInnerHTML={{ __html: item.studentView.statement }} />
          {item.kind !== "PRACTICAL" && <AnswerOf item={item} />}
          <p className={styles.points}>{t.points(formatScore(item.points ?? 0), formatScore(item.weight))}</p>
          {item.adjustReason && <p className={styles.reason}>{t.reason(item.adjustReason)}</p>}
        </article>
      ))}
    </div>
  );
}

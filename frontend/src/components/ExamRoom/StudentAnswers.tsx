"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { fromApiAnswer } from "@/lib/attemptAnswers";
import { descriptionText } from "@/lib/description";
import { messages } from "@/messages/pt-BR";
import type {
  TeacherAttempt,
  TeacherAttemptItem,
} from "@/services/assessmentService";
import styles from "./StudentAnswers.module.scss";

const t = messages.assessments.room.answers;

/** How often the answers are read again while the tab is shown (SPEC-095 D-01). */
const REFRESH_MS = 10_000;

type Link = { left: string; right: string };

export interface StudentAnswersProps {
  load: () => Promise<TeacherAttempt>;
  /** The question the student is in, when the room knows it. */
  current?: number;
}

/**
 * What the open student answered in each question, for the teacher in the room (SPEC-095): the choice, the true or false, the links, the written
 * text or whether the practical one was solved, with the key of the objective ones beside it. It reads again every 10 seconds while it is shown.
 */
export function StudentAnswers({ load, current }: StudentAnswersProps) {
  const [attempt, setAttempt] = useState<TeacherAttempt | null>(null);
  // the room gives a new function on each render; the last one is kept, and the parent mounts a new list for each attempt
  const latest = useRef(load);
  useEffect(() => {
    latest.current = load;
  });
  const read = useCallback(() => {
    latest.current().then(setAttempt, () => {});
  }, []);

  useEffect(() => {
    read();
    const timer = setInterval(() => {
      if (!document.hidden) read();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [read]);

  return (
    <section className={styles.answers} aria-label={t.list}>
      <div className={styles.head}>
        <Button variant="secondary" size="sm" onClick={read}>
          {t.refresh}
        </Button>
      </div>
      {!attempt ? (
        <p className={styles.muted}>{t.loading}</p>
      ) : (
        <ol className={styles.list}>
          {attempt.items.map((item) => (
            <li
              key={item.position}
              aria-label={t.item(item.position, item.title)}
              className={item.position === current ? styles.current : undefined}
            >
              <p className={styles.title}>
                <span className={styles.number}>
                  {t.question(item.position)}
                </span>{" "}
                {item.title}
                {item.position === current && (
                  <span className={styles.here}>{t.here}</span>
                )}
              </p>
              <AnswerOf item={item} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function AnswerOf({ item }: { item: TeacherAttemptItem }) {
  const view = item.studentView;
  const key = (item.answerKey ?? {}) as { correct?: unknown; pairs?: Link[] };
  if (item.kind === "PRACTICAL") {
    return (
      <>
        <p className={item.checkedSolved ? styles.right : styles.text}>
          {item.checkedSolved ? t.solved : t.notSolved}
        </p>
        <p className={styles.muted}>{t.terminal}</p>
      </>
    );
  }
  const given = fromApiAnswer(item.kind, item.answer);
  if (given === undefined) return <p className={styles.muted}>{t.none}</p>;
  if (item.kind === "THEORETICAL_SINGLE") {
    const label = (id: unknown) =>
      descriptionText(
        view.choices?.find((c) => c.id === id)?.html ?? String(id),
      );
    return (
      <Verdict
        marked={label(given)}
        correct={
          typeof key.correct === "string" ? label(key.correct) : undefined
        }
      />
    );
  }
  if (item.kind === "THEORETICAL_BOOLEAN") {
    const label = (v: unknown) => (v ? t.yes : t.no);
    return (
      <Verdict
        marked={label(given)}
        correct={
          typeof key.correct === "boolean" ? label(key.correct) : undefined
        }
      />
    );
  }
  if (item.kind === "THEORETICAL_MATCHING") {
    const left = (id: string) =>
      view.columns?.left.find((c) => c.id === id)?.text ?? id;
    const right = (id: string) =>
      view.columns?.right.find((c) => c.id === id)?.text ?? id;
    return (
      <ul className={styles.links}>
        {(given as Link[]).map((l) => {
          const verdict = key.pairs
            ? key.pairs.some((p) => p.left === l.left && p.right === l.right)
              ? t.right
              : t.wrong
            : undefined;
          return (
            <li
              key={l.left}
              className={
                verdict === t.right
                  ? styles.right
                  : verdict === t.wrong
                    ? styles.wrong
                    : undefined
              }
            >
              {t.link(left(l.left), right(l.right), verdict)}
            </li>
          );
        })}
      </ul>
    );
  }
  // the written answer, html the server cleaned when it was saved (SPEC-090 RN-04)
  return (
    <div
      className={styles.written}
      dangerouslySetInnerHTML={{ __html: String(given) }}
    />
  );
}

function Verdict({ marked, correct }: { marked: string; correct?: string }) {
  const right = correct === undefined ? undefined : correct === marked;
  return (
    <p className={styles.text}>
      <span
        className={
          right === true
            ? styles.right
            : right === false
              ? styles.wrong
              : undefined
        }
      >
        {t.marked(marked)}
      </span>
      {correct !== undefined && (
        <span className={styles.key}> · {t.correct(correct)}</span>
      )}
    </p>
  );
}

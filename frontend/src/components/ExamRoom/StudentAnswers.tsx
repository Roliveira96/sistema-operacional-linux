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
type Key = { correct?: unknown; pairs?: Link[] };
type Tone = "right" | "wrong" | "partial" | "none" | "pending";

/** The verdict of a question, in words and with a tone; never only in color. */
interface Verdict {
  tone: Tone;
  label: string;
  answered: boolean;
}

const ICON: Record<Tone, string> = {
  right: "✓",
  wrong: "✗",
  partial: "◐",
  none: "–",
  pending: "✎",
};

function verdictOf(item: TeacherAttemptItem): Verdict {
  if (item.kind === "PRACTICAL")
    return item.checkedSolved
      ? { tone: "right", label: t.tags.solved, answered: true }
      : { tone: "none", label: t.tags.unsolved, answered: false };
  const given = fromApiAnswer(item.kind, item.answer);
  if (given === undefined)
    return { tone: "none", label: t.tags.none, answered: false };
  const key = (item.answerKey ?? {}) as Key;
  if (item.kind === "THEORETICAL_MATCHING" && key.pairs) {
    const right = (given as Link[]).filter((l) =>
      key.pairs!.some((p) => p.left === l.left && p.right === l.right),
    ).length;
    if (right === key.pairs.length)
      return { tone: "right", label: t.tags.right, answered: true };
    if (right === 0)
      return { tone: "wrong", label: t.tags.wrong, answered: true };
    return {
      tone: "partial",
      label: t.tags.partial(right, key.pairs.length),
      answered: true,
    };
  }
  if (key.correct !== undefined)
    return given === key.correct
      ? { tone: "right", label: t.tags.right, answered: true }
      : { tone: "wrong", label: t.tags.wrong, answered: true };
  return { tone: "pending", label: t.tags.pending, answered: true };
}

export interface StudentAnswersProps {
  load: () => Promise<TeacherAttempt>;
  /** The question the student is in, when the room knows it. */
  current?: number;
}

/**
 * What the open student answered in each question, for the teacher in the room (SPEC-095): a summary on top, and for each question a tag with the
 * verdict and the choice, the true or false, the links, the written text or whether the practical one was solved, with the key of the objective
 * ones beside it. It reads again every 10 seconds while it is shown.
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

  const verdicts = attempt?.items.map(verdictOf) ?? [];
  const practical =
    attempt?.items.filter((it) => it.kind === "PRACTICAL") ?? [];

  return (
    <section className={styles.answers} aria-label={t.list}>
      <div className={styles.head}>
        {attempt && (
          <div className={styles.summary} role="group" aria-label={t.summary}>
            <span className={styles.stat}>
              {t.answeredCount(
                verdicts.filter((v) => v.answered).length,
                verdicts.length,
              )}
            </span>
            <span className={`${styles.stat} ${styles.statRight}`}>
              {t.rightCount(
                verdicts.filter(
                  (v) => v.tone === "right" && v.label === t.tags.right,
                ).length,
              )}
            </span>
            <span className={`${styles.stat} ${styles.statWrong}`}>
              {t.wrongCount(
                verdicts.filter(
                  (v) => v.tone === "wrong" || v.tone === "partial",
                ).length,
              )}
            </span>
            {practical.length > 0 && (
              <span className={styles.stat}>
                {t.solvedCount(
                  practical.filter((it) => it.checkedSolved).length,
                  practical.length,
                )}
              </span>
            )}
          </div>
        )}
        <Button variant="secondary" size="sm" onClick={read}>
          {t.refresh}
        </Button>
      </div>
      {!attempt ? (
        <p className={styles.muted}>{t.loading}</p>
      ) : (
        <ol className={styles.list}>
          {attempt.items.map((item, i) => {
            const v = verdicts[i]!;
            return (
              <li
                key={item.position}
                aria-label={t.item(item.position, item.title)}
                className={
                  item.position === current ? styles.current : undefined
                }
              >
                <div className={styles.itemHead}>
                  <span className={styles.number} aria-hidden="true">
                    {item.position}
                  </span>
                  <p className={styles.title}>
                    <span className={styles.srOnly}>
                      {t.question(item.position)}{" "}
                    </span>
                    {item.title}
                    {item.position === current && (
                      <span className={styles.here}>{t.here}</span>
                    )}
                  </p>
                  <span className={`${styles.tag} ${styles[v.tone]}`}>
                    <span aria-hidden="true">{ICON[v.tone]}</span>
                    <span data-tag>{v.label}</span>
                  </span>
                </div>
                <div className={styles.body}>
                  <AnswerOf item={item} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function AnswerOf({ item }: { item: TeacherAttemptItem }) {
  const view = item.studentView;
  const key = (item.answerKey ?? {}) as Key;
  if (item.kind === "PRACTICAL") {
    return (
      <p className={styles.muted}>
        {item.checkedSolved ? t.solved : t.notSolved} · {t.terminal}
      </p>
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
      <Marked
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
      <Marked
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
          const ok = key.pairs?.some(
            (p) => p.left === l.left && p.right === l.right,
          );
          const verdict = ok === undefined ? undefined : ok ? t.right : t.wrong;
          return (
            <li key={l.left}>
              {ok !== undefined && (
                <span
                  aria-hidden="true"
                  className={ok ? styles.iconRight : styles.iconWrong}
                >
                  {ok ? ICON.right : ICON.wrong}
                </span>
              )}
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

function Marked({ marked, correct }: { marked: string; correct?: string }) {
  return (
    <p className={styles.text}>
      <span className={styles.marked}>{t.marked(marked)}</span>
      {correct !== undefined && correct !== marked && (
        <span className={styles.key}> · {t.correct(correct)}</span>
      )}
      {correct !== undefined && correct === marked && (
        <span className={styles.srOnly}> · {t.correct(correct)}</span>
      )}
    </p>
  );
}

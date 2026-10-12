"use client";

import { useId, useState } from "react";
import { Html } from "@/components/ContentRenderer/blocks";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { answerText } from "@/lib/questionKinds";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./DescriptiveAnswer.module.scss";

const m = contentMessages.descriptive;

/** A descriptive answer already sent: what the student wrote, where the correction stands and what the student may now see (SPEC-039). */
export interface DescriptiveResult {
  html: string;
  status: "PENDING" | "GRADED";
  /** The percentage of what is right, once the teacher confirmed it (D-04). */
  score: number | null;
  /** The note of the teacher to the student (D-06). */
  studentNote: string | null;
  /** The correct answer the teacher wrote, shown after sending in an exercise (D-03). */
  expectedAnswer: string | null;
}

export interface DescriptiveAnswerProps {
  /** What the answer is called for assistive technology. */
  label?: string;
  /** The size of the answer, in characters of text (D-05). */
  maxLength: number;
  /** The answer once sent; while it is missing the student writes. */
  result: DescriptiveResult | null;
  onAnswer: (html: string) => void;
  /** True while the answer is being sent. */
  busy?: boolean;
  /** Why the student cannot answer now (no session, a failure). */
  message?: React.ReactNode;
  disabled?: boolean;
}

/**
 * The answer of a descriptive question in an exercise (SPEC-039): text and commands, sent once. Then it is locked, waits for the grade
 * of the teacher and shows the correct answer; the grade comes as a percentage, with the note of the teacher.
 */
export function DescriptiveAnswer({ label = m.group, maxLength, result, onAnswer, busy = false, message, disabled = false }: DescriptiveAnswerProps) {
  const id = useId();
  const [html, setHtml] = useState("");
  const length = answerText(html).length;
  const empty = answerText(html).trim() === "";
  const tooLong = length > maxLength;

  if (result) {
    return (
      <div className={styles.answer} role="status" aria-labelledby={`${id}-title`}>
        <div className={styles.sent}>
          <p id={`${id}-title`} className={styles.title}>
            {m.yourAnswer}
          </p>
          <Html html={result.html} />
        </div>
        {result.status === "GRADED" && result.score !== null ? (
          <div className={styles.grade}>
            <p className={styles.score}>{m.score(result.score)}</p>
            <div
              className={styles.bar}
              role="meter"
              aria-label={m.scoreLabel}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={result.score}
            >
              <span className={styles.fill} style={{ "--score": `${result.score}%` } as React.CSSProperties} />
            </div>
            {result.studentNote && (
              <div className={styles.block}>
                <p className={styles.title}>{m.note}</p>
                <p className={styles.noteText}>{result.studentNote}</p>
              </div>
            )}
          </div>
        ) : (
          <p className={styles.pending}>
            <span className={styles.clock} aria-hidden="true">
              ⏳
            </span>{" "}
            {m.pending}
          </p>
        )}
        {result.expectedAnswer && (
          <div className={styles.block}>
            <p className={styles.title}>{m.expected}</p>
            <Html html={result.expectedAnswer} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.answer}>
      <p className={styles.note}>{m.once}</p>
      <RichTextEditor label={label} variant="answer" value="" onChange={setHtml} invalid={tooLong} describedBy={`${id}-count`} />
      <p id={`${id}-count`} className={`${styles.count} ${tooLong ? styles.over : ""}`} aria-live="polite">
        {m.count(length, maxLength)}
      </p>
      {tooLong && (
        <p className={styles.error} role="alert">
          {m.tooLong(maxLength)}
        </p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.send} disabled={empty || tooLong || busy || disabled} onClick={() => onAnswer(html)}>
          {m.send}
        </button>
      </div>
      {busy && (
        <p className={styles.note} role="status">
          {m.sending}
        </p>
      )}
      {message && (
        <p className={styles.note} role="alert">
          {message}
        </p>
      )}
    </div>
  );
}

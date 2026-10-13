"use client";

import { useId } from "react";
import { Html } from "@/components/ContentRenderer/blocks";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./TrueFalseAnswer.module.scss";

const m = contentMessages.trueFalse;

/** What the student learns after answering in an exercise (SPEC-035 RN-06, D-06). */
export interface TrueFalseResult {
  choice: boolean;
  passed: boolean;
  correctAnswer: boolean;
  explanation?: string | null;
}

interface ExerciseMode {
  /** Exercise: the answer is sent on the click, the result shows at once and the answer is locked (D-02). */
  mode: "exercise";
  /** The result once answered; while it is missing the buttons can be clicked. */
  result: TrueFalseResult | null;
  onAnswer: (value: boolean) => void;
  /** True while the answer is being sent. */
  busy?: boolean;
  /** Why the student cannot answer now (no session, a failure); the buttons stay disabled while `disabled`. */
  message?: React.ReactNode;
  disabled?: boolean;
}

interface AssessmentMode {
  /** Assessment: the choice can change at any time while the assessment is open, and nothing says whether it is right (RN-07). */
  mode: "assessment";
  value: boolean | null;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export type TrueFalseAnswerProps = (ExerciseMode | AssessmentMode) & {
  /** What the group of buttons is called for assistive technology. */
  label?: string;
};

/**
 * The two buttons of a true or false question (SPEC-035). In an exercise the first click is the answer: it is graded and locked.
 * In an assessment it is only a choice, which the student may change until finishing, with no result.
 */
export function TrueFalseAnswer(props: TrueFalseAnswerProps) {
  const id = useId();
  const label = props.label ?? m.group;
  const options: { value: boolean; text: string }[] = [
    { value: true, text: m.true },
    { value: false, text: m.false },
  ];

  if (props.mode === "assessment") {
    return (
      <div className={styles.answer}>
        <div role="radiogroup" aria-label={label} className={styles.options}>
          {options.map((o) => (
            <button
              key={String(o.value)}
              type="button"
              role="radio"
              aria-checked={props.value === o.value}
              className={`${styles.option} ${props.value === o.value ? styles.chosen : ""}`}
              disabled={props.disabled}
              onClick={() => props.onChange(o.value)}
            >
              {o.text}
            </button>
          ))}
        </div>
        {props.value !== null && (
          <p className={styles.note} role="status">
            {m.chosen}
          </p>
        )}
      </div>
    );
  }

  const { result, busy = false } = props;
  const locked = result !== null;
  const optionClass = (value: boolean) => {
    if (!result) return styles.option;
    const classes = [styles.option];
    if (value === result.choice) classes.push(styles.chosen, result.passed ? styles.right : styles.wrong);
    else if (value === result.correctAnswer) classes.push(styles.correct);
    return classes.join(" ");
  };
  return (
    <div className={styles.answer}>
      <div role="group" aria-label={label} aria-describedby={locked ? `${id}-result` : undefined} className={styles.options}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={result ? result.choice === o.value : false}
            className={optionClass(o.value)}
            disabled={locked || busy || props.disabled}
            onClick={() => props.onAnswer(o.value)}
          >
            {o.text}
          </button>
        ))}
      </div>
      {busy && (
        <p className={styles.note} role="status">
          {m.sending}
        </p>
      )}
      {!locked && props.message && (
        <p className={styles.note} role="alert">
          {props.message}
        </p>
      )}
      {result && (
        <div id={`${id}-result`} className={`${styles.result} ${result.passed ? styles.resultRight : styles.resultWrong}`} role="status">
          <p className={styles.verdict}>{result.passed ? m.right : m.wrong}</p>
          <p className={styles.line}>
            {m.yourAnswer(result.choice)} {m.correctIs(result.correctAnswer)}
          </p>
          {result.explanation && (
            <div className={styles.explanation}>
              <p className={styles.explanationTitle}>{m.explanation}</p>
              <Html html={result.explanation} />
            </div>
          )}
          <p className={styles.note}>{m.locked}</p>
        </div>
      )}
    </div>
  );
}

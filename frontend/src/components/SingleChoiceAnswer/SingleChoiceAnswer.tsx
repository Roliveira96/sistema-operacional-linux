"use client";

import { useId } from "react";
import { Html } from "@/components/ContentRenderer/blocks";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "@/components/TrueFalseAnswer/TrueFalseAnswer.module.scss";
import own from "./SingleChoiceAnswer.module.scss";

const m = contentMessages.singleChoice;
const tf = contentMessages.trueFalse;

/** One alternative as the student sees it: its id and its html, never whether it is the correct one. */
export interface ChoiceOption {
  id: string;
  html: string;
}

/** What the student learns after answering a single choice exercise (SPEC-036 RN-05). */
export interface ChoiceResult {
  choice: string;
  passed: boolean;
  correctChoice: string;
  explanation?: string | null;
}

interface ExerciseMode {
  /** Exercise: the click is the answer; the result shows at once and the answer is locked (SPEC-035 D-02). */
  mode: "exercise";
  result: ChoiceResult | null;
  onAnswer: (choice: string) => void;
  busy?: boolean;
  message?: React.ReactNode;
  disabled?: boolean;
}

interface AssessmentMode {
  /** Assessment: the choice changes at any time while it is open, and nothing says whether it is right (SPEC-035 RN-07). */
  mode: "assessment";
  value: string | null;
  onChange: (choice: string) => void;
  disabled?: boolean;
}

export type SingleChoiceAnswerProps = (ExerciseMode | AssessmentMode) & {
  /** The alternatives in the order to show them (already shuffled when the question asks). */
  choices: ChoiceOption[];
  label?: string;
};

/**
 * The alternatives of a single choice question (SPEC-036), as buttons with a letter. In an exercise the first click is the answer, graded
 * and locked, with the animation of SPEC-035 D-15; in an assessment it is only a choice that can change until finishing.
 */
export function SingleChoiceAnswer(props: SingleChoiceAnswerProps) {
  const id = useId();
  const label = props.label ?? m.group;
  const body = (choice: ChoiceOption, i: number) => (
    <>
      <span className={own.letter} aria-hidden="true">
        {m.letter(i)}
      </span>
      <Html html={choice.html} className={own.content} />
    </>
  );

  if (props.mode === "assessment") {
    return (
      <div className={styles.answer}>
        <div role="radiogroup" aria-label={label} className={own.list}>
          {props.choices.map((choice, i) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={props.value === choice.id}
              className={`${styles.option} ${own.choice} ${props.value === choice.id ? styles.chosen : ""}`}
              disabled={props.disabled}
              onClick={() => props.onChange(choice.id)}
            >
              {body(choice, i)}
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
  const classOf = (choice: ChoiceOption) => {
    const classes = [styles.option, own.choice];
    if (!result) return classes.join(" ");
    if (choice.id === result.choice) classes.push(styles.chosen, result.passed ? styles.right : styles.wrong);
    else if (choice.id === result.correctChoice) classes.push(styles.correct);
    return classes.join(" ");
  };
  const markOf = (choice: ChoiceOption) => {
    if (!result) return null;
    if (choice.id === result.correctChoice) return m.correct;
    if (choice.id === result.choice) return m.yourChoice;
    return null;
  };
  return (
    <div className={styles.answer}>
      <div role="group" aria-label={label} aria-describedby={result ? `${id}-result` : undefined} className={own.list}>
        {props.choices.map((choice, i) => (
          <button
            key={choice.id}
            type="button"
            aria-pressed={result ? result.choice === choice.id : false}
            className={classOf(choice)}
            disabled={result !== null || busy || props.disabled}
            onClick={() => props.onAnswer(choice.id)}
          >
            {body(choice, i)}
            {markOf(choice) && <span className={own.mark}>{markOf(choice)}</span>}
          </button>
        ))}
      </div>
      {busy && (
        <p className={styles.note} role="status">
          {tf.sending}
        </p>
      )}
      {!result && props.message && (
        <p className={styles.note} role="alert">
          {props.message}
        </p>
      )}
      {result && (
        <div id={`${id}-result`} className={`${styles.result} ${result.passed ? styles.resultRight : styles.resultWrong}`} role="status">
          <p className={styles.verdict}>{result.passed ? tf.right : tf.wrong}</p>
          {!result.passed && <p className={styles.line}>{m.correctIs}</p>}
          {result.explanation && (
            <div className={styles.explanation}>
              <p className={styles.explanationTitle}>{tf.explanation}</p>
              <Html html={result.explanation} />
            </div>
          )}
          <p className={styles.note}>{m.locked}</p>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button, buttonStyle } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./ExerciseBoard.module.scss";
import { clampExtraMinutes, DEFAULT_EXTRA_MINUTES, mmss } from "./exercises";

const m = messages.classroom.exerciseBoard;

interface ExtendControlProps {
  canControl: boolean;
  onExtend(minutes: number): void;
}

/** More minutes for the round, 2 by default, brought to 1 to 30 when the teacher leaves the field (SPEC-071 RN-02). */
export function ExtendControl({ canControl, onExtend }: ExtendControlProps) {
  const [typed, setTyped] = useState(String(DEFAULT_EXTRA_MINUTES));
  return (
    <span className={styles.extend}>
      <input
        className={styles.extraField}
        type="number"
        inputMode="numeric"
        min={1}
        max={30}
        step={1}
        value={typed}
        aria-label={m.extraMinutes}
        disabled={!canControl}
        onChange={(event) => setTyped(event.target.value)}
        onBlur={() => setTyped(String(clampExtraMinutes(typed)))}
      />
      <Button variant="secondary" size="sm" disabled={!canControl} onClick={() => onExtend(clampExtraMinutes(typed))}>
        {m.extend}
      </Button>
    </span>
  );
}

interface BackToLessonProps {
  canControl: boolean;
  /** The seconds the clock still has, when it did not end; null when the round ended. */
  secondsLeft: number | null;
  /** How many students of the round did not finish. */
  notFinished: number;
  onClose(): void;
}

/**
 * The button that takes the class back to the lesson (SPEC-071 RN-04): with the clock still going, or with students who did not finish, it asks first, saying
 * which; with the round over and everybody done, it goes at once. The dialog keeps the focus inside it, Esc cancels it, and the focus goes back to the button.
 */
export function BackToLesson({ canControl, secondsLeft, notFinished, onClose }: BackToLessonProps) {
  const [asking, setAsking] = useState(false);
  const title = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (asking) cancel.current?.focus();
  }, [asking]);

  const close = () => {
    setAsking(false);
    opener.current?.focus();
  };
  const ask = () => {
    if (secondsLeft === null && notFinished === 0) onClose();
    else setAsking(true);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };

  return (
    <>
      <button ref={opener} type="button" {...buttonStyle({ variant: "primary", size: "sm" })} disabled={!canControl} onClick={ask}>
        {m.backToLesson}
      </button>
      {asking && (
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={title} onKeyDown={onKeyDown}>
          <h3 id={title} className={styles.subtitle}>
            {m.backToLesson}
          </h3>
          {secondsLeft !== null && <p className={styles.warn}>{m.clockNotOver(mmss(secondsLeft))}</p>}
          {notFinished > 0 && <p className={styles.warn}>{m.notFinishedWarn(notFinished)}</p>}
          <p className={styles.muted}>{m.backQuestion}</p>
          <div className={styles.actions}>
            <button ref={cancel} type="button" {...buttonStyle({ variant: "secondary", size: "sm" })} onClick={close}>
              {m.cancel}
            </button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setAsking(false);
                onClose();
              }}
            >
              {m.backToLesson}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

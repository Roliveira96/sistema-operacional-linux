"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./AssessmentSimulator.module.scss";

const t = messages.assessments.split;

/** Where the width the student chose is kept, for every practical question and the next exams (SPEC-090 revision 4). */
const KEY = "exam-terminal-width";
/** The terminal goes from 22rem to 75% of the area, the question keeps 18rem, and the arrows move 32 px. */
const TERMINAL_MIN = 352;
const TERMINAL_MAX_SHARE = 0.75;
const QUESTION_MIN = 288;
const STEP = 32;

function stored(): number | null {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n >= TERMINAL_MIN ? n : null;
  } catch {
    return null;
  }
}

export interface ExamSplitProps {
  /** Whether the exam has a question of command Linux: without one there is no terminal, no divider and no button. */
  hasTerminal: boolean;
  question: ReactNode;
  /** The terminal, given the button that expands it, for its bar. */
  terminal: (toggle: ReactNode) => ReactNode;
}

/**
 * The question beside the terminal, in the window of the exam and in the simulator (SPEC-090 revision 4): a divider the student drags, or moves
 * with the arrows, kept in the browser; and Expandir terminal, which hides the question until Recolher or Esc. On narrow screens they stay one
 * under the other, with no divider.
 */
export function ExamSplit({ hasTerminal, question, terminal }: ExamSplitProps) {
  const body = useRef<HTMLDivElement>(null);
  const side = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(stored);
  const [expanded, setExpanded] = useState(false);

  const resize = (next: number) => {
    const area = body.current?.getBoundingClientRect().width ?? 0;
    const max =
      area > 0
        ? Math.max(
            TERMINAL_MIN,
            Math.min(area * TERMINAL_MAX_SHARE, area - QUESTION_MIN),
          )
        : Infinity;
    const w = Math.round(Math.min(Math.max(next, TERMINAL_MIN), max));
    setWidth(w);
    try {
      localStorage.setItem(KEY, String(w));
    } catch {
      // without the storage the width lasts while the window is open
    }
  };
  const current = () =>
    width ??
    Math.round((body.current?.getBoundingClientRect().width ?? 0) * 0.6);

  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const right = body.current?.getBoundingClientRect().right ?? 0;
    const move = (m: PointerEvent) => resize(right - m.clientX);
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  // Esc brings the question back, unless it was pressed in the terminal, where a program may need it
  useEffect(() => {
    if (!expanded) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !side.current?.contains(e.target as Node))
        setExpanded(false);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [expanded]);

  const classes = [
    styles.examBody,
    hasTerminal ? styles.withTerminal : "",
    hasTerminal && width && !expanded ? styles.sized : "",
    expanded ? styles.expanded : "",
  ];
  return (
    <div
      ref={body}
      className={classes.join(" ")}
      style={
        width
          ? ({ "--terminal-width": `${width}px` } as React.CSSProperties)
          : undefined
      }
    >
      <div className={styles.questionSlot} hidden={expanded}>
        {question}
      </div>
      {hasTerminal && !expanded && (
        // the arrows widen (left) and narrow (right) the terminal, which is on the right of the divider
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t.width}
          aria-valuenow={width ?? undefined}
          aria-valuemin={TERMINAL_MIN}
          className={styles.divider}
          onPointerDown={drag}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") resize(current() + STEP);
            else if (e.key === "ArrowRight") resize(current() - STEP);
          }}
        />
      )}
      {hasTerminal && (
        <div ref={side} className={styles.terminalSlot}>
          {terminal(
            <Button
              variant="secondary"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? t.collapse : t.expand}
            </Button>,
          )}
        </div>
      )}
    </div>
  );
}

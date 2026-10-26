"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./SolvedCelebration.module.scss";

const c = messages.assessments.simulator.celebration;

export interface SolvedCelebrationProps {
  /** The solved question is the last of the exam: the way on is to deliver. */
  last: boolean;
  onNext: () => void;
  onDeliver: () => void;
  onClose: () => void;
}

/** Whether the system asks for less motion: the mark then appears at once (SPEC-087 CA-11). */
const reducedMotion = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The celebration of a question of command Linux the server gave as solved (SPEC-087 D-03): a dialog over the column of the question, with the
 * mark of success drawn by the style (no mascot, D-04) and the way on: the next question, or the delivery on the last one. It locks nothing and
 * moves on only when asked; Escape, a click outside and "stay" just close it, and the focus goes back where it was.
 */
export function SolvedCelebration({ last, onNext, onDeliver, onClose }: SolvedCelebrationProps) {
  const box = useRef<HTMLDivElement>(null);
  const [motion] = useState(() => (reducedMotion() ? "reduced" : "full"));

  // the focus comes in with the dialog, to the first button, and goes back where it was when the dialog leaves
  useEffect(() => {
    const before = document.activeElement;
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLButtonElement>("button"));
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    items[(at + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
  };

  return (
    <div className={styles.backdrop} data-testid="celebration-backdrop" onClick={onClose}>
      <div ref={box} role="dialog" aria-label={c.title} data-motion={motion} className={styles.dialog} onKeyDown={onKeyDown} onClick={(e) => e.stopPropagation()}>
        <svg className={styles.mark} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
          <circle className={styles.ring} cx="32" cy="32" r="28" />
          <path className={styles.tick} d="M19 33 L28 42 L45 24" />
        </svg>
        <h3 className={styles.title}>{c.title}</h3>
        <p className={styles.text}>{last ? c.last : c.next}</p>
        <div className={styles.actions}>
          <Button onClick={last ? onDeliver : onNext}>{last ? c.deliver : c.nextButton}</Button>
          <Button variant="secondary" onClick={onClose}>
            {c.stay}
          </Button>
        </div>
      </div>
    </div>
  );
}

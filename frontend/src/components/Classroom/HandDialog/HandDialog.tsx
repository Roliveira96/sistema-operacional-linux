"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { HandQuestion } from "../HandQuestion/HandQuestion";
import styles from "./HandDialog.module.scss";

const m = messages.classroom.hands;

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";

export interface HandDialogProps {
  /** The doubt the room has for this hand, empty with none. */
  saved: string;
  /** Sends the doubt, trimmed; empty takes it away from the hand. */
  onSend(question: string): void;
  /** Puts the hand down, and the room closes the dialog. */
  onLower(): void;
  /** Closes the dialog and leaves the hand up. */
  onClose(): void;
}

/**
 * The modal where the student writes the doubt of the raised hand (SPEC-062): the field of SPEC-058, with the buttons to lower the hand and to close.
 * It is not a portal: the browser draws only what is inside the element in full screen, so the dialog has to live in the room, next to the stage, and the
 * room puts it there. The focus goes to the field, stays inside with Tab and goes back to what opened the dialog when it goes away; Esc closes it.
 */
export function HandDialog({ saved, onSend, onLower, onClose }: HandDialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const title = useId();
  // What had the focus when the dialog opened, read before the field takes it.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));

  useEffect(
    () => () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    },
    [opener],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className={styles.backdrop}>
      <div ref={box} role="dialog" aria-modal="true" aria-labelledby={title} className={styles.dialog} onKeyDown={onKeyDown}>
        <h2 id={title} className={styles.title}>
          {m.dialogTitle}
        </h2>
        <HandQuestion saved={saved} onSend={onSend} autoFocus />
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={onLower}>
            {m.lower}
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            {m.dialogClose}
          </Button>
        </div>
      </div>
    </div>
  );
}

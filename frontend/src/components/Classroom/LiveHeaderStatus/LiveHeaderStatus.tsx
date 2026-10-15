"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { clock } from "../elapsed";
import styles from "./LiveHeaderStatus.module.scss";

const m = messages.classroom;

export interface LiveHeaderStatusProps {
  /** When the class began, as the room tells it at every snapshot. */
  startedAt: string;
  /** How many hands are up. */
  hands: number;
  /** The click of the hand: the student's room gives it, and the hand becomes the button that raises it (SPEC-062). Without it the hand is only an indicator. */
  onHand?(): void;
  /** The hand of the student himself is up: the button says so, and its icon is filled (SPEC-062). */
  handRaised?: boolean;
}

/** A raised hand, drawn with the color of the text around it. */
function HandIcon() {
  return (
    <svg className={styles.icon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" />
      <path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" />
      <path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" />
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
    </svg>
  );
}

/**
 * What the live class tells in the header of the module, on the right of the title: the time of the class (hh:mm:ss since it began) and the raised
 * hands (a hand and the number, 0 with none). It is the same for the teacher and for the students (SPEC-058 CA-01). The clock counts from the start
 * the room tells, so a new snapshot with another start corrects it at once, and each tick reads the clock of the browser again, so it never drifts.
 */
export function LiveHeaderStatus({ startedAt, hands, onHand, handRaised = false }: LiveHeaderStatusProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className={styles.status}>
      <span className={styles.clock} role="timer" aria-label={m.room.timer}>
        {clock(now - new Date(startedAt).getTime())}
      </span>
      {onHand ? (
        <button
          type="button"
          className={styles.hands}
          aria-label={handRaised ? m.hands.editQuestion : m.hands.raise}
          title={m.hands.count(hands)}
          data-raised={hands > 0 ? "true" : undefined}
          data-mine={handRaised ? "true" : undefined}
          onClick={onHand}
        >
          <HandIcon />
          {hands}
        </button>
      ) : (
        <span className={styles.hands} role="img" aria-label={m.hands.count(hands)} data-raised={hands > 0 ? "true" : undefined}>
          <HandIcon />
          {hands}
        </span>
      )}
    </div>
  );
}

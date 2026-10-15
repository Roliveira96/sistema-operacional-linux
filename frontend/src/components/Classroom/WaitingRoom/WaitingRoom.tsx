"use client";

import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./WaitingRoom.module.scss";

const m = messages.classroom.waiting;

export interface WaitingRoomProps {
  state: "WAITING" | "REMOVED";
  waitedMinutes?: number;
  /** A removed student asks to come in again. */
  onAskAgain(): void;
}

/** What a student sees until the teacher accepts him, or after the teacher removed him (SPEC-054 CA-01, CA-03). */
export function WaitingRoom({ state, waitedMinutes = 0, onAskAgain }: WaitingRoomProps) {
  if (state === "REMOVED") {
    return (
      <section className={styles.room}>
        <p className={styles.title}>{m.removed}</p>
        <Button variant="primary" onClick={onAskAgain}>
          {m.askAgain}
        </Button>
      </section>
    );
  }
  return (
    <section className={styles.room} role="status">
      <h2 className={styles.title}>{m.title}</h2>
      <p className={styles.note}>{m.waited(waitedMinutes)}</p>
    </section>
  );
}

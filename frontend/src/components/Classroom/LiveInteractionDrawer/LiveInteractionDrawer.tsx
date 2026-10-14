"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { HandRaiseItem } from "@/services/classroomService";
import { useMinuteClock } from "../useMinuteClock";
import styles from "./LiveInteractionDrawer.module.scss";

const m = messages.classroom.hands;

export interface LiveInteractionDrawerProps {
  role: "teacher" | "student";
  userId: string;
  /** The line of raised hands, in the order they came. */
  hands: HandRaiseItem[];
  onRaise(): void;
  onLower(): void;
  /** The teacher lowers one hand, or all of them when no student is given. */
  onModerate(studentId?: string): void;
  /** What goes under the hands: the notes of the student. */
  children?: ReactNode;
}

/**
 * The side of the live classroom: the raised hands for the teacher, each with the name, how long ago and the doubt that came with it (SPEC-058), and
 * the button to raise the hand for the student (SPEC-051 CA-08, CA-09).
 */
export function LiveInteractionDrawer({ role, userId, hands, onRaise, onLower, onModerate, children }: LiveInteractionDrawerProps) {
  const place = hands.findIndex((hand) => hand.studentId === userId);
  const now = useMinuteClock();
  return (
    <aside className={styles.drawer}>
      {role === "teacher" ? (
        <section className={styles.section} aria-labelledby="hands-title">
          <h2 id="hands-title" className={styles.title}>
            {m.title}
          </h2>
          {hands.length === 0 ? (
            <p className={styles.muted}>{m.empty}</p>
          ) : (
            <>
              <ol className={styles.list}>
                {hands.map((hand) => (
                  <li key={hand.studentId} className={styles.item}>
                    <span className={styles.who}>
                      <span className={styles.name}>{hand.name}</span>
                      <span className={styles.muted}>{m.since(Math.max(0, Math.floor((now - new Date(hand.requestedAt).getTime()) / 60_000)))}</span>
                      {/* The doubt of the student is text: React writes it as such, so no HTML in it ever runs (SPEC-058 CA-06). */}
                      {hand.question && (
                        <span className={styles.question} data-testid="hand-question">
                          {hand.question}
                        </span>
                      )}
                    </span>
                    <Button variant="secondary" size="sm" aria-label={m.lowerOne(hand.name)} onClick={() => onModerate(hand.studentId)}>
                      {m.lower}
                    </Button>
                  </li>
                ))}
              </ol>
              <Button variant="ghost" size="sm" onClick={() => onModerate(undefined)}>
                {m.lowerAll}
              </Button>
            </>
          )}
        </section>
      ) : (
        <section className={styles.section}>
          {place >= 0 ? (
            <>
              <p className={styles.up}>{m.handUp}</p>
              <p className={styles.muted}>{m.position(place + 1)}</p>
              <Button variant="secondary" onClick={onLower}>
                {m.lower}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={onRaise}>
              {m.raise}
            </Button>
          )}
        </section>
      )}
      {children}
    </aside>
  );
}

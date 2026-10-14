"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { clock } from "../elapsed";
import styles from "./WaitingScreen.module.scss";

const w = messages.classroom.waitingScreen;

export interface WaitingScreenProps {
  /** The title of the live class; with none, the screen says "Aula ao vivo". */
  title: string;
  /** When the class began, as the room tells it at every snapshot. */
  startedAt: string;
}

/**
 * What the stage shows while the teacher keeps the class on hold (the key B or the button; the state of the room is still `blank`, SPEC-055 CA-17):
 * a dark gradient with a few soft blobs of the colors of the theme drifting slowly, the title of the class, the time of the class running second by
 * second, and a short line that the class will go on (SPEC-061). It covers the whole stage, and it is the same for the teacher and for every student,
 * which see it in the same box. The clock is the one of the header of the module (SPEC-058): it counts from the start the room tells, and each tick reads
 * the clock of the browser again, so it never drifts. The time is hidden from the screen readers, so they do not tell it at every second.
 */
export function WaitingScreen({ title, startedAt }: WaitingScreenProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  return (
    <div className={styles.screen} role="status" aria-label={w.label}>
      <div className={styles.blobs} aria-hidden="true">
        <span className={`${styles.blob} ${styles.orange}`} />
        <span className={`${styles.blob} ${styles.blue}`} />
        <span className={`${styles.blob} ${styles.green}`} />
        <span className={`${styles.blob} ${styles.amber}`} />
      </div>
      <div className={styles.content}>
        <h2 className={styles.title}>{title.trim() || w.untitled}</h2>
        <p className={styles.clock} aria-hidden="true">
          {clock(now - new Date(startedAt).getTime())}
        </p>
        <p className={styles.note}>{w.resume}</p>
      </div>
    </div>
  );
}

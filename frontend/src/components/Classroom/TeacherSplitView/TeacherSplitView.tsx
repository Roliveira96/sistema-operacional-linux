"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import styles from "./TeacherSplitView.module.scss";

const m = messages.classroom.split;

export interface TeacherSplitViewProps {
  /** The private screen of the teacher, where he interacts without the class seeing. */
  mine: ReactNode;
  /** What the class is seeing, read only. */
  classScreen: ReactNode;
  /** Students accepted in the class. */
  accepted: number;
}

/** The two screens of the teacher side by side: My screen and the Class screen (SPEC-054 CA-07, CA-13). */
export function TeacherSplitView({ mine, classScreen, accepted }: TeacherSplitViewProps) {
  const [open, setOpen] = useState(true);
  return (
    <div className={`${styles.split} ${open ? "" : styles.alone}`}>
      <section className={styles.mine} aria-label={m.mine}>
        <h2 className={styles.heading}>{m.mine}</h2>
        {mine}
      </section>
      <section className={styles.klass} aria-label={m.classScreen}>
        <header className={styles.klassBar}>
          <h2 className={styles.heading}>{m.classScreen}</h2>
          {open && <span className={styles.seen}>{m.seenByClass}</span>}
          {open && <span className={styles.count}>{m.acceptedCount(accepted)}</span>}
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? m.collapse : m.expand}
          </Button>
        </header>
        {open && classScreen}
      </section>
    </div>
  );
}

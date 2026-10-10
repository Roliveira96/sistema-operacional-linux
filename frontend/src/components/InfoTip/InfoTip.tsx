"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./InfoTip.module.scss";

interface InfoTipProps {
  /** What is being explained, e.g. "Snapshot do módulo": names the button for screen readers. */
  topic: string;
  /** The explanation, written for a teacher who never had training: what it does and what it is for. */
  children: React.ReactNode;
}

/** The "i" of the teaching module: a button that opens a short, plain explanation next to a title or field. */
export function InfoTip({ topic, children }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("keydown", close);
      document.removeEventListener("pointerdown", close);
    };
  }, [open]);

  return (
    <span ref={box} className={styles.wrap}>
      <button type="button" className={styles.button} aria-label={`Para que serve: ${topic}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        i
      </button>
      {open && (
        <span id={id} role="note" className={styles.popover}>
          <strong className={styles.topic}>{topic}</strong>
          {children}
        </span>
      )}
    </span>
  );
}

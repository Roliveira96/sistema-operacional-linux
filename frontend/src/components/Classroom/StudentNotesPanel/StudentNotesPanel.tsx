"use client";

import { useEffect, useId, useRef, useState } from "react";
import { messages } from "@/messages/pt-BR";
import { classroomService } from "@/services/classroomService";
import styles from "./StudentNotesPanel.module.scss";

const m = messages.classroom.notes;

/** The longest note, as in the server (SPEC-051, section 5.6). */
export const NOTES_MAX_LENGTH = 20_000;
/** How long after the last key the notes are saved. */
const SAVE_DELAY_MS = 1000;

export interface StudentNotesPanelProps {
  classId: string;
  sessionId: string;
}

/** The private notebook of the student for a live class: it saves by itself, a moment after he stops typing (SPEC-051 CA-10). */
export function StudentNotesPanel({ classId, sessionId }: StudentNotesPanelProps) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const id = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);

  const save = (text: string) => {
    pending.current = null;
    setStatus("saving");
    classroomService.saveNotes(classId, sessionId, text).then(
      () => setStatus("saved"),
      () => setStatus("error"),
    );
  };

  useEffect(() => {
    let active = true;
    classroomService
      .getNotes(classId, sessionId)
      .then((note) => active && setContent(note.content))
      .catch(() => undefined)
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
  }, [classId, sessionId]);

  // What was typed and is still waiting is saved when the panel goes away, so a note is never lost.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      if (pending.current !== null) void classroomService.saveNotes(classId, sessionId, pending.current).catch(() => undefined);
    },
    [classId, sessionId],
  );

  const change = (text: string) => {
    setContent(text);
    pending.current = text;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), SAVE_DELAY_MS);
  };

  if (!loaded) return <p className={styles.muted}>{m.loading}</p>;

  return (
    <div className={styles.panel}>
      <label htmlFor={id} className={styles.title}>
        {m.title}
      </label>
      <textarea
        id={id}
        className={styles.box}
        value={content}
        maxLength={NOTES_MAX_LENGTH}
        placeholder={m.placeholder}
        onChange={(e) => change(e.target.value)}
      />
      <div className={styles.footer}>
        <span className={styles.muted}>{m.limit}</span>
        {status === "saving" && <span className={styles.muted}>{m.saving}</span>}
        {status === "saved" && (
          <span className={styles.saved} role="status">
            {m.saved}
          </span>
        )}
        {status === "error" && (
          <span className={styles.error} role="alert">
            {m.error}
          </span>
        )}
      </div>
    </div>
  );
}

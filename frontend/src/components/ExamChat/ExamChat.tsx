"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { formatDateTime, formatHour } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { ExamChatMessage } from "@/services/assessmentService";
import styles from "./ExamChat.module.scss";

const c = messages.assessments.chat;
const MAX = 500;

/** Who reads the conversation: the teacher in the room, the student in the exam, or the teacher who reads the record after (SPEC-093). */
export type ChatViewer = "teacher" | "student" | "record";

export interface ChatThreadProps {
  messages: ExamChatMessage[];
  viewer: ChatViewer;
  /** The student of the conversation, for the teacher. */
  studentName?: string;
  emptyText?: string;
}

function whoOf(m: ExamChatMessage, viewer: ChatViewer, studentName?: string): string {
  if (viewer === "record") return m.senderName ?? (m.from === "TEACHER" ? c.teacher : (studentName ?? ""));
  if (viewer === "teacher") return m.from === "STUDENT" ? (studentName ?? "") : c.you;
  if (m.from === "STUDENT") return c.you;
  return m.scope === "all" ? c.teacherToAll : c.teacherToYou;
}

/** The messages in the order of time, as plain text with their new lines; the newest stays in view (SPEC-093 CA-10). */
export function ChatThread({ messages: list, viewer, studentName, emptyText }: ChatThreadProps) {
  const box = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length]);

  if (list.length === 0 && emptyText) return <p className={styles.empty}>{emptyText}</p>;
  return (
    <ol ref={box} aria-label={c.list} className={styles.thread}>
      {list.map((m) => (
        <li key={m.id} className={`${styles.message} ${m.from === "TEACHER" ? styles.fromTeacher : styles.fromStudent}`}>
          <span className={styles.meta}>
            <span className={styles.who}>{whoOf(m, viewer, studentName)}</span>
            {viewer !== "student" && m.scope === "all" && <span className={styles.tag}>{c.toAll}</span>}
            <span>{viewer === "record" ? formatDateTime(m.createdAt) : formatHour(m.createdAt)}</span>
            {m.position !== undefined && <span>{c.question(m.position)}</span>}
          </span>
          <p className={styles.text}>{m.text}</p>
        </li>
      ))}
    </ol>
  );
}

export interface ChatAction {
  label: string;
  send: (text: string) => void;
}

/** The field of a message, up to 500 characters: Enter sends with the first action, Shift+Enter breaks the line (SPEC-093 CA-07, CA-08). */
export function ChatComposer({ actions, disabled = false }: { actions: ChatAction[]; disabled?: boolean }) {
  const [text, setText] = useState("");
  const ready = !disabled && text.trim() !== "";
  const send = (action: ChatAction | undefined) => {
    if (!action || !ready) return;
    action.send(text.trim());
    setText("");
  };
  return (
    <div className={styles.composer}>
      <textarea
        aria-label={c.field}
        className={styles.field}
        maxLength={MAX}
        rows={2}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          send(actions[0]);
        }}
      />
      <div className={styles.actions}>
        <span className={styles.count}>{c.count(text.length)}</span>
        {actions.map((a, i) => (
          <Button key={a.label} variant={i === 0 ? "primary" : "secondary"} disabled={!ready} onClick={() => send(a)}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export interface StudentChatProps {
  messages: ExamChatMessage[];
  open: boolean;
  unread: number;
  online: boolean;
  onToggle: () => void;
  onSend: (text: string) => void;
}

/** The conversation of the student with the teacher, in the header of the exam: the button with the new ones and the column over the terminal. */
export function StudentChat({ messages: list, open, unread, online, onToggle, onSend }: StudentChatProps) {
  return (
    <div className={styles.student}>
      <Button variant="secondary" aria-expanded={open} aria-label={!open && unread > 0 ? c.openUnread(unread) : c.open} onClick={onToggle}>
        {c.open}
        {!open && unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread}
          </span>
        )}
      </Button>
      {open && (
        <section className={styles.column} aria-label={c.list}>
          <ChatThread viewer="student" messages={list} emptyText={c.studentEmpty} />
          <ChatComposer actions={[{ label: c.send, send: onSend }]} disabled={!online} />
          <p className={styles.kept}>{c.kept}</p>
        </section>
      )}
    </div>
  );
}

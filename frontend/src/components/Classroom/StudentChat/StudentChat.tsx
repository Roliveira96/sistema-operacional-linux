"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { CHAT_MAX, type LiveChatMessage } from "@/services/classroomService";
import styles from "./StudentChat.module.scss";

const m = messages.classroom.chat;

/** What the server does not take in a message: the control characters, all but the line break, which the field keeps. */
const CONTROL = /[^\P{Cc}\n]/gu;
/** The server refuses more than three line breaks in a row, so the field never holds them. */
const LONG_BREAK = /\n{4,}/g;

const characters = (text: string) => Array.from(text);

/** The text as the field keeps it: as the server takes it and at most the longest message, counted by character as the server counts it. */
const clean = (text: string) => characters(text.replace(CONTROL, "").replace(LONG_BREAK, "\n\n\n")).slice(0, CHAT_MAX).join("");

/** Who a message is from, told by words and never by a color alone: the teacher to everybody, the teacher to this student, or the student himself. */
function kindOf(message: LiveChatMessage) {
  if (message.scope === "all") return { kind: "all", who: m.fromAll };
  return message.from === "TEACHER" ? { kind: "teacher", who: m.fromTeacherPrivate } : { kind: "mine", who: m.fromMe };
}

export interface StudentChatProps {
  /** The messages for everybody and the ones of this student's conversation, the oldest first, as the room gives them. */
  messages: LiveChatMessage[];
  /** Whether the room is connected: with no connection nothing is sent, and the student is told. */
  connected: boolean;
  /** Sends the text, trimmed, and says whether it went; the field is emptied only when it did. */
  onSend(text: string): boolean;
}

/**
 * The conversation of the student with the teacher, in the column beside the stage (SPEC-063): the messages in order of time, each one marked, with the newest
 * always in view, and the field under them. Enter sends and Shift+Enter breaks the line; an Enter that only confirms a word of an input method does neither.
 * A message is drawn only when the room gives it back, the student's own too, and always as text (the style keeps its line breaks), never as HTML.
 */
export function StudentChat({ messages: items, connected, onSend }: StudentChatProps) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement>(null);
  const text = draft.trim();
  const newest = items[items.length - 1]?.id;

  // The newest message is the one in view: when the column opens and every time a message comes.
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [newest]);

  const send = () => {
    if (!connected || text === "") return;
    if (onSend(text)) setDraft("");
  };

  return (
    <div className={styles.chat}>
      <div ref={list} role="log" tabIndex={0} className={styles.list}>
        {items.length === 0 ? (
          <p className={styles.empty}>{m.empty}</p>
        ) : (
          <ul className={styles.items}>
            {items.map((message) => {
              const { kind, who } = kindOf(message);
              return (
                <li key={message.id} className={styles.item} data-kind={kind}>
                  <span className={styles.who}>{who}</span>
                  <p className={styles.text}>{message.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className={styles.compose}>
        <textarea
          className={styles.field}
          rows={3}
          value={draft}
          aria-label={m.inputLabel}
          placeholder={m.inputLabel}
          autoComplete="off"
          onChange={(event) => setDraft(clean(event.target.value))}
          onKeyDown={(event) => {
            // Shift+Enter breaks the line; the Enter that only confirms a word of an input method is not a send.
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
        />
        <div className={styles.footer}>
          <span className={styles.count}>{m.count(characters(draft).length, CHAT_MAX)}</span>
          {/* Always in the page, so the screen reader tells the loss of the connection when it comes. */}
          <span className={styles.offline} role="status">
            {connected ? "" : m.offline}
          </span>
          <Button variant="primary" size="sm" disabled={!connected || text === ""} onClick={send}>
            {m.send}
          </Button>
        </div>
      </div>
    </div>
  );
}

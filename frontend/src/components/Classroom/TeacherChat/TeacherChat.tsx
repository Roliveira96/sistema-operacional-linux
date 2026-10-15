"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { CHAT_MAX, type ChatTarget, type LiveChatMessage } from "@/services/classroomService";
import styles from "./TeacherChat.module.scss";

const m = messages.classroom.teacherChat;
const tips = messages.classroom.exerciseBoard;

/** What the server does not take in a message: control characters, but the line break stays, and more than three line breaks in a row (SPEC-063 3.1). */
const CONTROL = /(?!\n)\p{Cc}/gu;
const BREAKS = /\n{4,}/g;

const characters = (text: string) => Array.from(text);

/** The text as the field keeps it: clean for the server, and at most the longest message, counted by character as the server counts it. */
export const clean = (text: string) => characters(text.replace(CONTROL, "").replace(BREAKS, "\n\n\n")).slice(0, CHAT_MAX).join("");

export interface TeacherChatProps {
  /** The conversation that is open: with a student, with the whole class, or none. */
  target: ChatTarget | null;
  /** The name of the student of the conversation. */
  studentName: string;
  /** All the messages of the room, oldest first; the conversation takes its own. */
  chat: LiveChatMessage[];
  /** The doubt of the hand of the student of the conversation, when it is up. */
  doubt?: string;
  connected: boolean;
  /** Sends the message and says whether it went (the field only clears if it did). */
  onSend(text: string, to: ChatTarget): boolean;
  /** The tips of the exercise that is running: each one fills the field of the open conversation (SPEC-065 3.3). None by default. */
  suggestions?: string[];
}

/**
 * The conversation of the teacher in the panel (SPEC-063 CA-07): the messages of a student, together with the ones for everybody, or only the ones for
 * everybody; the doubt of his hand pinned on top; and the field, where Enter answers in private and the other button answers the whole class.
 */
export function TeacherChat({ target, studentName, chat, doubt, connected, onSend, suggestions = [] }: TeacherChatProps) {
  const titleId = useId();
  const tipsId = useId();
  const log = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  // What is written is kept for each conversation, so going to another card never loses it and never sends it to the wrong place.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // The conversation where the notice of the message for everybody shows.
  const [announced, setAnnounced] = useState<string | null>(null);

  const key = target === null ? "" : target === "all" ? "all" : target.studentId;
  const draft = drafts[key] ?? "";
  const blocked = !connected || draft.trim() === "";
  const shown =
    target === null ? [] : chat.filter((message) => message.scope === "all" || (target !== "all" && message.studentId === target.studentId));
  const heading = target === "all" ? m.channelAll : m.withStudent(studentName);

  useEffect(() => {
    if (key) field.current?.focus();
  }, [key]);

  // The newest message is the one in view.
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [key, shown.length]);

  const write = (text: string) => {
    setDrafts((all) => ({ ...all, [key]: text }));
    setAnnounced(null);
  };

  // A tip fills the field, and the teacher can still change it before sending (SPEC-065 3.3).
  const use = (tip: string) => {
    write(clean(tip));
    field.current?.focus();
  };

  const send = (to: ChatTarget) => {
    if (blocked || !onSend(draft, to)) return;
    write("");
    if (to === "all" && target !== "all") setAnnounced(key);
  };

  return (
    <section className={styles.chat} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {m.title}
      </h2>

      {target === null ? (
        <p className={styles.muted}>{m.noConversation}</p>
      ) : (
        <>
          <h3 className={styles.heading}>{heading}</h3>
          {/* The doubt is text, as every message is: React writes it as such, so no HTML in it ever runs (SPEC-063 CA-10). */}
          {target !== "all" && doubt && (
            <div className={styles.doubt}>
              <strong>{m.pinnedDoubt}</strong>
              <p className={styles.doubtText}>{doubt}</p>
            </div>
          )}
          <div ref={log} className={styles.log} role="log" aria-label={heading} tabIndex={0}>
            {shown.length === 0 ? (
              <p className={styles.muted}>{m.empty}</p>
            ) : (
              <ol className={styles.list}>
                {shown.map((message) => (
                  <li key={message.id} className={`${styles.message} ${message.from === "TEACHER" ? styles.mine : ""}`}>
                    <span className={styles.author}>{message.from === "TEACHER" ? m.you : studentName}</span>
                    {message.scope === "all" && <span className={styles.tag}>{m.tagAll}</span>}
                    <p className={styles.text}>{message.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {announced === key && (
            <p className={styles.sent} role="status">
              {m.sentAll}
            </p>
          )}
          {suggestions.length > 0 && (
            <div role="group" aria-labelledby={tipsId} className={styles.suggestions}>
              <span id={tipsId} className={styles.suggestionsTitle}>
                {tips.tipsTitle}
              </span>
              <ol className={styles.suggestionList}>
                {suggestions.map((tip, index) => (
                  <li key={index} className={styles.suggestion}>
                    {/* A tip is text, as every message is: React writes it as such (SPEC-065 CA-15). */}
                    <span className={styles.suggestionText}>{tip}</span>
                    <Button variant="secondary" size="sm" onClick={() => use(tip)}>
                      {tips.useTip(index + 1)}
                    </Button>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <textarea
            ref={field}
            className={styles.field}
            value={draft}
            rows={3}
            aria-label={m.inputLabel}
            autoComplete="off"
            onChange={(event) => write(clean(event.target.value))}
            onKeyDown={(event) => {
              // Enter that only confirms a word of an input method is not a send, and Shift+Enter breaks the line.
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              send(target);
            }}
          />
          <div className={styles.footer}>
            <span className={styles.count}>{m.count(characters(draft).length, CHAT_MAX)}</span>
            {!connected && <span className={styles.offline}>{m.offline}</span>}
          </div>
          <div className={styles.actions}>
            {target !== "all" && (
              <Button variant="primary" size="sm" disabled={blocked} onClick={() => send(target)}>
                {m.sendPrivate(studentName)}
              </Button>
            )}
            <Button variant={target === "all" ? "primary" : "secondary"} size="sm" disabled={blocked} onClick={() => send("all")}>
              {m.sendAll}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { HAND_QUESTION_MAX } from "@/services/classroomService";
import styles from "./HandQuestion.module.scss";

const m = messages.classroom.hands;

/** What the server does not take in a doubt: control characters. The field is one line, so the line break goes too. */
const CONTROL = /\p{Cc}/gu;

const characters = (text: string) => Array.from(text);

/** The text as the field keeps it: with no control characters and at most the longest doubt, counted by character as the server counts it. */
const clean = (text: string) => characters(text.replace(CONTROL, "")).slice(0, HAND_QUESTION_MAX).join("");

export interface HandQuestionProps {
  /** The doubt the room has for this hand, empty with none: it starts the field, and says whether what is written was sent. */
  saved: string;
  /** Sends the doubt, trimmed; empty takes it away from the hand. */
  onSend(question: string): void;
  /** Puts the cursor in the field when it appears: the modal that opens for the doubt (SPEC-062). */
  autoFocus?: boolean;
}

/**
 * The doubt that goes with the raised hand, in the strip of the student (SPEC-058 CA-04): a field of up to 300 characters with the counter, sent by
 * the button or by Enter. It says "Dúvida enviada" while what is written is what the room has, and what is written can be changed and sent again.
 * The field belongs to the student: what the room tells about the doubt only moves the mark, never the text he is writing.
 */
export function HandQuestion({ saved, onSend, autoFocus }: HandQuestionProps) {
  const [draft, setDraft] = useState(saved);
  const question = draft.trim();
  const changed = question !== saved;
  const send = () => {
    if (changed) onSend(question);
  };

  return (
    <div className={styles.question}>
      <input
        type="text"
        className={styles.field}
        value={draft}
        aria-label={m.questionLabel}
        placeholder={m.questionLabel}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(event) => setDraft(clean(event.target.value))}
        onKeyDown={(event) => {
          // Enter that only confirms a word of an input method is not a send.
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          send();
        }}
      />
      <span className={styles.count}>{m.questionCount(characters(draft).length, HAND_QUESTION_MAX)}</span>
      <Button variant="secondary" size="sm" disabled={!changed} onClick={send}>
        {m.questionSend}
      </Button>
      {!changed && saved !== "" && (
        <span className={styles.sent} role="status">
          {m.questionSent}
        </span>
      )}
    </div>
  );
}

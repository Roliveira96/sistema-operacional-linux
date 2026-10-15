"use client";

import { useId } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { AdmissionEntry, ChatTarget, HandRaiseItem } from "@/services/classroomService";
import { useMinuteClock } from "../useMinuteClock";
import styles from "./OnlineStudents.module.scss";

const m = messages.classroom.teacherChat;

export interface OnlineStudentsProps {
  /** The students who are in the class; only the ones in `online` get a card. */
  admitted: AdmissionEntry[];
  /** The ids of the accepted students who are in the room. */
  online: string[];
  /** The raised hands, which put the mark and the doubt on the card. */
  hands: HandRaiseItem[];
  /** The new messages of each student, by id; none when the id is not there. */
  unread: Record<string, number>;
  /** The conversation that is open, to mark its button. */
  selected: ChatTarget | null;
  onSelect(to: ChatTarget): void;
}

const raisedAt = (hand: HandRaiseItem) => Date.parse(hand.requestedAt) || 0;

/**
 * The students who are online, as cards (SPEC-063 CA-01): the name, the raised hand with its doubt and how long ago, the new messages, and the button
 * that opens the conversation. The ones with the hand up come first, the oldest hand before; then who has new messages; then the others, by name.
 */
export function OnlineStudents({ admitted, online, hands, unread, selected, onSelect }: OnlineStudentsProps) {
  const titleId = useId();
  const now = useMinuteClock();
  const here = new Set(online);
  const cards = admitted
    .filter((student) => here.has(student.studentId))
    .map((student) => ({ student, hand: hands.find((hand) => hand.studentId === student.studentId), news: unread[student.studentId] ?? 0 }))
    .sort((a, b) => {
      const byName = a.student.name.localeCompare(b.student.name, "pt-BR");
      if (a.hand && b.hand) return raisedAt(a.hand) - raisedAt(b.hand) || byName;
      if (a.hand || b.hand) return a.hand ? -1 : 1;
      if (a.news > 0 !== b.news > 0) return a.news > 0 ? -1 : 1;
      return byName;
    });

  return (
    <section className={styles.section} aria-labelledby={titleId}>
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>
          {m.onlineTitle}
        </h2>
        <Button variant={selected === "all" ? "primary" : "secondary"} size="sm" aria-pressed={selected === "all"} onClick={() => onSelect("all")}>
          {m.toAll}
        </Button>
      </div>

      {cards.length === 0 ? (
        <p className={styles.muted}>{m.onlineEmpty}</p>
      ) : (
        <ul className={styles.grid}>
          {cards.map(({ student, hand, news }) => {
            const open = selected !== null && selected !== "all" && selected.studentId === student.studentId;
            return (
              <li key={student.studentId} className={`${styles.card} ${hand ? styles.raised : ""} ${open ? styles.open : ""}`}>
                <div className={styles.head}>
                  <strong className={styles.name} data-testid="online-name">
                    {student.name}
                  </strong>
                  {news > 0 && <span className={styles.news}>{m.newMessages(news)}</span>}
                </div>
                {hand && (
                  <div className={styles.hand}>
                    <span className={styles.handUp}>{m.handUp}</span>
                    <span className={styles.muted}>{messages.classroom.hands.since(Math.max(0, Math.floor((now - raisedAt(hand)) / 60_000)))}</span>
                    {/* The doubt is text: React writes it as such, so no HTML in it ever runs (SPEC-063 CA-10). */}
                    {hand.question && (
                      <span className={styles.question} data-testid="online-question">
                        {hand.question}
                      </span>
                    )}
                  </div>
                )}
                <Button
                  variant={open ? "primary" : "secondary"}
                  size="sm"
                  aria-label={m.talkWith(student.name)}
                  aria-pressed={open}
                  onClick={() => onSelect({ studentId: student.studentId })}
                >
                  {m.talk}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

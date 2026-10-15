import { useEffect, useRef } from "react";
import { messages } from "@/messages/pt-BR";
import type { HandRaiseItem, LiveChatMessage } from "@/services/classroomService";
import { browserNotice, type BrowserNotice, type NoticeContent } from "./browserNotice";

const m = messages.classroom.notices;

/** The most notices shown for one update of the room; what is left is told in one more, so a flood does not bury the screen (SPEC-064 section 6). */
const MAX_PER_UPDATE = 3;

export interface RoomNoticesInput {
  /** Who is watching: the panel is told of the hands and of the messages of the students, the room of the student of the messages of the teacher. */
  role: "teacher" | "student";
  /** All the messages the room gave this screen. */
  chat: LiveChatMessage[];
  hands: HandRaiseItem[];
  /** Whether the room gave its first snapshot; the lists that come with it are the history. */
  ready: boolean;
  /** The choice of the person for the notices. */
  enabled: boolean;
  /** The name of a student, for the message of a student, which only the panel is told of; empty when it is not known. */
  nameOf?(studentId: string): string;
  /** The click on a notice: the panel opens the conversation of the student, the room opens the column "Conversa" (SPEC-064 CA-06). */
  onOpen(studentId?: string): void;
  /** The access to the browser; a test puts a double here. */
  notice?: BrowserNotice;
}

/**
 * The notices of the browser for the live class (SPEC-064): the panel is told when a hand goes up and when a student writes, the room of the student when the
 * teacher writes, and only when the person is not looking at the page. A thing is new when its id (message) or its student (hand) was not in what this screen
 * already knew; the first list the ready room gives is the history and notifies nothing. The messages are compared with all the ids ever seen, so the snapshot
 * of a reconnection that brings the history again, with some new messages, notifies only the new ones. The hands are compared with the line as it was, so
 * the change of the doubt of a hand that is up and a hand that goes down are not news, and a hand that goes down and up again is. What arrives with the
 * notices off, with the page in view or without the permission is taken as seen, so it is not told later.
 */
export function useRoomNotices({ role, chat, hands, ready, enabled, nameOf, onOpen, notice = browserNotice }: RoomNoticesInput) {
  const seenMessages = useRef<ReadonlySet<string> | null>(null);
  const lastHands = useRef<readonly string[] | null>(null);

  useEffect(() => {
    if (!ready) return;
    const knownMessages = seenMessages.current;
    const knownHands = lastHands.current;
    seenMessages.current = new Set([...(knownMessages ?? []), ...chat.map((message) => message.id)]);
    lastHands.current = hands.map((hand) => hand.studentId);
    if (!knownMessages || !knownHands) return;
    if (!enabled || notice.permission() !== "granted" || notice.inView()) return;

    const fresh: NoticeContent[] = [];
    if (role === "teacher") {
      for (const hand of hands) {
        if (knownHands.includes(hand.studentId)) continue;
        fresh.push({ title: m.handTitle, body: m.handBody(hand.name || m.someone, hand.question), tag: `hand-${hand.studentId}`, onClick: () => onOpen(hand.studentId) });
      }
    }
    // The person is told of what the other side writes, never of what he wrote himself, which the room gives back.
    const other = role === "teacher" ? "STUDENT" : "TEACHER";
    for (const message of chat) {
      if (knownMessages.has(message.id) || message.from !== other) continue;
      const title = role === "teacher" ? m.studentTitle(nameOf?.(message.studentId ?? "") || m.someone) : message.scope === "all" ? m.teacherAll : m.teacherPrivate;
      fresh.push({ title, body: message.text, tag: `chat-${message.id}`, onClick: () => onOpen(message.studentId) });
    }

    for (const shown of fresh.slice(0, MAX_PER_UPDATE)) notice.show(shown);
    if (fresh.length > MAX_PER_UPDATE) notice.show({ title: m.moreTitle, body: m.moreBody(fresh.length - MAX_PER_UPDATE), tag: "more" });
  }, [role, chat, hands, ready, enabled, nameOf, onOpen, notice]);
}

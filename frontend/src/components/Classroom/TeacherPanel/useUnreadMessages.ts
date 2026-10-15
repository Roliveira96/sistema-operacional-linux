import { useCallback, useState } from "react";
import type { LiveChatMessage } from "@/services/classroomService";

interface Unread {
  /** The ids already accounted for; null until the room is ready, which is what makes the first list the history. */
  seen: ReadonlySet<string> | null;
  /** The new messages of each student, by id. */
  counts: Record<string, number>;
}

const NONE: Unread = { seen: null, counts: {} };

/**
 * How many new messages each student has written since the teacher last looked at his conversation (SPEC-063 CA-07). It lives only in the open screen:
 * what the room gives when the panel opens or is reloaded is history and counts as read, and nothing is stored (SPEC-063 section 10, item 4).
 *
 * @param chat all the messages of the room, oldest first.
 * @param ready whether the room has given its first snapshot; the messages that come with it are the history.
 * @param open the student whose conversation is open, if any: what he writes while the teacher is reading is not new.
 */
export function useUnreadMessages(chat: LiveChatMessage[], ready: boolean, open: string | null) {
  const [state, setState] = useState<Unread>(NONE);

  // Derived from what the room gives, while rendering: a message is counted once, the first time it is seen.
  if (!ready) {
    if (state.seen !== null) setState(NONE);
  } else {
    const fresh = chat.filter((message) => !state.seen?.has(message.id));
    if (state.seen === null || fresh.length > 0) {
      const counts = { ...state.counts };
      if (state.seen !== null) {
        for (const message of fresh) {
          if (message.from === "STUDENT" && message.studentId && message.studentId !== open) counts[message.studentId] = (counts[message.studentId] ?? 0) + 1;
        }
      }
      setState({ seen: new Set([...(state.seen ?? []), ...fresh.map((message) => message.id)]), counts });
    }
  }

  /** The teacher opens the conversation of a student: what was new is read. */
  const markRead = useCallback((studentId: string) => {
    setState((current) => (current.counts[studentId] ? { ...current, counts: { ...current.counts, [studentId]: 0 } } : current));
  }, []);

  return { unread: state.counts, markRead };
}

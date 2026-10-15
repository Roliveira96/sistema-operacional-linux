"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { messages } from "@/messages/pt-BR";
import { classroomService, type MyLiveRoom } from "@/services/classroomService";
import styles from "./LiveNowBanner.module.scss";

/** How often the open rooms are asked again while the tab is in view (SPEC-067, P-02). */
const CHECK_EVERY_MS = 20_000;

/**
 * The notice of the live classes that are going on in the classes of the student, with the way in (SPEC-067). It asks when it opens, every
 * 20 seconds and when the tab comes back into view, and never while the tab is hidden. A failed check only hides the notice.
 */
export function LiveNowBanner() {
  const [rooms, setRooms] = useState<MyLiveRoom[]>([]);

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      classroomService.listMyLive().then(
        (items) => alive && setRooms(items),
        () => alive && setRooms([]),
      );
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);

  if (rooms.length === 0) return null;
  return (
    <section className={styles.banner} role="status" aria-label={messages.liveNow.region}>
      <ul className={styles.list}>
        {rooms.map((room) => (
          <li key={room.sessionId} className={styles.row}>
            <span className={styles.badge}>{messages.liveNow.badge}</span>
            <span className={styles.text}>
              <strong>{messages.liveNow.title(room.title)}</strong>
              <span className={styles.className}>{room.className}</span>
            </span>
            <ButtonLink href={`/app/classes/${room.classId}/live`} variant="primary">
              {messages.liveNow.enter}
            </ButtonLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

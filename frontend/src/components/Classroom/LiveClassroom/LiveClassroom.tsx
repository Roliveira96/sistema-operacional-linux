"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import type { LiveSession } from "@/services/classroomService";
import { elapsed } from "../elapsed";
import { LiveInteractionDrawer } from "../LiveInteractionDrawer/LiveInteractionDrawer";
import { ModuleStage } from "../ModuleStage/ModuleStage";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import { StudentNotesPanel } from "../StudentNotesPanel/StudentNotesPanel";
import { WaitingRoom } from "../WaitingRoom/WaitingRoom";
import styles from "./LiveClassroom.module.scss";

const m = messages.classroom;

export interface LiveClassroomProps {
  classId: string;
  userId: string;
  session: LiveSession;
}

/**
 * The live classroom of the student: the bar, the stage that follows the teacher, and the side of the hand and the notes. The student waits
 * for the teacher to accept him (SPEC-051, section 3.1; SPEC-054). The teacher has the panel and the presentation window (SPEC-055).
 */
export function LiveClassroom({ classId, userId, session }: LiveClassroomProps) {
  const router = useRouter();
  const live = useLiveClassroom({ classId, role: "student" });
  const [now, setNow] = useState(() => Date.now());
  const [joinedAt] = useState(() => Date.now());
  const [side, setSide] = useState(true);
  const back = `/app/classes/${classId}`;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  if (live.ended) {
    return (
      <main className={styles.room}>
        <p className={styles.ended} role="status">
          {m.room.ended}
        </p>
        <Link href={back} className={styles.link}>
          {m.room.backToClass}
        </Link>
      </main>
    );
  }

  if (live.admission === "WAITING" || live.admission === "REMOVED") {
    return (
      <main className={styles.room}>
        <header className={styles.bar}>
          <h1 className={styles.title}>{session.title}</h1>
          <Button variant="secondary" size="sm" onClick={() => router.push(back)}>
            {m.room.leave}
          </Button>
        </header>
        <WaitingRoom state={live.admission} waitedMinutes={Math.floor((now - joinedAt) / 60_000)} onAskAgain={live.requestEntry} />
      </main>
    );
  }

  const room = live.room;
  const mode = room.mode;

  return (
    <main className={styles.room}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{session.title}</h1>
        <span className={styles.meta} role="timer" aria-label={m.room.timer}>
          {elapsed(now - new Date(session.startedAt).getTime())}
        </span>
        <span className={styles.meta}>{m.room.online(room.online)}</span>
        <span className={styles.meta}>{mode === "SLIDES" ? m.room.modeSlides : m.room.modeModule}</span>
        <Button variant="ghost" size="sm" aria-expanded={side} onClick={() => setSide(!side)}>
          {m.room.notesToggle}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => router.push(back)}>
          {m.room.leave}
        </Button>
      </header>

      {!live.ready && (
        <p className={styles.status} role="status">
          {m.room.connecting}
        </p>
      )}
      {live.ready && !live.connected && (
        <p className={styles.status} role="status">
          {m.room.reconnecting}
        </p>
      )}

      <div className={`${styles.body} ${side ? styles.withSide : ""}`}>
        <div className={`${styles.stage} ${mode === "MODULE" ? styles.moduleStage : ""}`}>
          {mode === "SLIDES" ? (
            room.deck ? (
              <SlidePresenter
                deck={room.deck}
                slide={room.slide}
                canControl={false}
                cursor={room.cursor}
                strokes={room.strokes}
                onSlide={live.changeSlide}
                onCursor={live.moveCursor}
                onDraw={live.draw}
                onClear={live.clearDrawings}
              />
            ) : (
              <p className={styles.status}>{m.room.noDeck}</p>
            )
          ) : (
            <ModuleStage classId={classId} moduleId={room.moduleId} role="student" moduleFocusBlockId={room.moduleFocusBlockId} terminal={live.terminal} />
          )}
          {room.blank && <div className={styles.blank} role="status" aria-label={m.room.blank} />}
        </div>

        {side && (
          <LiveInteractionDrawer role="student" userId={userId} hands={live.hands} onRaise={live.raiseHand} onLower={live.lowerHand} onModerate={live.moderate}>
            <StudentNotesPanel classId={classId} sessionId={session.id} />
          </LiveInteractionDrawer>
        )}
      </div>
    </main>
  );
}

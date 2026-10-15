"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { LiveInteractionDrawer } from "../LiveInteractionDrawer/LiveInteractionDrawer";
import { MirroredModuleView } from "../MirroredModuleView/MirroredModuleView";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import { StudentNotesPanel } from "../StudentNotesPanel/StudentNotesPanel";
import styles from "./LiveClassroom.module.scss";

const m = messages.classroom;

export interface LiveClassroomProps {
  classId: string;
  /** The teacher (and the administrator) conducts; a student follows. */
  role: "teacher" | "student";
  userId: string;
  session: LiveSession;
}

/** h:mm:ss of a time span. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(total / 3600)}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
}

/** The live classroom: the bar, the stage (slides or the module terminal) and the side of the hands and the notes (SPEC-051, section 3.1). */
export function LiveClassroom({ classId, role, userId, session }: LiveClassroomProps) {
  const router = useRouter();
  const live = useLiveClassroom({ classId, role });
  const [now, setNow] = useState(() => Date.now());
  const [side, setSide] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  const back = `/app/classes/${classId}`;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const end = async () => {
    if (!window.confirm(m.panel.endConfirm)) return;
    setEnding(true);
    setError(null);
    try {
      await classroomService.endSession(classId, session.id);
      router.push(back);
    } catch {
      setError(m.panel.errors.end);
      setEnding(false);
    }
  };

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

  const mode = live.room.mode;
  return (
    <main className={styles.room}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{session.title}</h1>
        <span className={styles.meta} role="timer" aria-label={m.room.timer}>
          {elapsed(now - new Date(session.startedAt).getTime())}
        </span>
        <span className={styles.meta}>{m.room.online(live.room.online)}</span>

        {live.canControl ? (
          <div role="radiogroup" aria-label={m.room.modeLabel} className={styles.modes}>
            <Button variant={mode === "SLIDES" ? "primary" : "secondary"} size="sm" role="radio" aria-checked={mode === "SLIDES"} onClick={() => live.switchMode("SLIDES")}>
              {m.room.modeSlides}
            </Button>
            <Button
              variant={mode === "MODULE" ? "primary" : "secondary"}
              size="sm"
              role="radio"
              aria-checked={mode === "MODULE"}
              onClick={() => live.switchMode("MODULE", live.room.moduleId ?? undefined)}
            >
              {m.room.modeModule}
            </Button>
          </div>
        ) : (
          <span className={styles.meta}>{mode === "SLIDES" ? m.room.modeSlides : m.room.modeModule}</span>
        )}

        <Button variant="ghost" size="sm" aria-expanded={side} onClick={() => setSide(!side)}>
          {role === "teacher" ? m.room.queueToggle : m.room.notesToggle}
        </Button>
        {live.canControl ? (
          <Button variant="danger" size="sm" disabled={ending} onClick={() => void end()}>
            {m.room.end}
          </Button>
        ) : role === "student" ? (
          <Button variant="secondary" size="sm" onClick={() => router.push(back)}>
            {m.room.leave}
          </Button>
        ) : null}
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
      {role === "teacher" && live.passive && <p className={styles.status}>{m.room.passive}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={`${styles.body} ${side ? styles.withSide : ""}`}>
        <div className={styles.stage}>
          {mode === "SLIDES" ? (
            live.room.deck ? (
              <SlidePresenter
                deck={live.room.deck}
                slide={live.room.slide}
                canControl={live.canControl}
                cursor={live.room.cursor}
                strokes={live.room.strokes}
                onSlide={live.changeSlide}
                onCursor={live.moveCursor}
                onDraw={live.draw}
                onClear={live.clearDrawings}
              />
            ) : (
              <p className={styles.status}>{m.room.noDeck}</p>
            )
          ) : (
            <MirroredModuleView role={role} terminal={live.terminal} onInput={live.sendTerminalInput} onSync={live.sendTerminalSync} />
          )}
        </div>

        {side && (
          <LiveInteractionDrawer role={role} userId={userId} hands={live.hands} onRaise={live.raiseHand} onLower={live.lowerHand} onModerate={live.moderate}>
            {role === "student" && <StudentNotesPanel classId={classId} sessionId={session.id} />}
          </LiveInteractionDrawer>
        )}
      </div>
    </main>
  );
}

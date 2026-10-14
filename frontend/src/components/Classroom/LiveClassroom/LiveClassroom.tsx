"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import type { LiveSession } from "@/services/classroomService";
import { elapsed } from "../elapsed";
import { FixedStage } from "../FixedStage/FixedStage";
import { HandQuestion } from "../HandQuestion/HandQuestion";
import { ModuleStage } from "../ModuleStage/ModuleStage";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import { StudentNotesPanel } from "../StudentNotesPanel/StudentNotesPanel";
import { WaitingRoom } from "../WaitingRoom/WaitingRoom";
import { WaitingScreen } from "../WaitingScreen/WaitingScreen";
import styles from "./LiveClassroom.module.scss";
import { useRequestedFullscreen } from "./useRequestedFullscreen";

const m = messages.classroom;

export interface LiveClassroomProps {
  classId: string;
  userId: string;
  session: LiveSession;
}

/**
 * The live classroom of the student, in the style of a video call (SPEC-057 CA-13): the stage takes the whole window but a strip of controls at the
 * bottom, which never covers it; the hand, the notes and the full screen are on the strip, and the notes open in a column beside the stage, which is
 * fit to what is left. Nothing is over the stage. The stage is the fixed box the teacher sees, only smaller or bigger, and the student moves nothing of
 * it: the scroll, the divider, the zoom, the mouse and the selection are the teacher's. Inside the stage there is nothing the teacher's stage has not
 * (SPEC-057 CA-22): what is only the student's, the loss of the connection, is told in the strip, and the connecting takes the place of the content.
 * The hand goes up with one click and no text; once it is up, the doubt (optional) is written in the strip itself, never over the stage (SPEC-058).
 * When the teacher asks for the full screen the room goes into focus mode at once, with the stage over the whole window, and tries the full screen of the
 * browser, which may want a gesture of the student first (SPEC-059). The student waits for the teacher to accept him (SPEC-051, section 3.1; SPEC-054).
 * The teacher has the panel and the presentation window (SPEC-055).
 */
export function LiveClassroom({ classId, userId, session }: LiveClassroomProps) {
  const router = useRouter();
  const live = useLiveClassroom({ classId, role: "student" });
  const [now, setNow] = useState(() => Date.now());
  const [joinedAt] = useState(() => Date.now());
  const [notes, setNotes] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLElement>(null);
  const back = `/app/classes/${classId}`;

  // The teacher asked for the full screen: the room goes into focus mode and tries the full screen of the browser (SPEC-059).
  const requested = live.fullscreenRequested;
  const fullscreen = useRequestedFullscreen(frame, requested);
  // The stage has the whole window in focus mode, so the column of notes closes when the request comes; the student can open it again.
  const [focused, setFocused] = useState(false);
  if (requested !== focused) {
    setFocused(requested);
    if (requested) setNotes(false);
  }

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // The full screen is the one of the stage, which then fills the screen with the biggest scale that fits it, with nothing cut.
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void stage.current?.requestFullscreen?.();
  };

  // The key F does the same, unless the student is writing, or the key belongs to the browser.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "f") return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)) return;
      toggleFullscreen();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
  const slideOf = room.deck ? Math.min(Math.max(room.slide, 1), Math.max(room.deck.pageCount, 1)) : 0;
  const place = live.hands.findIndex((hand) => hand.studentId === userId);
  const raised = place >= 0;
  const startedAt = live.startedAt ?? session.startedAt;

  return (
    <main ref={frame} className={styles.live} data-focus={requested ? "true" : undefined}>
      <div className={styles.body}>
        <div ref={stage} className={styles.stage}>
          <FixedStage zoom={live.stageView.zoom}>
            {!live.ready ? (
              <p className={styles.notice} role="status">
                {m.room.connecting}
              </p>
            ) : mode === "SLIDES" ? (
              room.deck ? (
                <SlidePresenter
                  bare
                  deck={room.deck}
                  slide={room.slide}
                  canControl={false}
                  cursor={room.cursor}
                  strokes={room.strokes}
                  scroll={live.stageView.slideScroll}
                  scrollX={live.stageView.slideScrollX}
                  onSlide={live.changeSlide}
                  onCursor={live.moveCursor}
                  onDraw={live.draw}
                  onClear={live.clearDrawings}
                />
              ) : (
                <p className={styles.notice}>{m.room.noDeck}</p>
              )
            ) : (
              <ModuleStage
                classId={classId}
                moduleId={room.moduleId}
                role="student"
                moduleFocusBlockId={room.moduleFocusBlockId}
                terminal={live.terminal}
                cursor={room.cursor}
                stageView={live.stageView}
                startedAt={startedAt}
                handCount={live.handCount}
              />
            )}
            {room.blank && <WaitingScreen title={session.title} startedAt={startedAt} />}
          </FixedStage>
        </div>

        {notes && (
          <aside className={styles.side} aria-label={m.room.notesColumn}>
            <StudentNotesPanel classId={classId} sessionId={session.id} />
          </aside>
        )}
      </div>

      <div className={styles.controls} role="toolbar" aria-label={m.room.controls}>
        <div className={styles.info}>
          <h1 className={styles.name}>{session.title}</h1>
          <span className={styles.meta} role="timer" aria-label={m.room.timer}>
            {elapsed(now - new Date(session.startedAt).getTime())}
          </span>
          {live.ready && !live.connected && (
            <span className={styles.lost} role="status">
              {m.room.reconnecting}
            </span>
          )}
          <span className={styles.meta}>{m.room.online(room.online)}</span>
          <span className={styles.meta}>{mode === "SLIDES" ? m.room.modeSlides : m.room.modeModule}</span>
          {mode === "SLIDES" && room.deck && <span className={styles.meta}>{m.slides.position(slideOf, room.deck.pageCount)}</span>}
        </div>

        <div className={styles.actions}>
          {raised && (
            <span className={styles.handState}>
              <span className={styles.handUp}>{m.hands.handUp}</span>
              <span className={styles.meta}>{m.hands.position(place + 1)}</span>
            </span>
          )}
          {/* The doubt goes in the strip, with the hand: nothing opens over the material (SPEC-058 CA-04). */}
          {raised && <HandQuestion saved={live.myHand?.question ?? ""} onSend={(question) => live.raiseHand(question)} />}
          <Button variant={raised ? "primary" : "secondary"} size="sm" aria-pressed={raised} onClick={() => (raised ? live.lowerHand() : live.raiseHand())}>
            {raised ? m.hands.lower : m.hands.raise}
          </Button>
          <Button variant={notes ? "primary" : "secondary"} size="sm" aria-expanded={notes} onClick={() => setNotes(!notes)}>
            {m.room.notesToggle}
          </Button>
          {/* The browser did not let the room into the full screen, or the student left it, while the teacher asks for it: one click does it (SPEC-059 CA-03, CA-04). */}
          {requested && fullscreen.supported && !fullscreen.inFullscreen && (
            <Button variant="primary" size="sm" data-attention="true" onClick={() => fullscreen.enter()}>
              {m.room.fullscreenRequested}
            </Button>
          )}
          <Button variant="secondary" size="sm" title={`${m.room.fullscreen} (F)`} onClick={toggleFullscreen}>
            {m.room.fullscreen}
          </Button>
        </div>

        <div className={styles.leave}>
          <Button variant="secondary" size="sm" onClick={() => router.push(back)}>
            {m.room.leave}
          </Button>
        </div>
      </div>
    </main>
  );
}

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
import { HandDialog } from "../HandDialog/HandDialog";
import { ModuleStage } from "../ModuleStage/ModuleStage";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import { StudentChat } from "../StudentChat/StudentChat";
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
 * bottom, which never covers it; the hand, the notes, the conversation and the full screen are on the strip, and the notes or the conversation with the
 * teacher open in a column beside the stage, which is fit to what is left (one column at a time, SPEC-063). Nothing is over the stage. The stage is the
 * fixed box the teacher sees, only smaller or bigger, and the student moves nothing of it: the scroll, the divider, the zoom, the mouse and the selection
 * are the teacher's. Inside the stage there is nothing the teacher's stage has not
 * (SPEC-057 CA-22): what is only the student's, the loss of the connection, is told in the strip, and the connecting takes the place of the content.
 * The hand goes up with one click and no text, from the strip or from the hand of the header of the module; then a modal opens for the doubt (optional,
 * SPEC-058, SPEC-062). The modal lives in the room, next to the stage and outside its fixed box, never in a portal, so the hand of the header and the modal
 * are inside whatever the browser puts in full screen, and the stage of the others does not change.
 * The full screen, of the button, of the key F and of the request of the teacher, is the one of the whole room, so the strip, the notes, the conversation
 * and the modal stay in it (SPEC-063 CA-09).
 * When the teacher asks for the full screen the room goes into focus mode at once, with the stage over the whole window, and tries the full screen of the
 * browser, which may want a gesture of the student first (SPEC-059). The student waits for the teacher to accept him (SPEC-051, section 3.1; SPEC-054).
 * The teacher has the panel and the presentation window (SPEC-055).
 */
export function LiveClassroom({ classId, userId, session }: LiveClassroomProps) {
  const router = useRouter();
  const live = useLiveClassroom({ classId, role: "student" });
  const [now, setNow] = useState(() => Date.now());
  const [joinedAt] = useState(() => Date.now());
  // The column beside the stage: the notes or the conversation with the teacher, never both (SPEC-063).
  const [side, setSide] = useState<"notes" | "chat" | null>(null);
  const notes = side === "notes";
  const chatOpen = side === "chat";
  const toggleSide = (which: "notes" | "chat") => setSide(side === which ? null : which);
  // The modal of the doubt is open: the student raised the hand, or came to write the doubt of the hand that is up (SPEC-062).
  const [asking, setAsking] = useState(false);
  const frame = useRef<HTMLElement>(null);
  const back = `/app/classes/${classId}`;

  // The teacher asked for the full screen: the room goes into focus mode and tries the full screen of the browser (SPEC-059).
  const requested = live.fullscreenRequested;
  const fullscreen = useRequestedFullscreen(frame, requested);
  // The stage has the whole window in focus mode, so the column of notes or of the conversation closes when the request comes; the student can open it again.
  const [focused, setFocused] = useState(false);
  if (requested !== focused) {
    setFocused(requested);
    if (requested) setSide(null);
  }

  // The messages of the teacher the student has seen, to tell the new ones in the strip (SPEC-063). It is null until the first snapshot, whose history counts
  // as read, as the one that comes when he comes back does; whatever comes while the conversation is open is read too, and opening it clears the number.
  // Nothing is kept for the next visit.
  const [seen, setSeen] = useState<ReadonlySet<string> | null>(null);
  const fromTeacher = live.chat.filter((message) => message.from === "TEACHER").map((message) => message.id);
  const unread = seen ? fromTeacher.filter((id) => !seen.has(id)).length : 0;
  if (live.ready && (seen === null || (chatOpen && unread > 0))) setSeen(new Set(fromTeacher));

  const place = live.hands.findIndex((hand) => hand.studentId === userId);
  const raised = place >= 0;
  // The hand goes down, by the student or by the teacher: the modal has nothing left to say.
  const [wasRaised, setWasRaised] = useState(raised);
  if (raised !== wasRaised) {
    setWasRaised(raised);
    if (!raised) setAsking(false);
  }
  // The hand goes up with one click and no text, and the doubt is asked for in the modal; with the hand already up there is only the modal.
  const askHand = () => {
    if (!raised) live.raiseHand();
    setAsking(true);
  };
  const lowerHand = () => {
    setAsking(false);
    live.lowerHand();
  };

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // The full screen is the one of the whole room, as the request of the teacher asks for, so the strip, the columns and the modal stay in it; the stage
  // then fills what is left of the screen with the biggest scale that fits it, with nothing cut (SPEC-063 CA-09).
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void frame.current?.requestFullscreen?.();
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
  const startedAt = live.startedAt ?? session.startedAt;

  return (
    <main ref={frame} className={styles.live} data-focus={requested ? "true" : undefined}>
      <div className={styles.body}>
        <div className={styles.stage}>
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
                onHand={askHand}
                handRaised={raised}
              />
            )}
            {room.blank && <WaitingScreen title={session.title} startedAt={startedAt} />}
          </FixedStage>
          {/* In the room of the stage, outside its fixed box, and in no portal: it is in the full screen too (SPEC-062 CA-05, CA-07). */}
          {asking && <HandDialog saved={live.myHand?.question ?? ""} onSend={(question) => live.raiseHand(question)} onLower={lowerHand} onClose={() => setAsking(false)} />}
        </div>

        {side && (
          <aside className={styles.side} aria-label={notes ? m.room.notesColumn : m.chat.column}>
            {notes ? <StudentNotesPanel classId={classId} sessionId={session.id} /> : <StudentChat messages={live.chat} connected={live.connected} onSend={live.sendChat} />}
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
          <Button variant={raised ? "primary" : "secondary"} size="sm" aria-pressed={raised} onClick={() => (raised ? lowerHand() : askHand())}>
            {raised ? m.hands.lower : m.hands.raise}
          </Button>
          <Button variant={notes ? "primary" : "secondary"} size="sm" aria-expanded={notes} onClick={() => toggleSide("notes")}>
            {m.room.notesToggle}
          </Button>
          <Button
            variant={chatOpen ? "primary" : "secondary"}
            size="sm"
            aria-expanded={chatOpen}
            aria-label={unread > 0 ? m.chat.toggleWithNew(unread) : undefined}
            onClick={() => toggleSide("chat")}
          >
            {m.chat.toggle}
            {unread > 0 && (
              <span className={styles.badge} aria-hidden="true">
                {unread}
              </span>
            )}
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

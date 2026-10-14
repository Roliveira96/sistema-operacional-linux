"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveSession, type LiveStroke } from "@/services/classroomService";
import { moduleService } from "@/services/moduleService";
import { AdmissionPanel } from "../AdmissionPanel/AdmissionPanel";
import { LiveInteractionDrawer } from "../LiveInteractionDrawer/LiveInteractionDrawer";
import { ModuleStage } from "../ModuleStage/ModuleStage";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import { StudentNotesPanel } from "../StudentNotesPanel/StudentNotesPanel";
import { TeacherSplitView } from "../TeacherSplitView/TeacherSplitView";
import { WaitingRoom } from "../WaitingRoom/WaitingRoom";
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

/**
 * The live classroom: the bar, the stage and the side of the hands and the notes. The student waits for the teacher to accept him; the teacher
 * has two screens, his own and the one of the class (SPEC-051, section 3.1; SPEC-054).
 */
export function LiveClassroom({ classId, role, userId, session }: LiveClassroomProps) {
  const router = useRouter();
  const live = useLiveClassroom({ classId, role });
  const [now, setNow] = useState(() => Date.now());
  const [joinedAt] = useState(() => Date.now());
  const [side, setSide] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);
  // The slide the teacher looks at on My screen; null means he follows the class (SPEC-054 CA-08).
  const [privateSlide, setPrivateSlide] = useState<number | null>(null);
  const [privateStrokes, setPrivateStrokes] = useState<LiveStroke[]>([]);
  const [modules, setModules] = useState<Array<{ id: string; title: string }>>([]);
  const [chosen, setChosen] = useState("");
  const [pickModule, setPickModule] = useState(false);
  const back = `/app/classes/${classId}`;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (role !== "teacher") return;
    let active = true;
    moduleService.listModules({ limit: 100 }).then(
      (result) => active && setModules(result.items),
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [role]);

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

  if (role === "student" && (live.admission === "WAITING" || live.admission === "REMOVED")) {
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

  const mode = live.room.mode;
  const room = live.room;
  const followsClass = privateSlide === null;
  const backToClass = () => {
    setPrivateSlide(null);
    setPrivateStrokes([]);
  };
  const showToClass = () => {
    if (privateSlide !== null) live.changeSlide(privateSlide);
    backToClass();
  };
  const switchToModule = () => {
    const id = chosen || room.moduleId;
    if (!id) {
      setPickModule(true);
      return;
    }
    setPickModule(false);
    live.switchMode("MODULE", id);
  };

  const slidesFor = (view: "mine" | "class" | "student") => {
    if (!room.deck) return <p className={styles.status}>{m.room.noDeck}</p>;
    const mine = view === "mine";
    const alone = mine && !followsClass; // a private slide: the class sees nothing of it
    return (
      <SlidePresenter
        deck={room.deck}
        slide={mine ? (privateSlide ?? room.slide) : room.slide}
        canControl={view !== "class" && live.canControl}
        cursor={alone ? null : room.cursor}
        strokes={alone ? privateStrokes : room.strokes}
        onSlide={mine ? (n) => setPrivateSlide(n === room.slide ? null : n) : live.changeSlide}
        onCursor={alone ? () => undefined : live.moveCursor}
        onDraw={alone ? (path) => setPrivateStrokes([...privateStrokes, { path }]) : live.draw}
        onClear={alone ? () => setPrivateStrokes([]) : live.clearDrawings}
      />
    );
  };
  const classModule = <ModuleStage classId={classId} role="student" moduleFocusBlockId={room.moduleFocusBlockId} terminal={live.terminal} />;

  const mineScreen = (
    <>
      <div className={styles.tools}>
        <select aria-label={m.split.moduleLabel} value={chosen} disabled={!live.canControl} onChange={(e) => setChosen(e.target.value)}>
          <option value="">{m.split.moduleChoose}</option>
          {modules.map((mod) => (
            <option key={mod.id} value={mod.id}>
              {mod.title}
            </option>
          ))}
        </select>
        <Button variant="secondary" size="sm" disabled={!live.canControl || !chosen} onClick={switchToModule}>
          {m.split.showModule}
        </Button>
        {mode === "MODULE" && (
          <Button
            variant={room.terminalBroadcast ? "primary" : "secondary"}
            size="sm"
            role="switch"
            aria-checked={room.terminalBroadcast}
            disabled={!live.canControl}
            onClick={() => live.setTerminalBroadcast(!room.terminalBroadcast)}
          >
            {m.split.broadcast}
          </Button>
        )}
      </div>
      {pickModule && (
        <p className={styles.error} role="alert">
          {m.room.pickModule}
        </p>
      )}
      {mode === "SLIDES" && !followsClass && (
        <div className={styles.tools}>
          <span className={styles.status}>{m.split.privateSlide}</span>
          <Button variant="primary" size="sm" onClick={showToClass}>
            {m.split.showToClass}
          </Button>
          <Button variant="ghost" size="sm" onClick={backToClass}>
            {m.split.followClass}
          </Button>
        </div>
      )}
      {mode === "SLIDES" ? (
        slidesFor("mine")
      ) : (
        <ModuleStage
          classId={classId}
          role="teacher"
          moduleFocusBlockId={room.moduleFocusBlockId}
          terminal={live.terminal}
          onFocusBlock={live.focusBlock}
          // The terminal of the teacher stays private until the broadcast is on (SPEC-054 CA-10).
          onInput={room.terminalBroadcast ? live.sendTerminalInput : undefined}
          onSync={room.terminalBroadcast ? live.sendTerminalSync : undefined}
        />
      )}
    </>
  );

  return (
    <main className={styles.room}>
      <header className={styles.bar}>
        <h1 className={styles.title}>{session.title}</h1>
        <span className={styles.meta} role="timer" aria-label={m.room.timer}>
          {elapsed(now - new Date(session.startedAt).getTime())}
        </span>
        <span className={styles.meta}>{m.room.online(room.online)}</span>

        {live.canControl ? (
          <div role="radiogroup" aria-label={m.room.modeLabel} className={styles.modes}>
            <Button
              variant={mode === "SLIDES" ? "primary" : "secondary"}
              size="sm"
              role="radio"
              aria-checked={mode === "SLIDES"}
              onClick={() => {
                setPickModule(false);
                live.switchMode("SLIDES");
              }}
            >
              {m.room.modeSlides}
            </Button>
            <Button variant={mode === "MODULE" ? "primary" : "secondary"} size="sm" role="radio" aria-checked={mode === "MODULE"} onClick={switchToModule}>
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
          {role === "teacher" ? (
            <TeacherSplitView mine={mineScreen} classScreen={mode === "SLIDES" ? slidesFor("class") : classModule} accepted={live.admissions.admitted.length} />
          ) : mode === "SLIDES" ? (
            slidesFor("student")
          ) : (
            classModule
          )}
        </div>

        {side && (
          <LiveInteractionDrawer role={role} userId={userId} hands={live.hands} onRaise={live.raiseHand} onLower={live.lowerHand} onModerate={live.moderate}>
            {role === "teacher" && (
              <AdmissionPanel
                waiting={live.admissions.waiting}
                admitted={live.admissions.admitted}
                onAccept={live.acceptStudent}
                onAcceptAll={live.acceptAll}
                onRemove={live.removeStudent}
              />
            )}
            {role === "student" && <StudentNotesPanel classId={classId} sessionId={session.id} />}
          </LiveInteractionDrawer>
        )}
      </div>
    </main>
  );
}

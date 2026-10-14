"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import type { LiveSession } from "@/services/classroomService";
import { FixedStage } from "../FixedStage/FixedStage";
import { stepZoom } from "../FixedStage/stage";
import { ModuleStage } from "../ModuleStage/ModuleStage";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import { WaitingScreen } from "../WaitingScreen/WaitingScreen";
import styles from "./PresenterStage.module.scss";

const m = messages.classroom;
const p = m.present;
const sf = m.studentsFullscreen;

/** How long the toolbar stays after the mouse stops, and how long the full-screen hint stays. */
const TOOLBAR_MS = 3000;
const HINT_MS = 5000;
/** How long the notice of an example that could not run stays. */
const NOTICE_MS = 5000;

const TIP_KEY = "live-presenter-tip";
const tipSeen = () => {
  try {
    return localStorage.getItem(TIP_KEY) === "seen";
  } catch {
    return false;
  }
};

export interface PresenterStageProps {
  classId: string;
  session: LiveSession;
}

/**
 * The presentation window of the teacher: only the stage, full of the screen, to be dragged to the projector. The laser, the pen and the picture
 * of the terminal screen go to the class at once, and the toolbar and the keys do what the teacher does most (SPEC-055 sections 3.1 and 3.3;
 * SPEC-056). The stage is the fixed box the students see, so the teacher sees exactly what they see, on the whole window; the scroll of the slide and
 * of the material, the divider, the zoom, the mouse and the text he selects go to them (SPEC-057).
 */
export function PresenterStage({ classId, session }: PresenterStageProps) {
  const live = useLiveClassroom({ classId, role: "teacher", view: "presenter" });
  const { room } = live;
  const [laser, setLaser] = useState(false);
  const [pen, setPen] = useState(false);
  const [toolbar, setToolbar] = useState(true);
  const [shortcuts, setShortcuts] = useState(false);
  const [tip, setTip] = useState(() => !tipSeen());
  const [fullscreenHint, setFullscreenHint] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showToolbar = () => {
    setToolbar(true);
    clearTimeout(hide.current);
    hide.current = setTimeout(() => setToolbar(false), TOOLBAR_MS);
  };
  useEffect(() => {
    hide.current = setTimeout(() => setToolbar(false), TOOLBAR_MS);
    return () => {
      clearTimeout(hide.current);
      clearTimeout(hintTimer.current);
      clearTimeout(noticeTimer.current);
    };
  }, []);

  const mode = room.mode;
  const total = room.deck?.pageCount ?? 0;
  const zoom = live.stageView.zoom;
  const studentsFullscreen = live.fullscreenRequested;
  const slides = mode === "SLIDES" && room.deck !== null;
  const startedAt = live.startedAt ?? session.startedAt;

  const goto = (slide: number) => {
    if (slide >= 1 && slide <= total && slide !== room.slide) live.changeSlide(slide);
  };
  // An example of the module that could not run: a short notice over the window of the teacher, outside the stage, so the students' screen is the same (SPEC-060).
  const runFailed = () => {
    setNotice(p.runFailed);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
  };
  const swapStage = () => {
    clearTimeout(noticeTimer.current);
    setNotice(null);
    if (mode === "SLIDES") {
      if (room.moduleId) live.switchMode("MODULE", room.moduleId);
      else setNotice(p.noModule);
    } else if (room.deck) live.switchMode("SLIDES");
    else setNotice(m.room.noDeck);
  };
  // The zoom is the teacher's; the students only follow it. A window that lost the control does not change it.
  const zoomTo = (next: number) => {
    if (live.canControl) live.sendStageZoom(next);
  };
  const zoomBy = (direction: 1 | -1) => zoomTo(stepZoom(zoom, direction));
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void document.documentElement.requestFullscreen?.();
    setFullscreenHint(true);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setFullscreenHint(false), HINT_MS);
  };
  const dismissTip = () => {
    setTip(false);
    try {
      localStorage.setItem(TIP_KEY, "seen");
    } catch {
      /* the tip just comes back next time */
    }
  };

  // The keys of the window; the latest state is read through a ref.
  const handle = useRef<(event: KeyboardEvent) => void>(() => undefined);
  useEffect(() => {
    handle.current = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      // What is typed in the terminal or in a field is not a shortcut.
      if (target && (target.closest(".term") || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      showToolbar();
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      if (key === "Escape") return setShortcuts(false);
      if (key === "?") return setShortcuts((open) => !open);
      if (key === "+" || key === "=") return zoomBy(1);
      if (key === "-") return zoomBy(-1);
      if (key === "0") return zoomTo(1);
      if (key === "m") return swapStage();
      if (key === "f") return toggleFullscreen();
      if (key === "b") return live.setBlank(!room.blank);
      if (key === "l" && (slides || mode === "MODULE")) return setLaser((on) => !on);
      if (!slides) return;
      if (key === "ArrowRight" || key === " ") {
        event.preventDefault();
        goto(room.slide + 1);
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        goto(room.slide - 1);
      } else if (key === "p") setPen((on) => !on);
      else if (key === "c") live.clearDrawings();
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handle.current(event);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  if (live.ended) {
    return (
      <main className={styles.stage}>
        <p className={styles.notice} role="status">
          {m.room.ended}
        </p>
        <Link href={`/app/classes/${classId}`} className={styles.link}>
          {m.room.backToClass}
        </Link>
      </main>
    );
  }

  return (
    <div className={styles.stage} data-testid="presenter-stage" onMouseMove={showToolbar}>
      <div className={styles.content}>
        <FixedStage zoom={zoom}>
          {mode === "SLIDES" ? (
            room.deck ? (
              <SlidePresenter
                bare
                deck={room.deck}
                slide={room.slide}
                canControl={live.canControl}
                cursor={room.cursor}
                strokes={room.strokes}
                laser={laser}
                pen={pen}
                scroll={live.stageView.slideScroll}
                scrollX={live.stageView.slideScrollX}
                onSlide={live.changeSlide}
                onCursor={live.moveCursor}
                onDraw={live.draw}
                onClear={live.clearDrawings}
                onScroll={(y, x) => live.sendStageScroll("slide", y, x)}
              />
            ) : (
              <p className={styles.notice}>{m.room.noDeck}</p>
            )
          ) : (
            <ModuleStage
              classId={classId}
              moduleId={room.moduleId}
              role="teacher"
              moduleFocusBlockId={room.moduleFocusBlockId}
              terminal={live.terminal}
              cursor={room.cursor}
              laser={laser}
              stageView={live.stageView}
              startedAt={startedAt}
              handCount={live.handCount}
              onFocusBlock={live.focusBlock}
              onScreen={live.sendTerminalScreen}
              onCursor={live.moveCursor}
              onMaterialScroll={(y) => live.sendStageScroll("material", y)}
              onSplit={live.sendStageSplit}
              onSelection={live.sendStageSelection}
              onTerminalScroll={live.sendTerminalScroll}
              onRunFailed={runFailed}
            />
          )}

          {/* The waiting screen the students have, the very same: what the teacher needs to know about it is outside the stage (SPEC-057 CA-22, SPEC-061). */}
          {room.blank && <WaitingScreen title={session.title} startedAt={startedAt} />}
        </FixedStage>
      </div>
      {room.blank && <p className={styles.notice}>{p.blankOn}</p>}

      {!live.connected && (
        <p className={styles.connection} role="status" aria-label={p.connection}>
          {p.connectionLost}
        </p>
      )}
      {live.passive && <p className={styles.notice}>{p.passive}</p>}
      {notice && (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}
      {fullscreenHint && <p className={styles.notice}>{p.fullscreenHint}</p>}

      {tip && (
        <div className={styles.tip} role="note" aria-label={p.tip}>
          <span>{p.tipText}</span>
          <Button variant="secondary" size="sm" onClick={dismissTip}>
            {p.tipOk}
          </Button>
        </div>
      )}

      {toolbar && (
        <div className={styles.toolbar} role="toolbar" aria-label={p.toolbar}>
          {slides && (
            <>
              <Button variant="secondary" size="sm" title={`${p.previous} (←)`} disabled={room.slide <= 1} onClick={() => goto(room.slide - 1)}>
                {p.previous}
              </Button>
              <Button variant="secondary" size="sm" title={`${p.next} (→)`} disabled={room.slide >= total} onClick={() => goto(room.slide + 1)}>
                {p.next}
              </Button>
            </>
          )}
          {(slides || mode === "MODULE") && (
            <Button variant={laser ? "primary" : "secondary"} size="sm" aria-pressed={laser} title={`${p.laser} (L)`} onClick={() => setLaser(!laser)}>
              {p.laser}
            </Button>
          )}
          {slides && (
            <>
              <Button variant={pen ? "primary" : "secondary"} size="sm" aria-pressed={pen} title={`${p.pen} (P)`} onClick={() => setPen(!pen)}>
                {p.pen}
              </Button>
              <Button variant="ghost" size="sm" title={`${p.clear} (C)`} onClick={live.clearDrawings}>
                {p.clear}
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" title={`${p.zoomOut} (-)`} disabled={!live.canControl || zoom <= 1} onClick={() => zoomBy(-1)}>
            {p.zoomOut}
          </Button>
          <Button variant="ghost" size="sm" title={`${p.zoomReset} (0)`} disabled={!live.canControl} onClick={() => zoomTo(1)}>
            {p.zoomValue(zoom)}
          </Button>
          <Button variant="secondary" size="sm" title={`${p.zoomIn} (+)`} disabled={!live.canControl || zoom >= 2} onClick={() => zoomBy(1)}>
            {p.zoomIn}
          </Button>
          <Button variant="secondary" size="sm" title={`${mode === "SLIDES" ? p.toModule : p.toSlides} (M)`} onClick={swapStage}>
            {mode === "SLIDES" ? p.toModule : p.toSlides}
          </Button>
          <Button variant="secondary" size="sm" title={`${p.fullscreen} (F)`} onClick={toggleFullscreen}>
            {p.fullscreen}
          </Button>
          {/* The request that puts the students in full screen (SPEC-059): the state is the room's, so this window and the panel always agree. */}
          <Button
            variant={studentsFullscreen ? "primary" : "secondary"}
            size="sm"
            aria-pressed={studentsFullscreen}
            title={`${sf.label}: ${sf.hint}`}
            disabled={!live.canControl}
            onClick={() => live.sendStageFullscreen(!studentsFullscreen)}
          >
            {sf.label}
          </Button>
          <span className={styles.state}>{studentsFullscreen ? sf.on : sf.off}</span>
          <Button variant={room.blank ? "primary" : "secondary"} size="sm" title={`${p.blank} (B)`} onClick={() => live.setBlank(!room.blank)}>
            {p.blank}
          </Button>
          <Button variant="ghost" size="sm" title={`${p.shortcuts} (?)`} onClick={() => setShortcuts(true)}>
            {p.shortcuts}
          </Button>
        </div>
      )}

      {shortcuts && (
        <div className={styles.dialog} role="dialog" aria-label={p.shortcutsTitle}>
          <h2 className={styles.dialogTitle}>{p.shortcutsTitle}</h2>
          <ul className={styles.keys}>
            {p.keys.map(([key, what]) => (
              <li key={key}>
                <kbd>{key}</kbd> {what}
              </li>
            ))}
          </ul>
          <Button variant="primary" size="sm" onClick={() => setShortcuts(false)}>
            {p.close}
          </Button>
        </div>
      )}
    </div>
  );
}

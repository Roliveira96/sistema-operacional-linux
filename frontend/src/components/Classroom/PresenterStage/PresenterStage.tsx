"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { useLiveClassroom } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import type { LiveSession } from "@/services/classroomService";
import { ModuleStage } from "../ModuleStage/ModuleStage";
import { SlidePresenter } from "../SlidePresenter/SlidePresenter";
import styles from "./PresenterStage.module.scss";

const m = messages.classroom;
const p = m.present;

/** How long the toolbar stays after the mouse stops, and how long the full-screen hint stays. */
const TOOLBAR_MS = 3000;
const HINT_MS = 5000;

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
 * The presentation window of the teacher: only the stage, full of the screen, to be dragged to the projector. The laser, the pen, the typing
 * and the commands go to the class at once, and the toolbar and the keys do what the teacher does most (SPEC-055 sections 3.1 and 3.3).
 */
export function PresenterStage({ classId }: PresenterStageProps) {
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
    };
  }, []);

  const mode = room.mode;
  const total = room.deck?.pageCount ?? 0;
  const slides = mode === "SLIDES" && room.deck !== null;

  const goto = (slide: number) => {
    if (slide >= 1 && slide <= total && slide !== room.slide) live.changeSlide(slide);
  };
  const swapStage = () => {
    setNotice(null);
    if (mode === "SLIDES") {
      if (room.moduleId) live.switchMode("MODULE", room.moduleId);
      else setNotice(p.noModule);
    } else if (room.deck) live.switchMode("SLIDES");
    else setNotice(m.room.noDeck);
  };
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
      if (key === "m") return swapStage();
      if (key === "f") return toggleFullscreen();
      if (key === "b") return live.setBlank(!room.blank);
      if (!slides) return;
      if (key === "ArrowRight" || key === " ") {
        event.preventDefault();
        goto(room.slide + 1);
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        goto(room.slide - 1);
      } else if (key === "l") setLaser((on) => !on);
      else if (key === "p") setPen((on) => !on);
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
            role="teacher"
            moduleFocusBlockId={room.moduleFocusBlockId}
            terminal={live.terminal}
            onFocusBlock={live.focusBlock}
            onInput={live.sendTerminalInput}
            onSync={live.sendTerminalSync}
          />
        )}
      </div>

      {room.blank && (
        <div className={styles.blank} role="status" aria-label={p.blank}>
          <p className={styles.blankNotice}>{p.blankOn}</p>
        </div>
      )}

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
              <Button variant={laser ? "primary" : "secondary"} size="sm" aria-pressed={laser} title={`${p.laser} (L)`} onClick={() => setLaser(!laser)}>
                {p.laser}
              </Button>
              <Button variant={pen ? "primary" : "secondary"} size="sm" aria-pressed={pen} title={`${p.pen} (P)`} onClick={() => setPen(!pen)}>
                {p.pen}
              </Button>
              <Button variant="ghost" size="sm" title={`${p.clear} (C)`} onClick={live.clearDrawings}>
                {p.clear}
              </Button>
            </>
          )}
          <Button variant="secondary" size="sm" title={`${mode === "SLIDES" ? p.toModule : p.toSlides} (M)`} onClick={swapStage}>
            {mode === "SLIDES" ? p.toModule : p.toSlides}
          </Button>
          <Button variant="secondary" size="sm" title={`${p.fullscreen} (F)`} onClick={toggleFullscreen}>
            {p.fullscreen}
          </Button>
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

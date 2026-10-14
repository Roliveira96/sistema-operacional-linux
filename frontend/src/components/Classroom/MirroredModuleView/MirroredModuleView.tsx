"use client";

import { useEffect, useRef, useState } from "react";
import { mountTerminalWindow } from "@/engine/terminalWindow";
import type { ScreenElement, ScreenLocator } from "@/engine/terminalScreen";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import type { StageSelection } from "@/services/classroomService";
import { TerminalMirror } from "../TerminalMirror/TerminalMirror";
import styles from "./MirroredModuleView.module.scss";

const m = messages.classroom.terminal;

export interface MirroredModuleViewProps {
  role: "teacher" | "student";
  /** The picture of the teacher's terminal window, as the room tells it (the student's copy draws it). */
  terminal: LiveTerminal;
  /** The machine the terminal starts on, the one of the module (SPEC-054 CA-11); the default machine when not given. */
  initialState?: unknown;
  /** The teacher's terminal tells the picture of its whole window, at every change. */
  onScreen?(tree: ScreenElement): void;
  /** The teacher's terminal tells, with each picture, how to find a point of its window in the text of that picture (SPEC-057 CA-20). */
  onLocator?(locator: ScreenLocator): void;
  /** The text the teacher selected: the student's copy marks it when it is in the terminal (SPEC-057 CA-20, CA-21). */
  selection?: StageSelection | null;
  /** The teacher scrolls the history of a terminal (from 1): the number of the terminal and the place as a fraction of what can be scrolled; 1 is the end. */
  onTerminalScroll?(terminal: number, y: number): void;
  /** Where the teacher has the history of each terminal, which the student's copy follows (SPEC-057 CA-23). */
  terminalScroll?: Record<string, number>;
}

/** The real terminal of the teacher: it runs the commands and tells the class what its window looks like. */
function TeacherTerminal({ initialState, onScreen, onLocator, onTerminalScroll }: Pick<MirroredModuleViewProps, "initialState" | "onScreen" | "onLocator" | "onTerminalScroll">) {
  const host = useRef<HTMLDivElement>(null);
  // Read once, when the terminal is mounted: a new module mounts a new view.
  const startOn = useRef(initialState);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  const tell = useRef(onScreen);
  const locate = useRef(onLocator);
  const scrolled = useRef(onTerminalScroll);
  useEffect(() => {
    tell.current = onScreen;
    locate.current = onLocator;
    scrolled.current = onTerminalScroll;
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Each mount gets its own element, so the first mount of React Strict Mode does not wipe the second.
    const container = document.createElement("div");
    container.className = styles.host ?? "";
    parent.appendChild(container);
    // The scroll of a screen of the terminal does not bubble, so it is heard at the capture. It tells the number of the terminal and the place, which is the
    // end when the teacher is at the end (give or take a pixel) or when there is nothing to scroll.
    const heard = (event: Event) => {
      const screen = event.target instanceof Element ? event.target.closest<HTMLElement>(".term-tela") : null;
      const number = screen ? Array.from(container.querySelectorAll(".term")).indexOf(screen.closest(".term") as Element) + 1 : 0;
      if (!screen || number < 1) return;
      const range = screen.scrollHeight - screen.clientHeight;
      scrolled.current?.(number, range > 1 && range - screen.scrollTop > 1 ? Math.max(0, screen.scrollTop / range) : 1);
    };
    container.addEventListener("scroll", heard, true);
    let cancelled = false;
    let win: Awaited<ReturnType<typeof mountTerminalWindow>> | null = null;
    mountTerminalWindow(container, startOn.current ?? null, {
      onCommand: () => undefined,
      onScreen: (tree, locator) => {
        tell.current?.(tree);
        locate.current?.(locator);
      },
    })
      .then((created) => {
        if (cancelled) return created.destroy();
        win = created;
        setOpened(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      container.removeEventListener("scroll", heard, true);
      win?.destroy();
      container.remove();
      setOpened(false);
    };
  }, []);

  return (
    <section className={styles.view}>
      <div ref={host} className={styles.window} />
      {!opened && !failed && (
        <p className={styles.note} role="status">
          {m.loading}
        </p>
      )}
      {failed && (
        <p className={styles.error} role="alert">
          {m.error}
        </p>
      )}
    </section>
  );
}

/**
 * The terminal of the module in the live classroom (SPEC-056). The teacher's is the real one and tells the picture of its window; the student's is a
 * read-only copy that draws that picture and never mounts the terminal engine, so it cannot run anything.
 */
export function MirroredModuleView({ role, terminal, initialState, onScreen, onLocator, selection, onTerminalScroll, terminalScroll }: MirroredModuleViewProps) {
  return role === "student" ? (
    <TerminalMirror screen={terminal.screen} selection={selection} scroll={terminalScroll} />
  ) : (
    <TeacherTerminal initialState={initialState} onScreen={onScreen} onLocator={onLocator} onTerminalScroll={onTerminalScroll} />
  );
}

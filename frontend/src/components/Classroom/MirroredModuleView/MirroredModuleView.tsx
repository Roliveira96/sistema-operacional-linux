"use client";

import { useEffect, useRef, useState } from "react";
import { mountTerminalWindow } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
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
}

/** The real terminal of the teacher: it runs the commands and tells the class what its window looks like. */
function TeacherTerminal({ initialState, onScreen }: Pick<MirroredModuleViewProps, "initialState" | "onScreen">) {
  const host = useRef<HTMLDivElement>(null);
  // Read once, when the terminal is mounted: a new module mounts a new view.
  const startOn = useRef(initialState);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  const tell = useRef(onScreen);
  useEffect(() => {
    tell.current = onScreen;
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Each mount gets its own element, so the first mount of React Strict Mode does not wipe the second.
    const container = document.createElement("div");
    container.className = styles.host ?? "";
    parent.appendChild(container);
    let cancelled = false;
    let win: Awaited<ReturnType<typeof mountTerminalWindow>> | null = null;
    mountTerminalWindow(container, startOn.current ?? null, { onCommand: () => undefined, onScreen: (tree) => tell.current?.(tree) })
      .then((created) => {
        if (cancelled) return created.destroy();
        win = created;
        setOpened(true);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      win?.destroy();
      container.remove();
      setOpened(false);
    };
  }, []);

  return (
    <section className={styles.view}>
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
      <div ref={host} className={styles.window} />
    </section>
  );
}

/**
 * The terminal of the module in the live classroom (SPEC-056). The teacher's is the real one and tells the picture of its window; the student's is a
 * read-only copy that draws that picture and never mounts the terminal engine, so it cannot run anything.
 */
export function MirroredModuleView({ role, terminal, initialState, onScreen }: MirroredModuleViewProps) {
  return role === "student" ? <TerminalMirror screen={terminal.screen} /> : <TeacherTerminal initialState={initialState} onScreen={onScreen} />;
}

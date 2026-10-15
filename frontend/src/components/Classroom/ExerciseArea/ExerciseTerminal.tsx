"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { ScreenElement } from "@/engine/terminalScreen";
import { mountTerminalWindow } from "@/engine/terminalWindow";
import type { SetupLayer } from "@/lib/setup";
import { runLayers } from "@/lib/setupRunner";
import { messages } from "@/messages/pt-BR";
import styles from "./ExerciseTerminal.module.scss";

const m = messages.classroom.exerciseArea;

export interface ExerciseTerminalProps {
  /** The machine the window opens on, read once: the one kept in the browser or the scenario of the module. */
  initialState: unknown;
  /** What prepares the machine after the window opens, read once. */
  layers: SetupLayer[];
  /** Whether the layers run: not when the machine came back from the browser. */
  prepare: boolean;
  /** The exercise is done: the keys and the paste stop at the window. */
  readOnly: boolean;
  /** Tells the machine as the window has it (with its processes) and the last command the student typed, once it is ready and after every command. */
  onChange(snapshot: unknown, last: string): void;
  /** Tells the picture of the whole window, at every change. */
  onScreen(tree: ScreenElement): void;
}

/** Tab is left alone so the student can always leave the terminal with the keyboard. */
const stop = (event: KeyboardEvent | ClipboardEvent) => {
  if ("key" in event && event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
};

/**
 * The student's own terminal for the exercise: the real window of the engine, on its own machine, which nobody else sees or changes (SPEC-065 CA-02).
 * It opens on the machine it is given and, unless the machine came back from the browser, prepares it with the snapshots of the exercise before it
 * says it is ready; the commands of that preparation tell nothing. After that it tells the machine at every command. The picture of the window goes
 * to `onScreen` from the start, for the teacher who watches the student.
 */
export function ExerciseTerminal({ initialState, layers, prepare, readOnly, onChange, onScreen }: ExerciseTerminalProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const start = useRef({ initialState, layers, prepare });
  const callbacks = useRef({ onChange, onScreen });
  useEffect(() => {
    callbacks.current = { onChange, onScreen };
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
    // The commands of the preparation are not the student's: nothing is told until it is over, and the history it left is not his.
    let preparing = true;
    let before = 0;
    const tell = () => {
      if (win && !preparing) callbacks.current.onChange(win.snapshot(), win.history().slice(before).at(-1) ?? "");
    };
    mountTerminalWindow(container, start.current.initialState, { onCommand: tell, onScreen: (tree) => callbacks.current.onScreen(tree) })
      .then(async (created) => {
        if (cancelled) return created.destroy();
        win = created;
        if (start.current.prepare && start.current.layers.length > 0) await runLayers(created, start.current.layers, { restoreSpeed: 1, shouldStop: () => cancelled });
        if (cancelled) return;
        before = created.history().length;
        preparing = false;
        setState("ready");
        tell();
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
      win?.destroy();
      container.remove();
    };
  }, []);

  return (
    <section className={styles.view} aria-label={m.terminal}>
      <div ref={host} className={styles.window} onKeyDownCapture={readOnly ? stop : undefined} onPasteCapture={readOnly ? stop : undefined} />
      {state === "loading" && (
        <p className={styles.note} role="status">
          {m.terminalLoading}
        </p>
      )}
      {state === "error" && (
        <p className={styles.error} role="alert">
          {m.terminalError}
        </p>
      )}
    </section>
  );
}

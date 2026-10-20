"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { TakeoverKey } from "@/hooks/useLiveClassroom";
import { isRemoteKey, remoteKeyboard } from "@/engine/remoteKeys";
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
  /** The exercise is done, paused or over: the keys and the paste stop at the window, also the teacher's. */
  readOnly: boolean;
  /** The teacher has the terminal (SPEC-071 RN-05): the keys and the paste of the student stop at the window, and the teacher's go in. */
  takenOver?: boolean;
  /** Where the keys of the teacher come from. */
  onTakeoverKey?(listener: (key: TakeoverKey) => void): () => void;
  /**
   * Tells the machine as the window has it (with its processes), the last command the student typed and how many commands he ran (SPEC-071 RN-09), once
   * it is ready and after every command.
   */
  onChange(snapshot: unknown, last: string, commands: number): void;
  /** Tells the picture of the whole window, at every change. */
  onScreen(tree: ScreenElement): void;
}

/** Tab is left alone so the student can always leave the terminal with the keyboard. */
const stop = (event: KeyboardEvent | ClipboardEvent) => {
  if ("key" in event && event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
};

/** While the teacher has the terminal, only his keys go in: the ones the adapter made (SPEC-071 RN-05). */
const onlyTheTeachers = (event: KeyboardEvent | ClipboardEvent) => {
  if (!isRemoteKey(event.nativeEvent)) stop(event);
};

/**
 * The student's own terminal for the exercise: the real window of the engine, on its own machine, which nobody else sees or changes (SPEC-065 CA-02).
 * It opens on the machine it is given and, unless the machine came back from the browser, prepares it with the snapshots of the exercise before it
 * says it is ready; the commands of that preparation tell nothing. After that it tells the machine at every command. The picture of the window goes
 * to `onScreen` from the start, for the teacher who watches the student.
 */
export function ExerciseTerminal({ initialState, layers, prepare, readOnly, takenOver = false, onTakeoverKey, onChange, onScreen }: ExerciseTerminalProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const opened = useRef<{ container: HTMLElement; running(): boolean } | null>(null);
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
      if (!win || preparing) return;
      const own = win.history().slice(before);
      callbacks.current.onChange(win.snapshot(), own.at(-1) ?? "", own.length);
    };
    mountTerminalWindow(container, start.current.initialState, { onCommand: tell, onScreen: (tree) => callbacks.current.onScreen(tree) })
      .then(async (created) => {
        if (cancelled) return created.destroy();
        win = created;
        if (start.current.prepare && start.current.layers.length > 0) await runLayers(created, start.current.layers, { restoreSpeed: 1, shouldStop: () => cancelled });
        if (cancelled) return;
        before = created.history().length;
        preparing = false;
        opened.current = { container, running: () => created.isRunning?.() ?? false };
        setState("ready");
        tell();
      })
      .catch(() => !cancelled && setState("error"));
    return () => {
      cancelled = true;
      opened.current = null;
      win?.destroy();
      container.remove();
    };
  }, []);

  // The keys of the teacher, in the order they come, while he has the terminal and nothing locks it.
  const remote = takenOver && !readOnly && state === "ready";
  useEffect(() => {
    const term = opened.current;
    if (!remote || !term || !onTakeoverKey) return;
    const keyboard = remoteKeyboard(term.container, term.running);
    const stopListening = onTakeoverKey((key) => ("paste" in key ? keyboard.paste(key.paste) : keyboard.key(key)));
    return () => {
      stopListening();
      keyboard.stop();
    };
  }, [remote, onTakeoverKey]);
  const guard = readOnly ? stop : takenOver ? onlyTheTeachers : undefined;

  return (
    <section className={styles.view} aria-label={m.terminal}>
      <div ref={host} className={styles.window} onKeyDownCapture={guard} onPasteCapture={guard} />
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

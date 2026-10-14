"use client";

import { useEffect, useRef, useState } from "react";
import {
  mountTerminalWindow,
  type TerminalCommandEvent,
  type TerminalInputEvent,
  type TerminalWindow,
} from "@/engine/terminalWindow";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import styles from "./MirroredModuleView.module.scss";

const m = messages.classroom.terminal;

export interface MirroredModuleViewProps {
  role: "teacher" | "student";
  /** What the teacher is doing at the terminal, as the room tells it. */
  terminal: LiveTerminal;
  /** The teacher's terminal reports what he types, and what he runs. */
  onInput?(event: TerminalInputEvent): void;
  onSync?(event: TerminalCommandEvent): void;
}

const sameCommand = (a: TerminalCommandEvent, b: TerminalCommandEvent) => a.terminal === b.terminal && a.line === b.line && a.output === b.output && a.cwd === b.cwd;

/**
 * The terminal of the module in the live classroom (SPEC-051, section 3.1). The teacher's is the real one and reports what happens. The
 * student's is a read-only copy: it shows the teacher typing, prints each command with its output and applies the machine, and never runs
 * anything by itself.
 */
export function MirroredModuleView({ role, terminal, onInput, onSync }: MirroredModuleViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [win, setWin] = useState<TerminalWindow | null>(null);
  const [failed, setFailed] = useState(false);
  const callbacks = useRef({ onInput, onSync });
  useEffect(() => {
    callbacks.current = { onInput, onSync };
  });

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Each mount gets its own element, so the first mount of React Strict Mode does not wipe the second.
    const container = document.createElement("div");
    parent.appendChild(container);
    let cancelled = false;
    let opened: TerminalWindow | null = null;
    const teacher = role === "teacher";
    mountTerminalWindow(
      container,
      null,
      teacher
        ? {
            onCommand: () => undefined,
            onInput: (event) => callbacks.current.onInput?.(event),
            onCommandDone: (event) => callbacks.current.onSync?.(event),
          }
        : { onCommand: () => undefined },
    )
      .then((created) => {
        if (cancelled) return created.destroy();
        opened = created;
        if (!teacher) created.setReadOnly(true);
        setWin(created);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      opened?.destroy();
      container.remove();
      setWin(null);
    };
  }, [role]);

  // The student's copy: the commands and the machine first, in order, then what is being typed.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastApplied = useRef<TerminalCommandEvent | null>(null);
  useEffect(() => {
    if (role !== "student" || !win) return;
    const entries = terminal.entries;
    let from = 0;
    if (lastApplied.current) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (sameCommand(entries[i]!, lastApplied.current)) {
          from = i + 1;
          break;
        }
      }
    }
    const fresh = entries.slice(from);
    const last = fresh.at(-1);
    if (last) lastApplied.current = last;
    queue.current = queue.current.then(async () => {
      for (const entry of fresh) await win.printScreen(entry.terminal, entry.segments);
      if (last) await win.syncMachine(last.state, { terminal: last.terminal, cwd: last.cwd });
      if (terminal.input) await win.showInput(terminal.input.terminal, terminal.input.line);
    });
  }, [role, win, terminal]);

  return (
    <section className={styles.view}>
      {role === "student" && <p className={styles.note}>{m.readOnly}</p>}
      {!win && !failed && (
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

"use client";

import { useEffect, useRef, useState } from "react";
import { mountTerminalWindow, type TerminalWindow } from "@/engine/terminalWindow";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./TerminalPane.module.scss";

const m = contentMessages.topic.terminal;

export interface TerminalPaneProps {
  /** Machine to start on (saved or topic scenario); null for the default machine. */
  snapshot: unknown;
  onReady(window: TerminalWindow): void;
  onCommand(snapshot: unknown): void;
}

/** Mounts the terminal window of the prototype and its footer (SPEC-016). */
export function TerminalPane({ snapshot, onReady, onCommand }: TerminalPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const callbacks = useRef({ onReady, onCommand });
  useEffect(() => {
    callbacks.current = { onReady, onCommand };
  });
  // The machine is read once, when the window mounts.
  const initial = useRef(snapshot);

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Each mount gets its own element: under React Strict Mode the effect runs
    // twice, and the first (cancelled) mount must not wipe the second one.
    const container = document.createElement("div");
    container.className = styles.window ?? "";
    parent.appendChild(container);
    let cancelled = false;
    mountTerminalWindow(container, initial.current, { onCommand: (snapshot) => callbacks.current.onCommand(snapshot) })
      .then((terminal) => {
        if (cancelled) {
          terminal.destroy();
          return;
        }
        cleanup = () => terminal.destroy();
        setState("ready");
        callbacks.current.onReady(terminal);
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    let cleanup = () => {};
    return () => {
      cancelled = true;
      cleanup();
      container.remove();
    };
  }, []);

  return (
    <section className={styles.pane}>
      {state === "loading" && (
        <p className={styles.status} role="status">
          {m.loading}
        </p>
      )}
      {state === "error" && (
        <p className={styles.status} role="alert">
          {m.failed}
        </p>
      )}
      <div ref={host} className={styles.host} />
      <p className={styles.footer}>
        {m.footer[0]}
        <b>{m.footer[1]}</b>
        {m.footer[2]}
        <code>{m.footer[3]}</code>
        {m.footer[4]}
        <b>{m.footer[5]}</b>
        {m.footer[6]}
        <code>{m.footer[7]}</code>
        {m.shortcuts.map(([key, text]) => (
          <span key={key}>
            {" · "}
            <kbd>{key}</kbd> {text}
          </span>
        ))}
      </p>
    </section>
  );
}

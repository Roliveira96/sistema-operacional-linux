"use client";

import { useEffect, useRef, useState } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { Button } from "@/components/Button/Button";
import { mountTerminalWindow, type CommandRun, type TerminalState, type TerminalWindow } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import styles from "./ExamTerminal.module.scss";

const term = contentMessages.topic.terminal;
const actions = contentMessages.topic.actions;
const s = messages.assessments.simulator.terminal;

export interface ExamTerminalProps {
  /** The question of command Linux that is open, or null when the open one does not use the terminal: then it stays in view, locked. */
  questionId: string | null;
  /** Reads the machine a question starts from; null is the default machine. */
  loadScenario: (questionId: string) => Promise<unknown>;
  /** A command ran in the machine of the question that is open; the exam checks the machine (SPEC-085). */
  onCommand?: (questionId: string, snapshot: unknown) => void;
  /** The machine of the question was formatted and is back where the question starts. */
  onFormat?: (questionId: string) => void;
  /** The machines saved of an attempt the student comes back to: a question starts from it, and Reset Máquina still goes to the scenario (SPEC-090). */
  resume?: Record<string, unknown>;
  /** Each command that ran in the question that is open, with its line and its output, for the room of the exam (SPEC-091 RN-06). */
  onCommandRun?: (questionId: string, run: CommandRun) => void;
  /** The picture of the window at each change, for the teacher who watches (SPEC-091 RN-05). */
  onScreen?: (questionId: string, tree: ScreenElement) => void;
  /** The line typed without Enter, as the student types, for the copy in the browser (SPEC-090 revision 2). */
  onTyped?: (questionId: string, line: string) => void;
}

/** The terminal that goes with a machine of the exam (SPEC-090 revision 2). */
const terminalOf = (snapshot: unknown) => (snapshot as { terminal?: Partial<TerminalState> } | null)?.terminal;

/**
 * The terminal of the exam (SPEC-084): one window for the whole exam, with the machine of the question that is open. A question gets its machine the
 * first time it opens, and gets back what the student left in it when the student returns; Reset Máquina formats only the machine of the open question.
 * It has nothing of the study of a module: no pasting of commands, sound, narration, saving or loading of machines, or panel of processes (D-04).
 */
export function ExamTerminal({ questionId, loadScenario, onCommand, onFormat, resume, onCommandRun, onScreen, onTyped }: ExamTerminalProps) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<TerminalWindow | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  /** What the student left in each question, and how each one started. */
  const machines = useRef(new Map<string, unknown>());
  const scenarios = useRef(new Map<string, unknown>());
  const open = useRef<string | null>(questionId);
  const read = useRef(loadScenario);
  const tell = useRef({ onCommand, onFormat, onCommandRun, onScreen, onTyped });
  const typed = useRef("");
  const saved = useRef(resume);
  /** True while the exam itself puts a machine in the window: the engine tells about it as about a command, and it is not one (SPEC-085 CA-05). */
  const quiet = useRef(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    read.current = loadScenario;
    tell.current = { onCommand, onFormat, onCommandRun, onScreen, onTyped };
  });

  // The window opens once and goes away with the exam; the commands keep the machine of the open question up to date.
  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    // Each mount gets its own element, as the study screen does: under React Strict Mode the first (cancelled) mount must not wipe the second one.
    const container = document.createElement("div");
    container.className = styles.window ?? "";
    parent.appendChild(container);
    let cancelled = false;
    let cleanup = () => {};
    mountTerminalWindow(container, null, {
      onCommand: (snapshot) => {
        // the exam itself put this machine, and already keeps it with its terminal
        if (!open.current || quiet.current) return;
        const state = terminal.current?.terminalState();
        const full = state ? { ...(snapshot as object), terminal: state } : snapshot;
        machines.current.set(open.current, full);
        tell.current.onCommand?.(open.current, full);
      },
      onCommandRun: (run) => {
        if (open.current && !quiet.current) tell.current.onCommandRun?.(open.current, run);
      },
      onScreen: (tree) => {
        if (open.current) tell.current.onScreen?.(open.current, tree);
      },
    }).then(
      (mounted) => {
        if (cancelled) {
          mounted.destroy();
          return;
        }
        terminal.current = mounted;
        cleanup = () => mounted.destroy();
        setState("ready");
      },
      () => {
        if (!cancelled) setState("error");
      },
    );
    return () => {
      cancelled = true;
      cleanup();
      terminal.current = null;
      container.remove();
    };
  }, []);

  /** Puts a machine in the window without it counting as a command. */
  const put = (machine: TerminalWindow, snapshot: unknown) => {
    quiet.current = true;
    try {
      machine.reset(snapshot);
      const state = terminalOf(snapshot);
      if (state) machine.restoreTerminal(state);
    } finally {
      quiet.current = false;
    }
  };

  // The machine follows the question that is open.
  useEffect(() => {
    open.current = questionId;
    const machine = terminal.current;
    if (state !== "ready" || !machine || !questionId) return;
    if (machines.current.has(questionId)) {
      put(machine, machines.current.get(questionId));
      return;
    }
    let alive = true;
    read.current(questionId).then(
      (snapshot) => {
        if (!alive) return;
        const start = snapshot ?? null;
        scenarios.current.set(questionId, start);
        const begin = saved.current && questionId in saved.current ? saved.current[questionId] : start;
        machines.current.set(questionId, begin);
        setFailed(null);
        put(machine, begin);
      },
      () => alive && setFailed(questionId),
    );
    return () => {
      alive = false;
    };
  }, [questionId, state, attempt]);

  /** Formats the machine of the open question and puts it back where the question starts (D-01). */
  const format = async () => {
    setConfirming(false);
    const id = open.current;
    const machine = terminal.current;
    if (!id || !machine) return;
    const start = scenarios.current.get(id) ?? null;
    // the machine is wiped as the format begins: the question is no longer solved from then on, and what the engine says while it formats is not a command
    tell.current.onFormat?.(id);
    quiet.current = true;
    try {
      await machine.resetAnimated(start);
    } finally {
      quiet.current = false;
    }
    machines.current.set(id, start);
  };

  /** After the key is handled, tells the line typed when it changed. */
  const typing = () =>
    setTimeout(() => {
      const id = open.current;
      const line = terminal.current?.typedLine() ?? "";
      const said = `${id}\n${line}`;
      if (!id || said === typed.current) return;
      typed.current = said;
      tell.current.onTyped?.(id, line);
    }, 0);

  return (
    <section className={styles.pane} aria-label={s.title} onKeyDown={typing} onPaste={typing}>
      <div className={styles.bar}>
        <span className={styles.title}>{s.title}</span>
        <Button variant="secondary" title={actions.resetTitle} disabled={!questionId || state !== "ready"} onClick={() => setConfirming(true)}>
          {actions.reset}
        </Button>
      </div>
      {state === "loading" && (
        <p className={styles.status} role="status">
          {term.loading}
        </p>
      )}
      {state === "error" && (
        <p className={styles.status} role="alert">
          {term.failed}
        </p>
      )}
      {failed !== null && failed === questionId && (
        <div className={styles.problem} role="alert">
          <span>{s.scenarioFailed}</span>
          <Button
            variant="secondary"
            onClick={() => {
              setFailed(null);
              setAttempt((n) => n + 1);
            }}
          >
            {messages.assessments.retry}
          </Button>
        </div>
      )}
      <div className={styles.stage}>
        <div className={styles.dim} inert={!questionId}>
          <div ref={host} className={styles.host} />
        </div>
        {!questionId && (
          <p className={styles.locked} role="status">
            {s.locked}
          </p>
        )}
      </div>
      <p className={styles.footer}>
        {term.footer[0]}
        <b>{term.footer[1]}</b>
        {term.footer[2]}
        <code>{term.footer[3]}</code>
        {term.footer[4]}
        <b>{term.footer[5]}</b>
        {term.footer[6]}
        <code>{term.footer[7]}</code>
        {term.shortcuts.map(([key, text]) => (
          <span key={key}>
            {" · "}
            <kbd>{key}</kbd> {text}
          </span>
        ))}
      </p>
      {confirming && (
        <AssessmentDialog title={s.confirmTitle} onClose={() => setConfirming(false)}>
          <p>{actions.resetConfirm}</p>
          <div className={dialog.actions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {s.keep}
            </Button>
            <Button variant="danger" onClick={() => void format()}>
              {s.confirm}
            </Button>
          </div>
        </AssessmentDialog>
      )}
    </section>
  );
}

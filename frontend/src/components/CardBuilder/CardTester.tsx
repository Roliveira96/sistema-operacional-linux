"use client";

import { useEffect, useRef, useState } from "react";
import { TerminalPane } from "@/components/TopicStudy/TerminalPane";
import type { TerminalWindow } from "@/engine/terminalWindow";
import type { CardCommand } from "@/lib/cardModel";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./CardBuilder.module.scss";

const m = authoringMessages.builder.tester;

/** How one command of the test turned out (SPEC-020 RN-08). */
export type Verdict =
  | { kind: "ok" }
  | { kind: "okError" }
  | { kind: "unexpectedError"; code: number }
  | { kind: "expectedErrorMissing" }
  | { kind: "notRun" }
  | { kind: "stopped" }
  | { kind: "empty" };

type Result = { state: "pending" } | { state: "running" } | { state: "done"; verdict: Verdict };

const isGood = (v: Verdict) => v.kind === "ok" || v.kind === "okError";

/** Compares the exit status of a command with what the author expects of it. */
export function judge(status: number | null, expectError: boolean): Verdict {
  if (status === null) return { kind: "notRun" };
  if (status === 0) return expectError ? { kind: "expectedErrorMissing" } : { kind: "ok" };
  return expectError ? { kind: "okError" } : { kind: "unexpectedError", code: status };
}

function verdictText(v: Verdict): string {
  switch (v.kind) {
    case "ok":
      return m.ok;
    case "okError":
      return m.okError;
    case "unexpectedError":
      return m.unexpectedError(v.code);
    case "expectedErrorMissing":
      return m.expectedErrorMissing;
    case "notRun":
      return m.notRun;
    case "stopped":
      return m.stopped;
    default:
      return m.empty;
  }
}

interface CardTesterProps {
  /** The commands as they are on the screen, saved or not. */
  commands: CardCommand[];
  /** The machine the test starts from: the one the student will have at this card. */
  loadBase: () => Promise<unknown>;
  onClose: () => void;
}

/**
 * Runs every command of the card in the terminal of the application, in order, and shows whether
 * each ended as expected (SPEC-020). It works on a throwaway machine: nothing is saved.
 */
export function CardTester({ commands, loadBase, onClose }: CardTesterProps) {
  const [base, setBase] = useState<{ machine: unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [terminal, setTerminal] = useState<TerminalWindow | null>(null);
  const [results, setResults] = useState<Result[]>(() => commands.map(() => ({ state: "pending" })));
  const [finished, setFinished] = useState(false);
  const stop = useRef(false);
  const alive = useRef(true);
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    loadBase()
      .then((machine) => active && setBase({ machine }))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
    // The test starts from the machine it was opened with; only a new attempt loads it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!terminal) return;
    const steps = latest.current;
    stop.current = false;
    let current = true;
    const set = (i: number, result: Result) => current && alive.current && setResults((prev) => prev.map((r, j) => (j === i ? result : r)));

    void (async () => {
      terminal.setSpeed(6);
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        if (stop.current || !current) {
          for (let j = i; j < steps.length; j++) set(j, { state: "done", verdict: { kind: "stopped" } });
          break;
        }
        if (step.command.trim() === "") {
          set(i, { state: "done", verdict: { kind: "empty" } });
          continue;
        }
        set(i, { state: "running" });
        const status = await terminal.run({
          command: step.command.trim(),
          terminal: step.terminal,
          login: step.login && step.login.user.trim() ? { user: step.login.user.trim(), password: step.login.password } : undefined,
          answers: step.answers.filter((a) => a.trim() !== ""),
        });
        set(i, { state: "done", verdict: judge(status, step.expectError) });
      }
      if (current && alive.current) setFinished(true);
    })();
    return () => {
      current = false;
    };
  }, [terminal, attempt]);

  const again = () => {
    setTerminal(null);
    setFinished(false);
    setResults(latest.current.map(() => ({ state: "pending" })));
    setAttempt((n) => n + 1);
  };

  const done = results.filter((r): r is { state: "done"; verdict: Verdict } => r.state === "done");
  const good = done.filter((r) => isGood(r.verdict)).length;

  return (
    <div className={styles.tester} role="region" aria-label={m.title}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{m.title}</h3>
        <div className={styles.rowButtons}>
          {!finished && (
            <button type="button" className={styles.secondary} onClick={() => (stop.current = true)} disabled={!terminal}>
              {m.stop}
            </button>
          )}
          {finished && (
            <button type="button" className={styles.add} onClick={again}>
              {m.again}
            </button>
          )}
          <button type="button" className={styles.secondary} onClick={onClose}>
            {m.close}
          </button>
        </div>
      </div>
      <p className={styles.hint}>{m.help}</p>

      <div className={styles.recorder}>
        <div>
          {failed && (
            <p className={styles.error} role="alert">
              {m.loadFailed}
            </p>
          )}
          {!base && !failed && <p className={styles.hint}>{m.loading}</p>}
          {base && (
            <div className={styles.terminalBox}>
              <TerminalPane key={attempt} snapshot={base.machine} onReady={setTerminal} onCommand={() => {}} />
            </div>
          )}
        </div>

        <div className={styles.recorderSide}>
          <ol className={styles.results}>
            {commands.map((c, i) => {
              const r = results[i] ?? { state: "pending" as const };
              const bad = r.state === "done" && !isGood(r.verdict);
              return (
                <li key={c.id} className={`${styles.result} ${bad ? styles.resultBad : ""} ${r.state === "done" && !bad ? styles.resultGood : ""}`} aria-label={m.item(i + 1, c.command)}>
                  <code>{c.command || "—"}</code>
                  <span className={styles.resultText}>{r.state === "pending" ? m.pending : r.state === "running" ? m.running : verdictText(r.verdict)}</span>
                </li>
              );
            })}
          </ol>
          {finished && (
            <p className={done.length > 0 && good === commands.length ? styles.saved : styles.error} role="status">
              {m.summary(good, commands.length)}. {good === commands.length ? m.allGood : m.someBad}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

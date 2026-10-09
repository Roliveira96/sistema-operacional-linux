"use client";

import { useEffect, useRef, useState } from "react";
import { TerminalPane } from "@/components/TopicStudy/TerminalPane";
import type { TerminalWindow } from "@/engine/terminalWindow";
import type { CardCommand } from "@/lib/cardModel";
import { stepCount, type SetupLayer } from "@/lib/setup";
import { isConflict, runLayers, type StepResult } from "@/lib/setupRunner";
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
  | { kind: "envFailed" }
  | { kind: "stopped" }
  | { kind: "empty" };

type Result = { state: "pending" } | { state: "running" } | { state: "done"; verdict: Verdict; output?: string };
type EnvState = "pending" | "running" | "ok" | "failed";

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
    case "envFailed":
      return m.envFailedSkipped;
    case "stopped":
      return m.stopped;
    default:
      return m.empty;
  }
}

interface CardTesterProps {
  /** The commands as they are on the screen, saved or not. */
  commands: CardCommand[];
  /** The machine the test starts from: the topic scenario. */
  loadBase: () => Promise<unknown>;
  /** The snapshots run before the commands, in order: the module, the earlier cards and this one (SPEC-021). */
  layers: SetupLayer[];
  onClose: () => void;
  /** Called when a test ran to the end: true when the snapshots and every command ended as expected. */
  onFinish?: (passed: boolean) => void;
  /** Called just before `onFinish`: whether each command ended as expected, by command index. */
  onVerdicts?: (good: boolean[]) => void;
  /** The title of the card each command starts, by command index, for a test of several cards in sequence. */
  sections?: Record<number, string>;
}

/**
 * Tests a card the way a student will get it (SPEC-021): a clean machine, then the snapshots (the
 * module, the earlier cards and this one) and then every command in order. A snapshot command that
 * fails is a conflict and is reported with what the terminal said. It shows whether each command ended as
 * expected and, when one fails, what the terminal said. It works on a throwaway machine: nothing is saved.
 */
export function CardTester({ commands, loadBase, layers, onClose, onFinish, onVerdicts, sections }: CardTesterProps) {
  const [base, setBase] = useState<{ machine: unknown } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [terminal, setTerminal] = useState<TerminalWindow | null>(null);
  const [env, setEnv] = useState<EnvState>("pending");
  const [conflicts, setConflicts] = useState<StepResult[]>([]);
  const [envProgress, setEnvProgress] = useState(0);
  const [results, setResults] = useState<Result[]>(() => commands.map(() => ({ state: "pending" })));
  const [finished, setFinished] = useState(false);
  const stop = useRef(false);
  const list = useRef<HTMLOListElement>(null);
  const alive = useRef(true);
  const latest = useRef({ commands, layers, onFinish, onVerdicts });
  useEffect(() => {
    latest.current = { commands, layers, onFinish, onVerdicts };
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
    const { commands: steps, layers: toRun } = latest.current;
    let passed = true;
    const good = steps.map(() => false);
    stop.current = false;
    let current = true;
    const set = (i: number, result: Result) => current && alive.current && setResults((prev) => prev.map((r, j) => (j === i ? result : r)));
    const skipFrom = (from: number, verdict: Verdict) => {
      for (let j = from; j < steps.length; j++) set(j, { state: "done", verdict });
    };

    void (async () => {
      terminal.setSpeed(6);

      // 1. The snapshots, in order: the module, the earlier cards, this card.
      if (toRun.length > 0) {
        if (current && alive.current) setEnv("running");
        const results = await runLayers(terminal, toRun, {
          restoreSpeed: 6,
          shouldStop: () => stop.current || !current,
          onStep: () => current && alive.current && setEnvProgress((n) => n + 1),
        });
        const bad = results.filter(isConflict);
        if (current && alive.current) {
          setConflicts(bad);
          setEnv(bad.length > 0 ? "failed" : "ok");
        }
        if (bad.length > 0) {
          skipFrom(0, { kind: "envFailed" });
          if (current && alive.current) {
            setFinished(true);
            latest.current.onVerdicts?.(good);
            latest.current.onFinish?.(false);
          }
          return;
        }
      }

      // 2. The commands, in order.
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        if (stop.current || !current) {
          skipFrom(i, { kind: "stopped" });
          if (current && alive.current) setFinished(true);
          return;
        }
        if (step.command.trim() === "") {
          set(i, { state: "done", verdict: { kind: "empty" } });
          passed = false;
          continue;
        }
        set(i, { state: "running" });
        const { status, output } = await terminal.execute({
          command: step.command.trim(),
          terminal: step.terminal,
          login: step.login && step.login.user.trim() ? { user: step.login.user.trim(), password: step.login.password } : undefined,
          answers: step.answers.filter((a) => a.trim() !== ""),
        });
        const verdict = judge(status, step.expectError);
        passed = passed && isGood(verdict);
        good[i] = isGood(verdict);
        set(i, { state: "done", verdict, output });
      }
      if (current && alive.current) {
        setFinished(true);
        latest.current.onVerdicts?.(good);
        latest.current.onFinish?.(passed);
      }
    })();
    return () => {
      current = false;
    };
  }, [terminal, attempt]);

  // The list follows the command that is running, like the terminal follows its last line.
  useEffect(() => {
    const rows = list.current?.querySelectorAll<HTMLElement>("[data-state]");
    if (!rows) return;
    const running = [...rows].find((row) => row.dataset.state === "running");
    const lastDone = [...rows].reverse().find((row) => row.dataset.state === "done");
    (running ?? lastDone)?.scrollIntoView?.({ block: "nearest" });
  }, [results, env]);

  const again = () => {
    setTerminal(null);
    setFinished(false);
    setEnv("pending");
    setConflicts([]);
    setEnvProgress(0);
    setResults(latest.current.commands.map(() => ({ state: "pending" })));
    setAttempt((n) => n + 1);
  };

  const done = results.filter((r): r is Extract<Result, { state: "done" }> => r.state === "done");
  const good = done.filter((r) => isGood(r.verdict)).length;
  const hasEnv = layers.length > 0;
  const envText = env === "pending" ? m.pending : env === "running" ? m.progress(envProgress, stepCount(layers)) : env === "ok" ? m.environmentOk : m.environmentFailed(conflicts.length);

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
          <ol className={styles.results} ref={list}>
            {hasEnv && (
              <li className={`${styles.result} ${env === "failed" ? styles.resultBad : env === "ok" ? styles.resultGood : ""}`} aria-label={m.environmentStep}>
                <code>{m.environmentStep}</code>
                <span className={styles.resultText}>{envText}</span>
                {conflicts.map((c) => (
                  <div key={`${c.layer.id}-${c.index}`} role="alert">
                    <span className={styles.outputLabel}>{m.conflict(c.layer.label, c.step.command, c.layer.kind === "module")}</span>
                    {c.output && (
                      <>
                        <span className={styles.outputLabel}>{m.terminalSaid}</span>
                        <pre className={styles.output}>{c.output}</pre>
                      </>
                    )}
                  </div>
                ))}
              </li>
            )}
            {commands.map((c, i) => {
              const r = results[i] ?? { state: "pending" as const };
              const bad = r.state === "done" && !isGood(r.verdict);
              return (
                <li key={c.id} data-state={r.state} data-section={sections?.[i]} className={`${styles.result} ${bad ? styles.resultBad : ""} ${r.state === "done" && !bad ? styles.resultGood : ""}`} aria-label={m.item(i + 1, c.command)}>
                  {sections?.[i] && <span className={styles.outputLabel}>{m.section(sections[i])}</span>}
                  <code>{c.command || "—"}</code>
                  <span className={styles.resultText}>{r.state === "pending" ? m.pending : r.state === "running" ? m.running : verdictText(r.verdict)}</span>
                  {bad && r.output && (
                    <>
                      <span className={styles.outputLabel}>{m.terminalSaid}</span>
                      <pre className={styles.output}>{r.output}</pre>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {finished && (
            <p className={env !== "failed" && done.length > 0 && good === commands.length ? styles.saved : styles.error} role="status">
              {env === "failed" ? m.envFailedSummary : `${m.summary(good, commands.length)}. ${good === commands.length ? m.allGood : m.someBad}`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Terminal, type TerminalHandle, type TerminalProps } from "@/components/Terminal/Terminal";
import { contentMessages } from "@/messages/content.pt-BR";
import { ApiProblemError } from "@/services/httpClient";
import { practiceService, type PracticeService } from "@/services/practiceService";
import styles from "./ExercisePractice.module.scss";

type Result = "passed" | "notYet" | "login" | "error" | null;

export interface ExercisePracticeProps {
  questionId: string;
  completed: boolean;
  onCompleted?: (questionId: string) => void;
  service?: Pick<PracticeService, "scenario" | "check">;
  /** Injectable engine factory, for tests. */
  create?: TerminalProps["create"];
}

/** Practice panel of one exercise: terminal, server-side check and reset (SPEC-014). */
export function ExercisePractice({ questionId, completed, onCompleted, service = practiceService, create }: ExercisePracticeProps) {
  const m = contentMessages.practice;
  const terminal = useRef<TerminalHandle>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<unknown>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (snapshot === null) {
      try {
        setSnapshot(await service.scenario(questionId));
      } catch {
        setLoadFailed(true);
      }
    }
  }

  async function check() {
    const state = terminal.current?.snapshot();
    if (!state) return;
    setChecking(true);
    try {
      const r = await service.check(questionId, state);
      setResult(r.passed ? "passed" : "notYet");
      if (r.passed) onCompleted?.(questionId);
    } catch (error) {
      setResult(error instanceof ApiProblemError && error.status === 401 ? "login" : "error");
    } finally {
      setChecking(false);
    }
  }

  function reset() {
    setGeneration((g) => g + 1);
    setResult(null);
  }

  const messages: Record<Exclude<Result, null>, string> = {
    passed: m.passed,
    notYet: m.notYet,
    login: m.needsLogin,
    error: m.checkFailed,
  };

  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <Button variant="secondary" onClick={() => void toggle()} aria-expanded={open}>
          {open ? m.close : m.open}
        </Button>
        {completed && <span className={styles.completed}>✓ {m.completed}</span>}
      </div>

      {open && loadFailed && <p role="alert">{m.loadFailed}</p>}
      {open && !loadFailed && snapshot === null && <p role="status">{m.loadingTerminal}</p>}
      {open && snapshot !== null && (
        <>
          <Terminal key={generation} ref={terminal} snapshot={snapshot} create={create} onError={() => setLoadFailed(true)} />
          <div className={styles.toolbar}>
            <Button onClick={() => void check()} disabled={checking}>
              {checking ? m.checking : m.check}
            </Button>
            <Button variant="secondary" onClick={reset}>
              {m.reset}
            </Button>
          </div>
          {result && (
            <p className={`${styles.result} ${styles[result]}`} role={result === "passed" ? "status" : "alert"}>
              {messages[result]}
              {result === "login" && (
                <>
                  {" "}
                  <Link href="/login">{contentMessages.goToLogin}</Link>
                </>
              )}
            </p>
          )}
        </>
      )}
    </div>
  );
}

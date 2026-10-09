"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiProblemError } from "@/services/httpClient";
import type { PracticeService } from "@/services/practiceService";

/** Quiet time after the last command before the machine is sent (SPEC-016, RN-03). */
export const CHECK_DELAY_MS = 600;
/** Wait after a 429 that carries no Retry-After. */
const DEFAULT_RETRY_SECONDS = 5;

export interface ModuleCheck {
  /** Challenges the machine has met so far (new approvals and earlier completions). */
  completed: ReadonlySet<string>;
  /** True when the server refused the check because there is no session. */
  needsLogin: boolean;
  /** Schedules a check of this machine state. */
  submit(snapshot: unknown): void;
  /** Marks challenges completed from outside (the progress loaded at the start). */
  seed(ids: Iterable<string>): void;
}

/**
 * The automatic check of the prototype: after each command the machine goes to
 * the server, which grades every challenge of the module. It waits for a quiet
 * moment, never runs two checks at once and respects Retry-After.
 */
export function useModuleCheck(
  practice: Pick<PracticeService, "checkModule">,
  moduleId: string,
  onNewlyCompleted?: (ids: string[]) => void,
): ModuleCheck {
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [needsLogin, setNeedsLogin] = useState(false);
  const state = useRef({
    latest: undefined as unknown,
    dirty: false,
    inflight: false,
    stopped: false,
    timer: 0,
    known: new Set<string>(),
    practice,
    onNewlyCompleted,
  });

  useEffect(() => {
    state.current.practice = practice;
    state.current.onNewlyCompleted = onNewlyCompleted;
  });

  useEffect(() => {
    const current = state.current;
    current.stopped = false;
    return () => {
      current.stopped = true;
      window.clearTimeout(current.timer);
    };
  }, []);

  const run = useCallback(
    async function run(): Promise<void> {
      const s = state.current;
      if (s.inflight || s.stopped || !s.dirty) return;
      s.inflight = true;
      s.dirty = false;
      let retryAfter = 0;
      try {
        const result = await s.practice.checkModule(moduleId, s.latest);
        const fresh = result.passed.filter((id) => !s.known.has(id));
        result.progress.filter((p) => p.completedAt).forEach((p) => s.known.add(p.questionId));
        result.passed.forEach((id) => s.known.add(id));
        if (!s.stopped) {
          setCompleted(new Set(s.known));
          if (fresh.length > 0) s.onNewlyCompleted?.(fresh);
        }
      } catch (error) {
        if (error instanceof ApiProblemError && error.status === 401) {
          s.stopped = true;
          setNeedsLogin(true);
        } else if (error instanceof ApiProblemError && error.status === 429) {
          s.dirty = true;
          retryAfter = error.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS;
        }
        // Any other failure is ignored: the next command checks again.
      } finally {
        s.inflight = false;
      }
      if (s.dirty && !s.stopped) {
        window.clearTimeout(s.timer);
        s.timer = window.setTimeout(() => void run(), Math.max(CHECK_DELAY_MS, retryAfter * 1000));
      }
    },
    [moduleId],
  );

  const submit = useCallback(
    (snapshot: unknown) => {
      const s = state.current;
      if (s.stopped) return;
      s.latest = snapshot;
      s.dirty = true;
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => void run(), CHECK_DELAY_MS);
    },
    [run],
  );

  const seed = useCallback((ids: Iterable<string>) => {
    for (const id of ids) state.current.known.add(id);
    setCompleted(new Set(state.current.known));
  }, []);

  return { completed, needsLogin, submit, seed };
}

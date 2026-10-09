import { ApiProblemError } from "@/services/httpClient";
import type { ModuleCheckResult } from "@/services/practiceService";

// Automatic check of the challenges after each command (SPEC-016 RN-03): waits
// for a quiet period, never keeps two checks in flight, stops for visitors and
// honours Retry-After.

export interface AutoCheckOptions {
  check(snapshot: unknown): Promise<ModuleCheckResult>;
  snapshot(): unknown;
  onResult(result: ModuleCheckResult): void;
  /** The student has no session: checks stop until the page reloads. */
  onUnauthorized(): void;
  delayMs?: number;
}

export interface AutoCheck {
  /** Called after each command. */
  schedule(): void;
  stop(): void;
}

export function createAutoCheck({ check, snapshot, onResult, onUnauthorized, delayMs = 600 }: AutoCheckOptions): AutoCheck {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let pending = false;
  let stopped = false;

  const arm = (ms: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), ms);
  };

  async function run() {
    if (stopped) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    pending = false;
    try {
      onResult(await check(snapshot()));
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 401) {
        stopped = true;
        onUnauthorized();
      } else if (error instanceof ApiProblemError && error.status === 429) {
        pending = false;
        arm((error.retryAfterSeconds ?? 5) * 1000);
      }
      // Other failures are dropped: the next command checks again.
    } finally {
      inFlight = false;
      if (pending && !stopped) arm(delayMs);
    }
  }

  return {
    schedule() {
      if (!stopped) arm(delayMs);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

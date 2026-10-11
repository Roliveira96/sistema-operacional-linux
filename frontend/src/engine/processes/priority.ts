import type { EngineProcess } from "./types";

// The priority ("niceness") of the processes (SPEC-029 RN-05). The engine has no such field, so it lives here, per process.

/** The range of the niceness on Linux: -20 (the most priority) to 19 (the least). */
export const NICE_MIN = -20;
export const NICE_MAX = 19;

/** The base priority a niceness is added to (what ps -l shows as PRI). */
export const BASE_PRIORITY = 80;

const nices = new WeakMap<object, number>();

export const clampNice = (value: number): number => Math.min(NICE_MAX, Math.max(NICE_MIN, Math.trunc(value)));

/** The niceness of a process: its own, or the one it inherited from the process that started it. */
export function niceOf(process: EngineProcess | null): number {
  for (let current = process; current !== null; current = current.pai) {
    const own = nices.get(current);
    if (own !== undefined) return own;
  }
  return 0;
}

export function setNice(process: EngineProcess, value: number): void {
  nices.set(process, clampNice(value));
}

/** PRI as ps -l shows it. */
export const priorityOf = (process: EngineProcess | null): number => BASE_PRIORITY + niceOf(process);

// The processes that are not commands of the user (init, services) are not objects the engine keeps; their niceness is kept by PID.
const systemNices = new Map<number, number>();

export const niceOfPid = (pid: number): number => systemNices.get(pid) ?? 0;
export const setNiceOfPid = (pid: number, value: number): void => void systemNices.set(pid, clampNice(value));

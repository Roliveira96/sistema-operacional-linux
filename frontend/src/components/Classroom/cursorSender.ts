"use client";

import { useEffect, useRef } from "react";

/** The pointer and the pen go out about 30 times a second (SPEC-051 CA-06). */
export const FRAME_MS = 33;

export interface Throttle<A extends unknown[]> {
  call(...args: A): void;
  cancel(): void;
}

/** Calls at once, then at most once every `ms` with the latest arguments; the last call always gets through. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttle<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | null = null;
  return {
    call(...args: A) {
      const wait = last + ms - Date.now();
      if (wait <= 0) {
        clearTimeout(timer);
        timer = undefined;
        pending = null;
        last = Date.now();
        fn(...args);
        return;
      }
      pending = args;
      timer ??= setTimeout(() => {
        timer = undefined;
        last = Date.now();
        const next = pending;
        pending = null;
        if (next) fn(...next);
      }, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

export type CursorSend = (x: number, y: number, laser: boolean, visible?: boolean) => void;

/**
 * What the mouse of the teacher tells the class, on the slide and on the module alike: the pointer goes out about 30 times a second with the last
 * position always arriving, with the laser as a highlight; it goes away when the mouse leaves the stage; and whoever turns the laser on or off, the
 * class sees the pointer change at once, even if the mouse is still. `x` and `y` are percentages (of the page, or of the stage).
 */
export function useCursorSender(onCursor: CursorSend, laser: boolean) {
  const send = useRef(onCursor);
  useEffect(() => {
    send.current = onCursor;
  });
  const pace = useRef<Throttle<[number, number, boolean, boolean]> | null>(null);
  const lastAt = useRef<[number, number] | null>(null);
  useEffect(() => {
    const out = throttle((x: number, y: number, on: boolean, visible: boolean) => send.current(x, y, on, visible), FRAME_MS);
    pace.current = out;
    return () => out.cancel();
  }, []);

  const wasLaser = useRef(laser);
  useEffect(() => {
    if (wasLaser.current !== laser && lastAt.current) send.current(lastAt.current[0], lastAt.current[1], laser, true);
    wasLaser.current = laser;
  }, [laser]);

  return {
    move(x: number, y: number) {
      lastAt.current = [x, y];
      pace.current?.call(x, y, laser, true);
    },
    leave() {
      lastAt.current = null;
      pace.current?.cancel();
      send.current(0, 0, false, false);
    },
  };
}

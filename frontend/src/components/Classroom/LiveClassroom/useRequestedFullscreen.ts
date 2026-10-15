"use client";

import { useEffect, useState, type RefObject } from "react";

/** Asks the browser for the full screen of `el`. A browser that has none is left alone; one that refuses, with a promise or with an exception, is told to `onRefused`. */
function ask(el: HTMLElement | null, onRefused: () => void) {
  if (!el || typeof el.requestFullscreen !== "function") return;
  try {
    Promise.resolve(el.requestFullscreen()).catch(onRefused);
  } catch {
    onRefused();
  }
}

/**
 * The tries at the full screen of the room: `enter` asks for it, and when the browser refuses (it wants a gesture of the student, and the request of the
 * teacher is not one) the next click or key of the student, anywhere, asks again, once. A gesture that was not enough waits for the next one; Escape is
 * not a gesture, so it asks for nothing. `stop` drops what is waiting.
 */
function createTries(room: RefObject<HTMLElement | null>) {
  let waiting: (() => void) | null = null;
  const stop = () => {
    waiting?.();
    waiting = null;
  };
  const wait = () => {
    if (waiting) return;
    const gesture = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key === "Escape") return;
      enter();
    };
    document.addEventListener("click", gesture);
    document.addEventListener("keydown", gesture);
    waiting = () => {
      document.removeEventListener("click", gesture);
      document.removeEventListener("keydown", gesture);
    };
  };
  const enter = () => {
    stop();
    ask(room.current, wait);
  };
  return { enter, stop };
}

/**
 * The full screen that the teacher asks the students for (SPEC-059 section 3.1). While `requested`, it asks the browser for the full screen of the room at
 * once; the browser may refuse, so then the next click or key of the student enters it, and `inFullscreen` tells the room whether to offer the button of
 * one click. When the student leaves the full screen (Escape) the room does not insist: nothing waits for a gesture again, and the button is how he goes
 * back in. When the request goes off, the full screen of the room is left, however he came into it (the request, the button or the key F take the whole room,
 * SPEC-063), and the full screen of any other element is not touched.
 */
export function useRequestedFullscreen(room: RefObject<HTMLElement | null>, requested: boolean) {
  const [tries] = useState(() => createTries(room));
  const [inFullscreen, setInFullscreen] = useState(false);

  useEffect(() => {
    if (!requested) return;
    const el = room.current;
    tries.enter();
    return () => {
      tries.stop();
      const full = document.fullscreenElement;
      if (full && full === el) void document.exitFullscreen?.();
    };
  }, [requested, tries, room]);

  useEffect(() => {
    const changed = () => {
      const on = document.fullscreenElement != null;
      setInFullscreen(on);
      // In the full screen already, nothing waits for a gesture.
      if (on) tries.stop();
    };
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [tries]);

  return {
    inFullscreen,
    /** Whether this browser has the full screen at all: with none there is nothing to ask for and no button to offer. */
    supported: typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function",
    enter: tries.enter,
  };
}

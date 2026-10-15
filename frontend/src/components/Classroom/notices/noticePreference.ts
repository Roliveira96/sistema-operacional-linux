import { useState } from "react";

/** The key of the choice in the browser, apart from the one of the sound of the panel (SPEC-064 CA-05). */
export const NOTICE_KEY = "live-browser-notices";

/** On unless the person turned it off: once the permission is given, the notices start on. */
export function readNoticePreference() {
  try {
    return localStorage.getItem(NOTICE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeNoticePreference(on: boolean) {
  try {
    localStorage.setItem(NOTICE_KEY, on ? "on" : "off");
  } catch {
    /* the choice just does not last */
  }
}

/** The choice of the person for the notices, on or off, kept in the browser; what the screen shows changes even when the browser keeps nothing. */
export function useNoticePreference() {
  const [on, setOn] = useState(readNoticePreference);
  const change = (next: boolean) => {
    setOn(next);
    writeNoticePreference(next);
  };
  return [on, change] as const;
}

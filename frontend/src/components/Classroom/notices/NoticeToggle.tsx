"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import { browserNotice, type BrowserNotice, type NoticePermission } from "./browserNotice";
import styles from "./NoticeToggle.module.scss";

const m = messages.classroom.notices;

/** What the browser says about the permission changes only when the person answers its box, which this button asks for itself: nothing to subscribe to. */
const subscribe = () => () => undefined;

export interface NoticeToggleProps {
  /** The choice of the person, on or off, which the parent keeps; it counts only once the permission is given. */
  enabled: boolean;
  onChange(enabled: boolean): void;
  /** The access to the browser; a test puts a double here. */
  notice?: BrowserNotice;
}

/**
 * The button "Notificações" of the live class, for the teacher and for the student (SPEC-064). It has four states: unavailable (the browser has no notices, or the
 * page is not in a secure context), permission not asked yet (the click is the gesture that asks for it, and turns the notices on if it is given), given (it
 * turns them on and off) and blocked in the browser. In the two that cannot be used the reason is a text on the screen, tied to the button, and not only a title.
 */
export function NoticeToggle({ enabled, onChange, notice = browserNotice }: NoticeToggleProps) {
  const hintId = useId();
  // The server has no browser: it draws the unavailable state, which the first render of the browser draws too, so the page and the browser agree.
  const current = useSyncExternalStore(subscribe, () => notice.permission(), (): NoticePermission => "unsupported");
  const [answer, setAnswer] = useState<NoticePermission | null>(null);
  const permission = answer ?? current;

  const ask = async () => {
    const result = await notice.requestPermission();
    setAnswer(result);
    if (result === "granted") onChange(true);
  };

  const hint = permission === "unsupported" ? m.unavailable : permission === "denied" ? m.blocked : null;

  return (
    <div className={styles.toggle}>
      {permission === "default" ? (
        <Button variant="secondary" size="sm" className={styles.button} onClick={() => void ask()}>
          {m.enable}
        </Button>
      ) : hint ? (
        <Button variant="secondary" size="sm" className={styles.button} disabled aria-describedby={hintId}>
          {m.toggle}
        </Button>
      ) : (
        <Button variant={enabled ? "primary" : "secondary"} size="sm" className={styles.button} aria-pressed={enabled} onClick={() => onChange(!enabled)}>
          {m.toggle}
        </Button>
      )}
      {hint && (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

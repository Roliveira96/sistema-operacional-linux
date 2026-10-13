"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { NotificationPreferences as Prefs } from "@/services/scheduleService";
import styles from "./NotificationPreferences.module.scss";

export interface NotificationPreferencesProps {
  load: () => Promise<Prefs>;
  save: (patch: Partial<Prefs>) => Promise<Prefs>;
}

export function NotificationPreferences({ load, save }: NotificationPreferencesProps) {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    load()
      .then((data) => {
        if (active) setPrefs(data);
      })
      .catch(() => {
        if (active) setErrorMessage(messages.schedule.preferences.error);
      });
    return () => {
      active = false;
    };
  }, [load]);

  const handleToggle = async (key: keyof Prefs) => {
    if (!prefs) return;
    const previous = prefs[key];
    const nextVal = !previous;

    // Optimistically update
    setPrefs({ ...prefs, [key]: nextVal });
    setStatusMessage(null);
    setErrorMessage(null);

    try {
      const updated = await save({ [key]: nextVal });
      setPrefs(updated);
      setStatusMessage(messages.schedule.preferences.saved);
    } catch {
      // Revert on failure
      setPrefs({ ...prefs, [key]: previous });
      setErrorMessage(messages.schedule.preferences.error);
    }
  };

  if (!prefs) {
    return null;
  }

  return (
    <div className={styles.container}>
      <div className={styles.title}>{messages.schedule.preferences.title}</div>
      <div className={styles.help}>{messages.schedule.preferences.help}</div>

      <div className={styles.options}>
        <div className={styles.option}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={prefs.sessionReminders}
              onChange={() => handleToggle("sessionReminders")}
            />
            {messages.schedule.preferences.reminders}
          </label>
          <div className={styles.optionHelp}>{messages.schedule.preferences.remindersHelp}</div>
        </div>

        <div className={styles.option}>
          <label className={styles.label}>
            <input
              type="checkbox"
              checked={prefs.weeklyDigest}
              onChange={() => handleToggle("weeklyDigest")}
            />
            {messages.schedule.preferences.digest}
          </label>
          <div className={styles.optionHelp}>{messages.schedule.preferences.digestHelp}</div>
        </div>
      </div>

      {statusMessage && <div className={styles.feedback}>{statusMessage}</div>}
      {errorMessage && <div className={styles.error}>{errorMessage}</div>}
    </div>
  );
}

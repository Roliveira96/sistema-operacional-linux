"use client";

import { useId, useRef } from "react";
import { endAfterLessons, isHttpsUrl, minutesOf, suggestLessons } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type { Mode } from "@/services/scheduleService";
import styles from "./MeetingsEditor.module.scss";

export interface MeetingDraft {
  id?: string;
  key?: string;
  weekday: number;
  startTime: string;
  endTime: string;
  lessonCount: number;
  mode: Mode;
  room?: string;
  onlineUrl?: string;
}

export interface MeetingsEditorProps {
  value: MeetingDraft[];
  errors?: Record<string, string>;
  onChange: (value: MeetingDraft[]) => void;
}

export function validateMeetingDrafts(drafts: MeetingDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (let i = 0; i < drafts.length; i++) {
    const a = drafts[i]!;
    const keyA = a.key ?? a.id ?? String(i);

    if (minutesOf(a.endTime) <= minutesOf(a.startTime)) {
      errors[keyA] = messages.schedule.errors.endBeforeStart;
      continue;
    }

    if (a.mode === "ONLINE" && !isHttpsUrl(a.onlineUrl)) {
      errors[keyA] = messages.schedule.errors.httpsLink;
      continue;
    }

    for (let j = 0; j < drafts.length; j++) {
      if (i === j) continue;
      const b = drafts[j]!;
      if (a.weekday === b.weekday) {
        const startA = minutesOf(a.startTime);
        const endA = minutesOf(a.endTime);
        const startB = minutesOf(b.startTime);
        const endB = minutesOf(b.endTime);

        if (startA < endB && startB < endA) {
          errors[keyA] = messages.schedule.errors.overlap;
          break;
        }
      }
    }
  }
  return errors;
}

export function MeetingsEditor({ value, errors = {}, onChange }: MeetingsEditorProps) {
  const baseId = useId();
  const nextKeyId = useRef(0);

  const totalLessons = value.reduce((sum, m) => sum + (m.lessonCount || 0), 0);

  const toggleDay = (weekday: number) => {
    const hasDay = value.some((m) => m.weekday === weekday);
    if (hasDay) {
      onChange(value.filter((m) => m.weekday !== weekday));
    } else {
      nextKeyId.current += 1;
      const newDraft: MeetingDraft = {
        key: `${baseId}-${weekday}-${nextKeyId.current}`,
        weekday,
        startTime: "08:20",
        endTime: endAfterLessons("08:20", 2),
        lessonCount: 2,
        mode: "IN_PERSON",
      };
      onChange([...value, newDraft]);
    }
  };

  const addTime = (weekday: number) => {
    const existing = value.filter((m) => m.weekday === weekday);
    const last = existing[existing.length - 1];
    let startTime = "10:40";
    if (last) {
      const startMin = Math.min(23 * 60 + 59, minutesOf(last.endTime) + 20);
      startTime = `${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`;
    }
    const endTime = endAfterLessons(startTime, 2);
    nextKeyId.current += 1;
    const newDraft: MeetingDraft = {
      key: `${baseId}-${weekday}-${nextKeyId.current}`,
      weekday,
      startTime,
      endTime,
      lessonCount: 2,
      mode: "IN_PERSON",
    };
    onChange([...value, newDraft]);
  };

  const removeTime = (indexToRemove: number) => {
    onChange(value.filter((_, idx) => idx !== indexToRemove));
  };

  const updateDraft = (index: number, updates: Partial<MeetingDraft>) => {
    const next = [...value];
    const current = next[index]!;
    const updated = { ...current, ...updates };

    if (updates.lessonCount !== undefined && updates.lessonCount >= 1) {
      updated.endTime = endAfterLessons(updated.startTime, updated.lessonCount);
    } else if ("startTime" in updates || "endTime" in updates) {
      if (minutesOf(updated.endTime) > minutesOf(updated.startTime)) {
        updated.lessonCount = suggestLessons(updated.startTime, updated.endTime);
      }
    }

    next[index] = updated;
    onChange(next);
  };

  return (
    <div className={styles.container}>
      <div className={styles.weekdays}>
        {messages.schedule.weekdays.map((dayName, weekday) => {
          const active = value.some((m) => m.weekday === weekday);
          return (
            <button
              key={weekday}
              type="button"
              className={styles.weekdayBtn}
              aria-pressed={active}
              onClick={() => toggleDay(weekday)}
            >
              {dayName}
            </button>
          );
        })}
      </div>

      {value.length === 0 ? (
        <div className={styles.empty}>{messages.schedule.meetings.empty}</div>
      ) : (
        <>
          <div className={styles.summary}>
            {messages.schedule.meetings.weeklyLessons(totalLessons)}
          </div>

          {messages.schedule.weekdays.map((dayName, weekday) => {
            const dayDrafts = value
              .map((draft, originalIndex) => ({ draft, originalIndex }))
              .filter(({ draft }) => draft.weekday === weekday);

            if (dayDrafts.length === 0) return null;

            return (
              <div key={weekday} className={styles.daySection}>
                <div className={styles.dayHeader}>
                  <span className={styles.dayTitle}>{dayName}</span>
                  <button
                    type="button"
                    className={styles.addBtn}
                    onClick={() => addTime(weekday)}
                  >
                    {messages.schedule.meetings.addTime(dayName)}
                  </button>
                </div>

                {dayDrafts.map(({ draft, originalIndex }) => {
                  const draftKey = draft.key ?? draft.id ?? String(originalIndex);
                  const error = errors[draftKey];

                  return (
                    <div key={draftKey} className={styles.meetingRow}>
                      <div className={styles.fields}>
                        <div className={styles.field}>
                          <label htmlFor={`start-${draftKey}`}>
                            {messages.schedule.meetings.start(dayName)}
                          </label>
                          <input
                            id={`start-${draftKey}`}
                            type="time"
                            value={draft.startTime}
                            onChange={(e) => updateDraft(originalIndex, { startTime: e.target.value })}
                          />
                        </div>

                        <div className={styles.field}>
                          <label htmlFor={`end-${draftKey}`}>
                            {messages.schedule.meetings.end(dayName)}
                          </label>
                          <input
                            id={`end-${draftKey}`}
                            type="time"
                            value={draft.endTime}
                            onChange={(e) => updateDraft(originalIndex, { endTime: e.target.value })}
                          />
                        </div>

                        <div className={styles.field}>
                          <label htmlFor={`lessons-${draftKey}`}>
                            {messages.schedule.meetings.lessons(dayName)}
                          </label>
                          <input
                            id={`lessons-${draftKey}`}
                            type="number"
                            min={1}
                            max={8}
                            value={draft.lessonCount}
                            onChange={(e) =>
                              updateDraft(originalIndex, { lessonCount: Number(e.target.value) })
                            }
                          />
                        </div>

                        <div className={styles.field}>
                          <label htmlFor={`mode-${draftKey}`}>
                            {messages.schedule.meetings.mode(dayName)}
                          </label>
                          <select
                            id={`mode-${draftKey}`}
                            value={draft.mode}
                            onChange={(e) =>
                              updateDraft(originalIndex, { mode: e.target.value as Mode })
                            }
                          >
                            <option value="IN_PERSON">{messages.schedule.modes.IN_PERSON}</option>
                            <option value="ONLINE">{messages.schedule.modes.ONLINE}</option>
                          </select>
                        </div>

                        {draft.mode === "IN_PERSON" ? (
                          <div className={styles.field}>
                            <label htmlFor={`room-${draftKey}`}>
                              {messages.schedule.meetings.room(dayName)}
                            </label>
                            <input
                              id={`room-${draftKey}`}
                              type="text"
                              value={draft.room ?? ""}
                              onChange={(e) => updateDraft(originalIndex, { room: e.target.value })}
                            />
                          </div>
                        ) : (
                          <div className={styles.field}>
                            <label htmlFor={`link-${draftKey}`}>
                              {messages.schedule.meetings.link(dayName)}
                            </label>
                            <input
                              id={`link-${draftKey}`}
                              type="url"
                              value={draft.onlineUrl ?? ""}
                              onChange={(e) =>
                                updateDraft(originalIndex, { onlineUrl: e.target.value })
                              }
                            />
                          </div>
                        )}

                        <button
                          type="button"
                          className={styles.removeBtn}
                          onClick={() => removeTime(originalIndex)}
                        >
                          {messages.schedule.meetings.removeTime(dayName)}
                        </button>
                      </div>

                      {error && <span className={styles.error}>{error}</span>}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

"use client";

import { type ReactNode, useState } from "react";
import type { MeetingDraft } from "@/components/MeetingsEditor/MeetingsEditor";
import { addMonths, isoDate, minutesOf, monthGrid, parseIsoDate } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import styles from "./MeetingsPreview.module.scss";

const m = messages.schedule.preview;

export interface MeetingsPreviewProps {
  /** First day of the term, as a date input value. */
  startDate: string;
  /** Last day of the term, as a date input value. */
  endDate: string;
  meetings: MeetingDraft[];
  color: string;
}

/** Read-only month calendar of the lessons the weekly meetings generate in the term (SPEC-044, section 3.1.2). */
export function MeetingsPreview({ startDate, endDate, meetings, color }: MeetingsPreviewProps) {
  const [shown, setShown] = useState<{ key: string; month: Date } | null>(null);

  const validTerm = Boolean(startDate) && Boolean(endDate) && startDate <= endDate;

  let body: ReactNode;
  if (!validTerm) {
    body = <p className={styles.notice}>{m.needDates}</p>;
  } else if (meetings.length === 0) {
    body = <p className={styles.notice}>{m.needMeetings}</p>;
  } else {
    const first = parseIsoDate(startDate);
    const last = parseIsoDate(endDate);
    const firstMonth = new Date(first.getFullYear(), first.getMonth(), 1);
    const lastMonth = new Date(last.getFullYear(), last.getMonth(), 1);

    // The month shown follows the term: a new start date brings the calendar back to it.
    const month = shown && shown.key === startDate ? shown.month : firstMonth;
    const clamp = (d: Date) => (d < firstMonth ? firstMonth : d > lastMonth ? lastMonth : d);
    const go = (delta: number) => setShown({ key: startDate, month: clamp(addMonths(month, delta)) });

    const byWeekday = (weekday: number) =>
      meetings.filter((x) => x.weekday === weekday).sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));

    body = (
      <>
        <div className={styles.header}>
          <button type="button" className={styles.nav} disabled={month <= firstMonth} onClick={() => go(-1)}>
            {m.previousMonth}
          </button>
          <span className={styles.title}>{m.monthTitle(month.getMonth(), month.getFullYear())}</span>
          <button type="button" className={styles.nav} disabled={month >= lastMonth} onClick={() => go(1)}>
            {m.nextMonth}
          </button>
        </div>
        <div className={styles.grid}>
          {messages.schedule.weekdaysShort.map((d) => (
            <span key={d} className={styles.weekday}>
              {d}
            </span>
          ))}
          {monthGrid(month.getFullYear(), month.getMonth()).map((day) => {
            const iso = isoDate(day);
            const inTerm = iso >= startDate && iso <= endDate;
            const dayMeetings = inTerm ? byWeekday(day.getDay()) : [];
            return (
              <div
                key={iso}
                data-date={iso}
                className={`${styles.day} ${day.getMonth() === month.getMonth() ? "" : styles.otherMonth} ${inTerm ? "" : styles.outOfTerm}`}
              >
                <span className={styles.dayNumber}>{day.getDate()}</span>
                {dayMeetings.map((x, i) => (
                  <span key={x.key ?? x.id ?? i} data-marker="" data-color={color} className={styles.marker}>
                    {m.marker(x.startTime, x.endTime, x.lessonCount)}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </>
    );
  }

  return (
    <section className={styles.preview} aria-label={m.label}>
      <h3 className={styles.heading}>{m.label}</h3>
      {body}
    </section>
  );
}

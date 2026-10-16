"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { SessionDiary } from "@/components/SessionDiary/SessionDiary";
import { parseIsoDate } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type { LiveTerminalCommand } from "@/services/classroomService";
import type { Session, SessionDiary as Diary, Timeline, TimelineEntry } from "@/services/scheduleService";
import styles from "./ClassTimeline.module.scss";

const m = messages.schedule.timeline;

/** How often the timeline is asked again while the tab is in view (SPEC-073, 3.1). */
const CHECK_EVERY_MS = 60_000;

export interface ClassTimelineProps {
  classId: string;
  /** The code of the course, shown for a lesson that has no topic. */
  courseCode: string;
  role: "teacher" | "student";
  /** Reads the timeline; the server decides what is past, current and upcoming (SPEC-073 RN-01). */
  load: () => Promise<Timeline>;
  loadDiary: (session: Session) => Promise<Diary>;
  loadCommands: (liveSessionId: string) => Promise<LiveTerminalCommand[]>;
  /** Where the live class of the class is, for the way in and back. */
  liveHref: string;
  /** The teacher starts the live class from the current lesson (SPEC-053 CA-11). */
  onStartLive?: (session: TimelineEntry) => void;
  /** Changing it reads the timeline again. */
  reloadKey?: number;
}

/** "segunda-feira, 19/10" */
function dayOf(entry: TimelineEntry): string {
  const date = parseIsoDate(entry.date);
  const weekday = (messages.schedule.weekdays[date.getDay()] ?? "").toLowerCase();
  return `${weekday}, ${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * The timeline of the class under the calendar (SPEC-073, 3.1): the current lesson, the past ones folded, and the upcoming ones. It asks the server
 * when it opens, every minute while the tab is in view and when the tab comes back into view; a failed reading hides it until the next one.
 */
export function ClassTimeline({ classId, courseCode, role, load, loadDiary, loadCommands, liveHref, onStartLive, reloadKey = 0 }: ClassTimelineProps) {
  const [data, setData] = useState<Timeline | null>(null);
  const baseId = useId();

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      load().then(
        (timeline) => alive && setData(timeline),
        () => alive && setData(null),
      );
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load, reloadKey]);

  if (!data) return null;
  const { current, past, upcoming, liveSessionId, now } = data;
  const next = upcoming[0];
  const diaryProps = { classId, role, loadDiary, loadCommands };

  return (
    <section className={styles.timeline} aria-label={m.region}>
      <section className={styles.block} aria-labelledby={`${baseId}-current`}>
        <h3 id={`${baseId}-current`} className={styles.heading}>
          {m.current}
        </h3>
        {current ? (
          <article className={`${styles.card} ${styles.current}`}>
            <div className={styles.cardHead}>
              <span className={styles.badgeNow}>{new Date(now) >= new Date(current.startsAt) ? m.now : m.startsAt(current.startTime)}</span>
              <span>
                {dayOf(current)} · {current.startTime}–{current.endTime}
              </span>
            </div>
            <h4 className={styles.topic}>{current.topic || courseCode}</h4>
            <Place entry={current} />
            <div className={styles.actions}>
              {liveSessionId ? (
                <ButtonLink href={liveHref} variant="primary" size="sm">
                  {role === "teacher" ? m.backToLive : m.enterLive}
                </ButtonLink>
              ) : role === "teacher" ? (
                onStartLive && (
                  <Button variant="primary" size="sm" onClick={() => onStartLive(current)}>
                    {m.startLive}
                  </Button>
                )
              ) : (
                <p className={styles.muted}>{m.liveNotStarted}</p>
              )}
            </div>
          </article>
        ) : (
          <>
            <p className={styles.empty}>{m.none}</p>
            {next && <p className={styles.empty}>{m.next(dayOf(next), next.startTime)}</p>}
          </>
        )}
      </section>

      <section className={styles.block} aria-labelledby={`${baseId}-past`}>
        <h3 id={`${baseId}-past`} className={styles.heading}>
          {m.past}
        </h3>
        {past.length === 0 ? (
          <p className={styles.empty}>{m.noPast}</p>
        ) : (
          <ul className={styles.list}>
            {past.map((entry) => (
              <EntryCard key={entry.id} entry={entry} courseCode={courseCode} expandLabel={m.viewDiary} canExpand {...diaryProps} />
            ))}
          </ul>
        )}
      </section>

      <section className={styles.block} aria-labelledby={`${baseId}-upcoming`}>
        <h3 id={`${baseId}-upcoming`} className={styles.heading}>
          {m.upcoming}
        </h3>
        {upcoming.length === 0 ? (
          <p className={styles.empty}>{m.noUpcoming}</p>
        ) : (
          <ul className={styles.list}>
            {upcoming.map((entry) => (
              <EntryCard key={entry.id} entry={entry} courseCode={courseCode} expandLabel={m.viewDetails} canExpand={Boolean(entry.hasContent)} {...diaryProps} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

/** The room of an in-person lesson, or the link of an online one. */
function Place({ entry }: { entry: TimelineEntry }) {
  if (entry.mode === "ONLINE" && entry.onlineUrl) {
    return (
      <p className={styles.place}>
        <a href={entry.onlineUrl} target="_blank" rel="noopener noreferrer">
          {entry.onlineUrl}
        </a>
      </p>
    );
  }
  return entry.room ? <p className={styles.place}>{entry.room}</p> : null;
}

interface EntryCardProps {
  entry: TimelineEntry;
  courseCode: string;
  classId: string;
  role: "teacher" | "student";
  loadDiary: (session: Session) => Promise<Diary>;
  loadCommands: (liveSessionId: string) => Promise<LiveTerminalCommand[]>;
  expandLabel: string;
  canExpand: boolean;
}

/** A past or upcoming lesson, folded: the day, the topic and, when there were, the commands; its diary opens under it. */
function EntryCard({ entry, courseCode, classId, role, loadDiary, loadCommands, expandLabel, canExpand }: EntryCardProps) {
  const [open, setOpen] = useState(false);
  return (
    <li className={styles.card}>
      <div className={styles.cardHead}>
        <span>
          {dayOf(entry)} · {entry.startTime}–{entry.endTime}
        </span>
        {entry.commandCount > 0 && <span className={styles.tag}>{m.commands(entry.commandCount)}</span>}
      </div>
      <h4 className={styles.topic}>{entry.topic || courseCode}</h4>
      <Place entry={entry} />
      {canExpand && (
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? m.hide : expandLabel}
          </Button>
        </div>
      )}
      {open && <SessionDiary classId={classId} session={entry} role={role} load={loadDiary} loadCommands={loadCommands} />}
    </li>
  );
}

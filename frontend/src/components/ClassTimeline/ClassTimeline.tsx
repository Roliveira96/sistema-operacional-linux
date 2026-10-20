"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
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
  /** The teacher opens the content of the lesson of a card, and changes the lesson (SPEC-073 CA-13); a button is drawn only for a handler that is given. */
  onEditContent?: (session: TimelineEntry) => void;
  onEditSession?: (session: TimelineEntry) => void;
  /** The teacher turns the current or an upcoming lesson into an assessment (SPEC-075 CA-25); a button is drawn only for a handler that is given. */
  onConvert?: (session: TimelineEntry) => void;
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
export function ClassTimeline({ classId, courseCode, role, load, loadDiary, loadCommands, liveHref, onStartLive, onEditContent, onEditSession, onConvert, reloadKey = 0 }: ClassTimelineProps) {
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
  const cardProps = { classId, courseCode, role, loadDiary, loadCommands, onEditContent, onEditSession, onConvert };

  return (
    <section className={styles.timeline} aria-label={m.region}>
      <section className={styles.block} aria-labelledby={`${baseId}-current`}>
        <h3 id={`${baseId}-current`} className={styles.heading}>
          {m.current}
        </h3>
        {current ? (
          <EntryCard
            entry={current}
            expandLabel={m.viewDetails}
            canExpand
            badge={new Date(now) >= new Date(current.startsAt) ? m.now : m.startsAt(current.startTime)}
            live={
              liveSessionId ? (
                <ButtonLink href={liveHref} variant="primary" size="md">
                  {role === "teacher" ? m.backToLive : m.enterLive}
                </ButtonLink>
              ) : role === "teacher" ? (
                onStartLive && (
                  <Button variant="primary" size="md" onClick={() => onStartLive(current)}>
                    {m.startLive}
                  </Button>
                )
              ) : (
                <p className={styles.muted}>{m.liveNotStarted}</p>
              )
            }
            {...cardProps}
          />
        ) : (
          <div className={styles.emptyBox}>
            <p className={styles.empty}>{m.none}</p>
            {next && <p className={styles.empty}>{m.next(dayOf(next), next.startTime)}</p>}
          </div>
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
              <EntryCard key={entry.id} entry={entry} expandLabel={m.viewDiary} canExpand past {...cardProps} />
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
              <EntryCard key={entry.id} entry={entry} expandLabel={m.viewDetails} canExpand={role === "teacher" || Boolean(entry.hasContent)} {...cardProps} />
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

/** The room of an in-person lesson, or the link of an online one, as a chip of the meta line of the card. */
function Place({ entry }: { entry: TimelineEntry }) {
  const online = entry.mode === "ONLINE" && entry.onlineUrl;
  if (!online && !entry.room) return null;
  return (
    <span className={styles.place}>
      {online ? (
        <a href={entry.onlineUrl} target="_blank" rel="noopener noreferrer">
          {entry.onlineUrl}
        </a>
      ) : (
        entry.room
      )}
    </span>
  );
}

/** "19" and "out", for the date block of the card; the full day is written in the meta line, so the block is only for the eye. */
function dateBlock(entry: TimelineEntry) {
  const date = parseIsoDate(entry.date);
  return { day: String(date.getDate()), month: date.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "") };
}

interface EntryCardProps {
  entry: TimelineEntry;
  courseCode: string;
  classId: string;
  role: "teacher" | "student";
  loadDiary: (session: Session) => Promise<Diary>;
  loadCommands: (liveSessionId: string) => Promise<LiveTerminalCommand[]>;
  expandLabel: string;
  /** Whether there is a diary to open: always for the current and the past lessons; for an upcoming one, for the teacher, or when it has content. */
  canExpand: boolean;
  onEditContent?: (session: TimelineEntry) => void;
  onEditSession?: (session: TimelineEntry) => void;
  onConvert?: (session: TimelineEntry) => void;
  /** The mark of the current lesson ("Agora", or the time it starts); its card is the one in evidence. */
  badge?: string;
  /** The way into the live class, or the way to start it, of the current lesson. */
  live?: ReactNode;
  /** An upcoming or past lesson: the past ones are drawn quieter. */
  past?: boolean;
}

/**
 * A lesson of the timeline: the day, the topic and, when there were, the commands. Its diary opens under it, and the teacher edits the content and
 * the lesson from its buttons, the same dialogs of the panel of the day of the calendar (SPEC-073 CA-12, CA-13).
 */
function EntryCard({ entry, courseCode, classId, role, loadDiary, loadCommands, expandLabel, canExpand, onEditContent, onEditSession, onConvert, badge, live, past }: EntryCardProps) {
  const [open, setOpen] = useState(false);
  const teacher = role === "teacher";
  const Root = badge ? "article" : "li";
  const { day, month } = dateBlock(entry);
  const topic = entry.topic || courseCode;
  const tone = badge ? `${styles.card} ${styles.current}` : past ? `${styles.card} ${styles.past}` : styles.card;
  return (
    <Root className={tone}>
      <div className={styles.date} aria-hidden="true">
        <span className={styles.dateDay}>{day}</span>
        <span className={styles.dateMonth}>{month}</span>
      </div>
      <div className={styles.body}>
        <h4 className={styles.topic} title={topic}>
          {topic}
        </h4>
        <p className={styles.meta}>
          {badge && <span className={styles.badgeNow}>{badge}</span>}
          <span>
            {dayOf(entry)} · {entry.startTime}–{entry.endTime}
          </span>
          <Place entry={entry} />
          {entry.commandCount > 0 && <span className={styles.tag}>{m.commands(entry.commandCount)}</span>}
          {entry.materialCount > 0 && <span className={styles.tag}>{m.materials(entry.materialCount)}</span>}
        </p>
      </div>
      <div className={styles.actions}>
        {live}
        {canExpand && (
          <Button variant="secondary" size="md" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? m.hide : expandLabel}
          </Button>
        )}
        {teacher && onEditContent && (
          <Button variant="secondary" size="md" onClick={() => onEditContent(entry)}>
            {m.editContent}
          </Button>
        )}
        {teacher && onEditSession && (
          <Button variant="secondary" size="md" onClick={() => onEditSession(entry)}>
            {m.editSession}
          </Button>
        )}
        {teacher && onConvert && !past && (
          <Button variant="secondary" size="md" onClick={() => onConvert(entry)}>
            {messages.assessments.convert}
          </Button>
        )}
      </div>
      {open && (
        <div className={styles.diary}>
          <SessionDiary classId={classId} session={entry} role={role} load={loadDiary} loadCommands={loadCommands} showEmpty />
        </div>
      )}
    </Root>
  );
}

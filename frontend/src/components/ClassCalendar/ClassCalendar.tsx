"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addMonths, isoDate, monthGrid, sameDay } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type {
  CalendarData,
  ClassEvent,
  Session,
  SessionContent,
  SpecialPeriod,
} from "@/services/scheduleService";
import styles from "./ClassCalendar.module.scss";

export interface ClassCalendarProps {
  load: (from: string, to: string) => Promise<CalendarData>;
  initialMonth?: Date;
  today?: Date;
  editable?: boolean;
  reloadKey?: number;
  showClassFilter?: boolean;
  classHref?: (classId: string) => string;
  settingsHref?: string;
  onEditSession?: (session: Session) => void;
  onAddSession?: (date: string) => void;
  onAddEvent?: (date: string) => void;
  onEditEvent?: (event: ClassEvent) => void;
  onDeletePeriod?: (period: SpecialPeriod) => void;
  onSelectPeriod?: (firstDay: string, lastDay: string) => void;
  /** Reads what a lesson covers; the panel shows it for the lessons that have content (SPEC-053). */
  loadContent?: (session: Session) => Promise<SessionContent>;
  onEditContent?: (session: Session) => void;
  /** Starts the live class from the lesson; gets the name of the class, the title when the lesson has no topic (SPEC-053 CA-11). */
  onStartLive?: (session: Session, className: string) => void;
}

/** What a lesson covers: topic, description, links, module and presentation, for whoever reads the lesson (SPEC-053, 3.1). */
function SessionContentBlock({ session, load }: { session: Session; load: (session: Session) => Promise<SessionContent> }) {
  const [content, setContent] = useState<SessionContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    load(session).then(
      (loaded) => active && setContent(loaded),
      () => active && setFailed(true),
    );
    return () => {
      active = false;
    };
  }, [session, load]);

  if (failed) return <div className={styles.itemMeta}>{messages.schedule.calendar.contentLoadError}</div>;
  if (!content) return null;
  return (
    <div className={styles.content}>
      {content.topic && <h4 className={styles.contentTopic}>{content.topic}</h4>}
      {content.description && (
        // HTML filtered by the server when it was saved (SPEC-053 RN-01).
        <div className={styles.contentText} dangerouslySetInnerHTML={{ __html: content.description }} />
      )}
      {content.links.length > 0 && (
        <ul className={styles.contentLinks}>
          {content.links.map((link) => (
            <li key={`${link.url}-${link.name}`}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {content.module && <Link href={`/app/modules/${content.module.id}`}>{content.module.title}</Link>}
      {content.deck && (
        <a href={content.deck.downloadUrl} target="_blank" rel="noopener noreferrer">
          {messages.schedule.calendar.viewDeck}
        </a>
      )}
    </div>
  );
}

const MONTH_NAMES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

export function ClassCalendar({
  load,
  initialMonth = new Date(),
  today = new Date(),
  editable = false,
  reloadKey = 0,
  showClassFilter = false,
  classHref,
  settingsHref,
  onEditSession,
  onAddSession,
  onAddEvent,
  onEditEvent,
  onDeletePeriod,
  onSelectPeriod,
  loadContent,
  onEditContent,
  onStartLive,
}: ClassCalendarProps) {
  const [currentDate, setCurrentDate] = useState<Date>(
    new Date(initialMonth.getFullYear(), initialMonth.getMonth(), 1),
  );
  const [data, setData] = useState<CalendarData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<string>("");

  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<string | null>(null);

  const dayButtonsRef = useRef<(HTMLButtonElement | null)[]>([]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const days = monthGrid(year, month);
  const fromIso = isoDate(days[0]!);
  const toIso = isoDate(days[days.length - 1]!);

  const [localReload, setLocalReload] = useState(0);

  useEffect(() => {
    let active = true;
    load(fromIso, toIso)
      .then((res) => {
        if (active) {
          setData(res);
          setError(null);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(messages.schedule.calendar.loadError);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [load, fromIso, toIso, reloadKey, localReload]);

  const handlePrevMonth = () => {
    setLoading(true);
    setCurrentDate((d) => addMonths(d, -1));
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    setLoading(true);
    setCurrentDate((d) => addMonths(d, 1));
    setSelectedDay(null);
  };

  const handleToday = () => {
    setLoading(true);
    setCurrentDate(new Date(today.getFullYear(), today.getMonth(), 1));
    setSelectedDay(today);
  };

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    setLocalReload((n) => n + 1);
  };

  const handleDayKeyDown = (index: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
    let targetIndex = -1;
    if (e.key === "ArrowRight") targetIndex = index + 1;
    else if (e.key === "ArrowLeft") targetIndex = index - 1;
    else if (e.key === "ArrowDown") targetIndex = index + 7;
    else if (e.key === "ArrowUp") targetIndex = index - 7;

    if (targetIndex >= 0 && targetIndex < days.length) {
      e.preventDefault();
      dayButtonsRef.current[targetIndex]?.focus();
    }
  };

  const handleDayClick = (day: Date) => {
    const dIso = isoDate(day);
    if (isSelecting) {
      if (!selectionStart) {
        setSelectionStart(dIso);
      } else {
        const first = selectionStart <= dIso ? selectionStart : dIso;
        const last = selectionStart <= dIso ? dIso : selectionStart;
        onSelectPeriod?.(first, last);
        setIsSelecting(false);
        setSelectionStart(null);
      }
    } else {
      setSelectedDay(day);
    }
  };

  const cancelSelection = () => {
    setIsSelecting(false);
    setSelectionStart(null);
  };

  // Filter data by selected class if filter is active
  const filteredClasses = data?.classes.filter(
    (c) => !selectedClassId || c.id === selectedClassId,
  ) ?? [];

  const filteredClassIds = new Set(filteredClasses.map((c) => c.id));

  const filteredSessions =
    data?.sessions.filter(
      (s) => !selectedClassId || s.classId === selectedClassId || filteredClassIds.has(s.classId),
    ) ?? [];

  const filteredMeetings =
    data?.meetings?.filter(
      (m) => !selectedClassId || (m.classId && filteredClassIds.has(m.classId)),
    ) ?? [];

  const filteredEvents =
    data?.events.filter(
      (e) => !selectedClassId || e.classId === selectedClassId || filteredClassIds.has(e.classId),
    ) ?? [];

  const filteredPeriods =
    data?.periods.filter(
      (p) => !selectedClassId || p.classId === selectedClassId || filteredClassIds.has(p.classId),
    ) ?? [];

  const holidays = data?.holidays.filter((h) => h.active) ?? [];

  // Indicators
  const monthStartIso = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const monthEndIso = isoDate(new Date(year, month + 1, 0));

  const sessionsInMonth = filteredSessions.filter(
    (s) => s.date >= monthStartIso && s.date <= monthEndIso && s.status === "SCHEDULED",
  ).length;

  const holidaysInMonth = holidays.filter(
    (h) => h.date >= monthStartIso && h.date <= monthEndIso,
  ).length;

  const lessonsPerWeek = filteredMeetings.reduce(
    (sum, m) => sum + (m.lessonCount || 0),
    0,
  );

  const isEmpty =
    !loading &&
    !error &&
    data &&
    data.sessions.length === 0 &&
    (data.meetings?.length ?? 0) === 0 &&
    data.events.length === 0 &&
    data.periods.length === 0;

  if (error) {
    return (
      <div className={styles.errorState}>
        <div className={styles.errorText}>{error}</div>
        <button type="button" onClick={handleRetry} className={styles.navBtn}>
          {messages.schedule.calendar.retry}
        </button>
      </div>
    );
  }

  if (isEmpty && settingsHref) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyText}>{messages.schedule.calendar.noMeetings}</div>
        <Link href={settingsHref} className={styles.linkBtn}>
          {messages.schedule.calendar.addMeetings}
        </Link>
      </div>
    );
  }

  const selectedDayIso = selectedDay ? isoDate(selectedDay) : null;
  const selectedDaySessions = selectedDayIso
    ? filteredSessions.filter((s) => s.date === selectedDayIso)
    : [];
  const selectedDayEvents = selectedDayIso
    ? filteredEvents.filter((e) => e.date === selectedDayIso)
    : [];
  const selectedDayPeriods = selectedDayIso
    ? filteredPeriods.filter(
        (p) => p.firstDay <= selectedDayIso && selectedDayIso <= p.lastDay,
      )
    : [];
  const selectedDayHolidays = selectedDayIso
    ? holidays.filter((h) => h.date === selectedDayIso)
    : [];

  const selectedDayWeekday = selectedDay
    ? (messages.schedule.weekdays[selectedDay.getDay()] ?? "").toLowerCase()
    : "";
  const selectedDayPanelTitle = selectedDay
    ? `${selectedDayWeekday}, ${selectedDay.getDate()} de ${MONTH_NAMES[selectedDay.getMonth()]} de ${selectedDay.getFullYear()}`
    : "";

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleArea}>
          <h2 className={styles.monthHeading}>
            {MONTH_NAMES[month]} de {year}
          </h2>
          <div className={styles.navButtons}>
            <button
              type="button"
              className={styles.navBtn}
              onClick={handlePrevMonth}
              aria-label={messages.schedule.calendar.previous}
            >
              {messages.schedule.calendar.previous}
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={handleToday}
            >
              {messages.schedule.calendar.today}
            </button>
            <button
              type="button"
              className={styles.navBtn}
              onClick={handleNextMonth}
              aria-label={messages.schedule.calendar.next}
            >
              {messages.schedule.calendar.next}
            </button>
          </div>
        </div>

        <div className={styles.controls}>
          {showClassFilter && data && data.classes.length > 0 && (
            <div className={styles.filterGroup}>
              <label htmlFor="calendar-class-filter">
                {messages.schedule.calendar.filter}
              </label>
              <select
                id="calendar-class-filter"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
              >
                <option value="">{messages.schedule.calendar.allClasses}</option>
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {editable && onSelectPeriod && (
            <div>
              {isSelecting ? (
                <button
                  type="button"
                  className={styles.actionBtnActive}
                  onClick={cancelSelection}
                >
                  {messages.schedule.calendar.cancelSelection}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setIsSelecting(true)}
                >
                  {messages.schedule.calendar.selectPeriod}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isSelecting && (
        <div className={styles.selectionPrompt}>
          {!selectionStart
            ? messages.schedule.calendar.pickFirst
            : messages.schedule.calendar.pickLast}
        </div>
      )}

      <ul className={styles.indicators} aria-label={messages.schedule.calendar.indicators}>
        <li className={styles.indicatorItem}>
          <span className={styles.indicatorLabel}>
            {messages.schedule.calendar.sessionsInMonth}
          </span>
          <span className={styles.indicatorValue}>{sessionsInMonth}</span>
        </li>
        <li className={styles.indicatorItem}>
          <span className={styles.indicatorLabel}>
            {messages.schedule.calendar.holidaysInMonth}
          </span>
          <span className={styles.indicatorValue}>{holidaysInMonth}</span>
        </li>
        <li className={styles.indicatorItem}>
          <span className={styles.indicatorLabel}>
            {messages.schedule.calendar.lessonsPerWeek}
          </span>
          <span className={styles.indicatorValue}>{lessonsPerWeek}</span>
        </li>
      </ul>

      <div className={styles.gridWrapper}>
        <div className={styles.weekdaysHeader}>
          {messages.schedule.weekdaysShort.map((dayName, idx) => (
            <div key={idx} className={styles.weekdayCol}>
              {dayName}
            </div>
          ))}
        </div>

        <div className={styles.grid}>
          {days.map((day, idx) => {
            const dIso = isoDate(day);
            const isToday = sameDay(day, today);
            const isCurrentMonth = day.getMonth() === month;

            // Milestones
            const isClassStart = filteredClasses.some((c) => c.startDate === dIso);
            const isClassEnd = filteredClasses.some((c) => c.endDate === dIso);

            // Holidays
            const dayHolidays = holidays.filter((h) => h.date === dIso);

            // Sessions
            const daySessions = filteredSessions.filter((s) => s.date === dIso);
            const canceledSessions = daySessions.filter((s) => s.status === "CANCELED");
            const scheduledSessions = daySessions.filter((s) => s.status === "SCHEDULED");
            const hasOnlineSession = daySessions.some((s) => s.mode === "ONLINE");

            // Events
            const dayEvents = filteredEvents.filter((e) => e.date === dIso);

            // Periods
            const dayPeriods = filteredPeriods.filter(
              (p) => p.firstDay <= dIso && dIso <= p.lastDay,
            );

            // Compose aria-label
            const weekdayName = (messages.schedule.weekdays[day.getDay()] ?? "").toLowerCase();
            const dayNum = day.getDate();
            const monthName = MONTH_NAMES[day.getMonth()];
            const labelParts: string[] = [`${weekdayName}, ${dayNum} de ${monthName}`];

            if (isClassStart) labelParts.push(messages.schedule.calendar.start);
            if (isClassEnd) labelParts.push(messages.schedule.calendar.end);

            dayHolidays.forEach((h) => {
              labelParts.push(messages.schedule.calendar.holiday(h.name));
            });

            if (canceledSessions.length > 0) {
              labelParts.push(messages.schedule.calendar.canceled(canceledSessions.length));
            } else if (scheduledSessions.length > 0) {
              labelParts.push(messages.schedule.calendar.sessions(scheduledSessions.length));
            }

            if (hasOnlineSession) {
              labelParts.push(messages.schedule.calendar.online);
            }

            dayEvents.forEach((e) => {
              labelParts.push(messages.schedule.calendar.event(e.title));
            });

            dayPeriods.forEach((p) => {
              labelParts.push(p.label);
            });

            const ariaLabel = labelParts.join(", ");

            return (
              <button
                key={dIso}
                ref={(el) => {
                  dayButtonsRef.current[idx] = el;
                }}
                type="button"
                className={`${styles.dayCell} ${!isCurrentMonth ? styles.otherMonth : ""}`}
                aria-label={ariaLabel}
                aria-current={isToday ? "date" : undefined}
                data-on-holiday={dayHolidays.length > 0 ? "true" : undefined}
                onClick={() => handleDayClick(day)}
                onKeyDown={(e) => handleDayKeyDown(idx, e)}
              >
                <span className={styles.dayNumber}>{dayNum}</span>

                <div className={styles.badges}>
                  {isClassStart && (
                    <span className={`${styles.badge} ${styles.badgeMilestone}`}>
                      {messages.schedule.calendar.start}
                    </span>
                  )}
                  {isClassEnd && (
                    <span className={`${styles.badge} ${styles.badgeMilestone}`}>
                      {messages.schedule.calendar.end}
                    </span>
                  )}

                  {dayHolidays.map((h) => (
                    <span
                      key={h.id}
                      className={`${styles.badge} ${styles.badgeHoliday}`}
                    >
                      {h.name}
                    </span>
                  ))}

                  {daySessions.map((s) => {
                    const cls = filteredClasses.find((c) => c.id === s.classId);
                    return (
                      <span
                        key={s.id}
                        className={styles.sessionItem}
                        data-status={s.status}
                        data-color={cls?.color ?? "orange"}
                      >
                        {s.topic ?? cls?.courseCode ?? "AULA"}
                      </span>
                    );
                  })}

                  {dayEvents.map((e) => (
                    <span
                      key={e.id}
                      className={`${styles.badge} ${styles.badgeEvent}`}
                    >
                      {e.title}
                    </span>
                  ))}

                  {dayPeriods.map((p) => (
                    <span
                      key={p.id}
                      className={`${styles.badge} ${styles.badgePeriod}`}
                    >
                      {p.label}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <ul className={styles.legend} aria-label={messages.schedule.calendar.legend}>
        <li className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ backgroundColor: "var(--color-success)" }}
          />
          {messages.schedule.calendar.legendMilestone}
        </li>
        <li className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ backgroundColor: "var(--color-warning)" }}
          />
          {messages.schedule.calendar.legendHoliday}
        </li>
        <li className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ backgroundColor: "var(--color-danger)" }}
          />
          {messages.schedule.calendar.legendCanceled}
        </li>
        <li className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ backgroundColor: "var(--color-info)" }}
          />
          {messages.schedule.calendar.legendOnline}
        </li>
        <li className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ backgroundColor: "var(--color-info-text)" }}
          />
          {messages.schedule.calendar.legendEvent}
        </li>
        <li className={styles.legendItem}>
          <span
            className={styles.legendDot}
            style={{ backgroundColor: "var(--color-accent)" }}
          />
          {messages.schedule.calendar.legendPeriod}
        </li>
      </ul>

      {selectedDay && (
        <section
          role="region"
          aria-label={selectedDayPanelTitle}
          className={styles.dayPanel}
        >
          <div className={styles.dayPanelHeader}>
            <h3 className={styles.dayPanelTitle}>{selectedDayPanelTitle}</h3>
            {editable && (
              <div className={styles.panelActions}>
                {onAddSession && (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => onAddSession(selectedDayIso!)}
                  >
                    {messages.schedule.calendar.addSession}
                  </button>
                )}
                {onAddEvent && (
                  <button
                    type="button"
                    className={styles.actionBtn}
                    onClick={() => onAddEvent(selectedDayIso!)}
                  >
                    {messages.schedule.calendar.addEvent}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className={styles.itemsList}>
            {selectedDayHolidays.map((h) => (
              <div key={h.id} className={styles.itemCard}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemTitle}>{h.name}</span>
                  <div className={styles.itemMeta}>
                    <span className={`${styles.tag} ${styles.tagHoliday}`}>
                      {messages.schedule.calendar.holidayBadge}
                    </span>
                  </div>
                </div>
              </div>
            ))}

            {selectedDayPeriods.map((p) => (
              <div key={p.id} className={styles.itemCard}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemTitle}>{p.label}</span>
                </div>
                {editable && onDeletePeriod && (
                  <button
                    type="button"
                    className={styles.navBtn}
                    onClick={() => onDeletePeriod(p)}
                  >
                    {messages.schedule.calendar.deletePeriod}
                  </button>
                )}
              </div>
            ))}

            {selectedDaySessions.map((s) => {
              const cls = filteredClasses.find((c) => c.id === s.classId);
              return (
                <div key={s.id} className={styles.itemCard}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemTitle}>
                      {cls?.name ?? "Turma"} ({cls?.courseCode ?? ""})
                    </span>
                    <div className={styles.itemMeta}>
                      <span>
                        {s.startTime} - {s.endTime}
                      </span>
                      {s.room && <span>· Sala {s.room}</span>}
                      {s.onlineUrl && (
                        <span>
                          ·{" "}
                          <a
                            href={s.onlineUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Link
                          </a>
                        </span>
                      )}
                      {s.status === "CANCELED" && (
                        <span className={`${styles.tag} ${styles.tagCanceled}`}>
                          {messages.schedule.calendar.canceledBadge}
                        </span>
                      )}
                      {s.mode === "ONLINE" && (
                        <span className={`${styles.tag} ${styles.tagOnline}`}>
                          {messages.schedule.calendar.onlineBadge}
                        </span>
                      )}
                      {s.origin === "EXTRA" && (
                        <span className={`${styles.tag} ${styles.tagExtra}`}>
                          {messages.schedule.calendar.extraBadge}
                        </span>
                      )}
                      {s.overridden && (
                        <span className={`${styles.tag} ${styles.tagOverridden}`}>
                          {messages.schedule.calendar.changedBadge}
                        </span>
                      )}
                      {s.onHoliday && (
                        <span className={`${styles.tag} ${styles.tagHoliday}`}>
                          {messages.schedule.calendar.holidayBadge}
                        </span>
                      )}
                    </div>
                    {s.changeReason && (
                      <div className={styles.itemMeta}>{s.changeReason}</div>
                    )}
                    {loadContent && s.hasContent && <SessionContentBlock session={s} load={loadContent} />}
                  </div>

                  <div className={styles.panelActions}>
                    {classHref && cls && (
                      <Link
                        href={classHref(cls.id)}
                        className={styles.navBtn}
                      >
                        {messages.schedule.calendar.openClass(cls.name)}
                      </Link>
                    )}
                    {editable && onEditSession && (
                      <button
                        type="button"
                        className={styles.navBtn}
                        onClick={() => onEditSession(s)}
                      >
                        {messages.schedule.calendar.editSession}
                      </button>
                    )}
                    {editable && onEditContent && (
                      <button
                        type="button"
                        className={styles.navBtn}
                        onClick={() => onEditContent(s)}
                      >
                        {messages.schedule.calendar.editContent}
                      </button>
                    )}
                    {editable && onStartLive && s.status !== "CANCELED" && (
                      <button
                        type="button"
                        className={styles.navBtn}
                        onClick={() => onStartLive(s, cls?.name ?? "")}
                      >
                        {messages.schedule.calendar.startLive}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {selectedDayEvents.map((e) => (
              <div key={e.id} className={styles.itemCard}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemTitle}>{e.title}</span>
                  {e.description && (
                    <div className={styles.itemMeta}>{e.description}</div>
                  )}
                  <div className={styles.itemMeta}>
                    {e.allDay ? (
                      <span>{messages.schedule.calendar.allDay}</span>
                    ) : (
                      <span>
                        {e.startTime} - {e.endTime}
                      </span>
                    )}
                    {e.location && <span>· {e.location}</span>}
                    {e.onlineUrl && (
                      <span>
                        ·{" "}
                        <a
                          href={e.onlineUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Link
                        </a>
                      </span>
                    )}
                  </div>
                </div>

                {editable && onEditEvent && (
                  <button
                    type="button"
                    className={styles.navBtn}
                    onClick={() => onEditEvent(e)}
                  >
                    {messages.schedule.calendar.editEvent}
                  </button>
                )}
              </div>
            ))}

            {selectedDaySessions.length === 0 &&
              selectedDayEvents.length === 0 &&
              selectedDayHolidays.length === 0 &&
              selectedDayPeriods.length === 0 && (
                <div className={styles.emptyText}>
                  {messages.schedule.calendar.dayPanelEmpty}
                </div>
              )}
          </div>
        </section>
      )}
    </div>
  );
}

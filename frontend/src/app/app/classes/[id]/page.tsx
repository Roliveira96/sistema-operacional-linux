"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AddStudentsDialog } from "@/components/AddStudentsDialog/AddStudentsDialog";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { ClassCalendar } from "@/components/ClassCalendar/ClassCalendar";
import { ClassLinks } from "@/components/ClassLinks/ClassLinks";
import { ClassTimeline } from "@/components/ClassTimeline/ClassTimeline";
import { LiveClassPanel } from "@/components/Classroom/LiveClassPanel/LiveClassPanel";
import { ClassMembersTable } from "@/components/ClassMembersTable/ClassMembersTable";
import { EventForm } from "@/components/EventForm/EventForm";
import { InviteLinkCard } from "@/components/InviteLinkCard/InviteLinkCard";
import { PeriodForm } from "@/components/PeriodForm/PeriodForm";
import { SessionContentForm } from "@/components/SessionContentForm/SessionContentForm";
import { SessionForm } from "@/components/SessionForm/SessionForm";
import { StudentFormModal } from "@/components/StudentFormModal/StudentFormModal";
import { StudentImportCsvModal } from "@/components/StudentImportCsvModal/StudentImportCsvModal";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassGroup, type ClassMember, type StudentClass } from "@/services/classService";
import {
  type CalendarData,
  type ClassEvent,
  type EventInput,
  type PeriodInput,
  scheduleService,
  type Session,
  type SessionInput,
  startLiveFromSession,
  type SpecialPeriod,
} from "@/services/scheduleService";
import { classroomService } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import {
  IconBook,
  IconCalendar,
  IconChevronRight,
  IconClock,
  IconFileUp,
  IconGraduationCap,
  IconLayout,
  IconLink,
  IconPlus,
  IconSearch,
  IconSettings,
  IconShield,
  IconUser,
  IconUserCheck,
  IconUserPlus,
  IconUsers,
  IconVideo,
} from "./icons";
import styles from "./page.module.scss";

const m = messages.classes.page;
const DAY_MS = 24 * 60 * 60 * 1000;

type Tab = "overview" | "schedule" | "students";
type LoadState = "loading" | "ready" | "notFound" | "error";
/** The fields of a class shown on its overview, read by the teacher or by an enrolled student. */
type Presentation = Pick<
  ClassGroup,
  | "id"
  | "name"
  | "courseCode"
  | "semester"
  | "status"
  | "summary"
  | "syllabus"
  | "institutionalGuidelines"
  | "startDate"
  | "endDate"
  | "scheduleDescription"
  | "enableVirtualClassroom"
> & { teacherName?: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR");
}

/** How far the class is in its validity window, for the progress bar of the overview. */
function validityProgress(startIso: string, endIso: string, now: Date) {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const at = now.getTime();
  if (at < start) return { percent: 0, label: m.notStarted };
  if (at > end) return { percent: 100, label: m.ended };
  const percent = end > start ? Math.round(((at - start) / (end - start)) * 100) : 100;
  return { percent, label: m.daysLeft(Math.ceil((end - at) / DAY_MS)) };
}

function DetailRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className={styles.detail}>
      <span className={styles.detailIcon}>{icon}</span>
      <div className={styles.detailBody}>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  );
}

function RichSection({ id, icon, title, html }: { id: string; icon: ReactNode; title: string; html?: string }) {
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <header className={styles.panelHeader}>
        <span className={styles.panelIcon}>{icon}</span>
        <h2 id={id} className={styles.panelTitle}>
          {title}
        </h2>
      </header>
      {html ? (
        // HTML filtered by the server when it was saved (SPEC-041 RN-02).
        <div className={styles.richText} dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className={styles.muted}>{m.notInformed}</p>
      )}
    </section>
  );
}

function Overview({ data, editableLinks, history, role }: { data: Presentation; editableLinks: boolean; history?: ClassGroup; role: "teacher" | "student" }) {
  const progress = validityProgress(data.startDate, data.endDate, new Date());
  return (
    <div className={styles.overview}>
      <div className={styles.mainColumn}>
        <LiveClassPanel classId={data.id} role={role} archived={data.status === "ARCHIVED"} />
        <ClassLinks classId={data.id} editable={editableLinks} />
        <RichSection id="syllabus-title" icon={<IconBook />} title={m.syllabus} html={data.syllabus} />
        <RichSection id="guidelines-title" icon={<IconShield />} title={m.guidelines} html={data.institutionalGuidelines} />
      </div>

      <aside className={`${styles.panel} ${styles.sideColumn}`} aria-labelledby="details-title">
        <h2 id="details-title" className={styles.panelTitle}>
          {m.details}
        </h2>
        <dl className={styles.details}>
          <DetailRow icon={<IconCalendar />} label={m.validity}>
            <span>{m.validityRange(formatDate(data.startDate), formatDate(data.endDate))}</span>
            <span
              className={styles.progress}
              role="progressbar"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={m.validity}
            >
              <span className={styles.progressFill} style={{ width: `${progress.percent}%` }} />
            </span>
            <span className={styles.progressLabel}>{progress.label}</span>
          </DetailRow>
          <DetailRow icon={<IconClock />} label={m.schedule}>
            {data.scheduleDescription || <span className={styles.muted}>{m.notInformed}</span>}
          </DetailRow>
          <DetailRow icon={<IconVideo />} label={m.virtual}>
            {data.enableVirtualClassroom ? m.yes : m.no}
          </DetailRow>
          {data.teacherName && (
            <DetailRow icon={<IconUser />} label={m.teacher}>
              {data.teacherName}
            </DetailRow>
          )}
        </dl>
        {history && <History data={history} />}
      </aside>
    </div>
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Who created, updated and archived the class, and when, for the teacher and the administrator (SPEC-049). */
function History({ data }: { data: ClassGroup }) {
  const h = m.history;
  const wasUpdated = new Date(data.updatedAt).getTime() - new Date(data.createdAt).getTime() > 1000;
  return (
    <section aria-labelledby="history-title" className={styles.history}>
      <h3 id="history-title" className={styles.historyTitle}>
        {h.title}
      </h3>
      <ul className={styles.historyList}>
        <li>{h.created(data.createdByName || h.removedUser, formatDateTime(data.createdAt))}</li>
        {wasUpdated && <li>{h.updated(data.updatedByName || h.removedUser, formatDateTime(data.updatedAt))}</li>}
        {data.archivedAt && (
          <li>
            {h.archived(data.archivedByName || h.removedUser, formatDateTime(data.archivedAt))}
            {data.archiveReason && <span className={styles.historyReason}>{h.reason(data.archiveReason)}</span>}
          </li>
        )}
      </ul>
    </section>
  );
}

function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone?: "attention" }) {
  return (
    <div className={`${styles.stat} ${tone === "attention" ? styles.statAttention : ""}`}>
      <span className={styles.statIcon}>{icon}</span>
      <div className={styles.statBody}>
        <span className={styles.statValue}>{value}</span>
        <span className={styles.statLabel}>{label}</span>
      </div>
    </div>
  );
}

function PathCard({
  icon,
  title,
  help,
  helpId,
  onClick,
  recommended,
}: {
  icon: ReactNode;
  title: string;
  help: string;
  helpId: string;
  onClick: () => void;
  recommended?: boolean;
}) {
  return (
    <div className={`${styles.pathCard} ${recommended ? styles.pathRecommended : ""}`}>
      <span className={styles.pathIcon}>{icon}</span>
      {recommended && <span className={styles.pathTag}>{m.recommended}</span>}
      <button type="button" className={styles.pathButton} onClick={onClick} aria-describedby={helpId}>
        {title}
      </button>
      <p id={helpId} className={styles.pathHelp}>
        {help}
      </p>
      <span className={styles.pathChevron}>
        <IconChevronRight />
      </span>
    </div>
  );
}

/**
 * Page of a class (SPEC-041, section 3.1.1): the teacher sees the overview and the students tab, where students are
 * added; an enrolled student sees only the presentation of the class.
 */
export default function ClassPage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isStudent = user.role === "STUDENT";
  const paramTab = searchParams.get("tab");
  const tab: Tab =
    paramTab === "schedule"
      ? "schedule"
      : !isStudent && paramTab === "students"
        ? "students"
        : "overview";
  const justCreated = searchParams.get("created") === "1";

  const [id, setId] = useState<string | null>(null);
  const [classData, setClassData] = useState<ClassGroup | null>(null);
  const [studentClass, setStudentClass] = useState<StudentClass | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reload, setReload] = useState(0);
  const [calendarReload, setCalendarReload] = useState(0);
  const [liveRoom, setLiveRoom] = useState<{ title: string; classSessionId: string | null } | null>(null);
  const [cachedCalendar, setCachedCalendar] = useState<CalendarData | null>(null);
  const [editingSession, setEditingSession] = useState<Session | null>(null);
  const [contentSession, setContentSession] = useState<Session | null>(null);
  const [liveError, setLiveError] = useState(false);
  const [extraSessionDate, setExtraSessionDate] = useState<string | null>(null);
  const [editingEvent, setEditingEvent] = useState<ClassEvent | null>(null);
  const [eventDate, setEventDate] = useState<string | null>(null);
  const [selectedPeriodRange, setSelectedPeriodRange] = useState<{ first: string; last: string } | null>(null);
  const [membersTab, setMembersTab] = useState<"ACTIVE" | "PENDING_MODERATION">("ACTIVE");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newStudentOpen, setNewStudentOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const loadCalendar = useCallback(
    async (from: string, to: string) => {
      if (!id) return { classes: [], sessions: [], events: [], periods: [], holidays: [], meetings: [] };
      const res = await scheduleService.classCalendar(id, from, to);
      setCachedCalendar(res);
      return res;
    },
    [id],
  );

  const loadContent = useCallback((s: Session) => scheduleService.getSessionContent(id ?? "", s.id), [id]);
  // The timeline and the diary of the lessons (SPEC-073); stable, so the components do not read them again at every render.
  const loadTimeline = useCallback(() => scheduleService.timeline(id ?? ""), [id]);
  const loadDiary = useCallback((s: Session) => scheduleService.getDiary(id ?? "", s.id), [id]);
  const loadCommands = useCallback((liveSessionId: string) => classroomService.listCommands(id ?? "", liveSessionId), [id]);

  const handleStartLive = (s: Session, className: string) => {
    if (!id) return;
    setLiveError(false);
    startLiveFromSession(id, s, className).then(
      () => router.push(`/app/classes/${id}/live`),
      () => setLiveError(true),
    );
  };

  const handleUpdateSession = async (payload: SessionInput) => {
    if (!id || !editingSession) return;
    await scheduleService.updateSession(id, editingSession.id, payload);
    setCalendarReload((n) => n + 1);
  };

  const handleRevertSession = async () => {
    if (!id || !editingSession) return;
    await scheduleService.revertSession(id, editingSession.id);
    setCalendarReload((n) => n + 1);
  };

  const handleDeleteSession = async () => {
    if (!id || !editingSession) return;
    await scheduleService.deleteSession(id, editingSession.id);
    setCalendarReload((n) => n + 1);
  };

  const handleCreateExtraSession = async (payload: SessionInput) => {
    if (!id) return;
    await scheduleService.createSession(id, payload);
    setCalendarReload((n) => n + 1);
  };

  const handleSaveEvent = async (payload: EventInput) => {
    if (!id) return;
    if (editingEvent) {
      await scheduleService.updateEvent(id, editingEvent.id, payload);
    } else {
      await scheduleService.createEvent(id, payload);
    }
    setCalendarReload((n) => n + 1);
  };

  const handleDeleteEvent = async () => {
    if (!id || !editingEvent) return;
    await scheduleService.deleteEvent(id, editingEvent.id);
    setCalendarReload((n) => n + 1);
  };

  const handleApplyPeriod = async (payload: PeriodInput) => {
    if (!id) return;
    await scheduleService.applyPeriod(id, payload);
    setCalendarReload((n) => n + 1);
  };

  const handleDeletePeriod = async (period: SpecialPeriod) => {
    if (!id) return;
    await scheduleService.deletePeriod(id, period.id);
    setCalendarReload((n) => n + 1);
  };

  const countAffected = (first: string, last: string) => {
    if (!cachedCalendar) return 0;
    return cachedCalendar.sessions.filter(
      (s) => s.origin === "WEEKLY" && !s.overridden && s.date >= first && s.date <= last,
    ).length;
  };

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((p) => {
      if (active) setId(p.id);
    });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    const load = isStudent
      ? classService.getMyClass(id).then((data) => {
          if (active) setStudentClass(data);
        })
      : Promise.all([classService.getClass(id), classService.listMembers(id)]).then(([data, list]) => {
          if (active) {
            setClassData(data);
            setMembers(list);
          }
        });
    load
      .then(() => {
        if (active) setLoadState("ready");
      })
      .catch((err: unknown) => {
        if (!active) return;
        const missing = err instanceof ApiProblemError && (err.status === 404 || err.status === 403);
        setLoadState(missing ? "notFound" : "error");
      });
    return () => {
      active = false;
    };
  }, [id, isStudent, reload]);

  // The live class that is going on, for the notice of the Agenda tab (SPEC-053 CA-14); a failure only hides the notice.
  useEffect(() => {
    if (!id || tab !== "schedule") return;
    let active = true;
    classroomService
      .getActive(id)
      .then((room) => {
        if (!active) return;
        setLiveRoom(room.hasActiveSession ? { title: room.session.title, classSessionId: room.session.classSessionId ?? null } : null);
      })
      .catch(() => {
        if (active) setLiveRoom(null);
      });
    return () => {
      active = false;
    };
  }, [id, tab, calendarReload]);

  const refresh = () => setReload((n) => n + 1);

  const retry = () => {
    setLoadState("loading");
    refresh();
  };

  const changeTab = (next: Tab) => {
    if (id) router.replace(`/app/classes/${id}?tab=${next}`, { scroll: false });
  };

  const closeDialog = () => {
    setDialogOpen(false);
    addButtonRef.current?.focus();
  };

  const openNewStudent = () => {
    setDialogOpen(false);
    setNewStudentOpen(true);
  };

  const openCsv = () => {
    setDialogOpen(false);
    setCsvOpen(true);
  };

  const moderate = async (memberId: string, approve: boolean, reason?: string) => {
    if (!id) return;
    try {
      await classService.moderateMember(id, memberId, approve, reason);
      setFeedback(approve ? messages.classes.members.approveSuccess : messages.classes.members.rejectSuccess);
      refresh();
    } catch {
      setFeedback(messages.classes.addStudents.error);
    }
  };

  if (loadState === "loading") {
    return (
      <main className={styles.container} aria-busy="true">
        <div className={styles.skeletonHero} />
        <div className={styles.skeletonLine} />
        <p className={styles.srOnly} role="status">
          {m.loading}
        </p>
      </main>
    );
  }

  if (loadState === "notFound" || loadState === "error") {
    return (
      <main className={styles.container}>
        <div className={styles.problem} role="alert">
          <p>{loadState === "notFound" ? m.notFound : m.loadError}</p>
          <div className={styles.problemActions}>
            {loadState === "error" && (
              <button type="button" className={styles.secondaryButton} onClick={retry}>
                {m.retry}
              </button>
            )}
            <Link href={isStudent ? "/app" : "/app/classes"} className={styles.link}>
              {m.backToClasses}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const data: Presentation | null = isStudent ? studentClass : classData;
  if (!data) return null;

  const active = members.filter((mb) => mb.status === "ACTIVE");
  const pending = members.filter((mb) => mb.status === "PENDING_MODERATION");
  const memberIds = [...active, ...pending].map((mb) => mb.userId);
  const fixedClass = { id: data.id, name: data.name };
  const statusKey = data.status.toLowerCase();

  return (
    <main className={styles.container}>
      {!isStudent && (
        <nav aria-label={m.breadcrumbLabel} className={styles.breadcrumb}>
          <Link href="/app/classes">{m.breadcrumbRoot}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{data.name}</span>
        </nav>
      )}

      <header className={styles.hero}>
        <span className={`${styles.heroAccent} ${styles[statusKey]}`} aria-hidden="true" />
        <div className={styles.heroTop}>
          <div className={styles.heroMeta}>
            <span className={styles.courseIcon}>
              <IconGraduationCap />
            </span>
            <span className={styles.courseCode}>
              {data.courseCode} • {data.semester}
            </span>
            <span className={`${styles.badge} ${styles[statusKey]}`}>
              <span className={styles.statusDot} aria-hidden="true" />
              {messages.classes.statusBadge[data.status]}
            </span>
          </div>
          {!isStudent && (
            <Link href={`/app/classes/${data.id}/settings`} className={styles.secondaryButton}>
              <IconSettings />
              {m.settings}
            </Link>
          )}
        </div>
        <h1 className={styles.title}>{data.name}</h1>
        {data.summary && <p className={styles.summary}>{data.summary}</p>}

        {!isStudent && classData && (
          <div className={styles.stats}>
            <Stat icon={<IconUsers />} label={m.activeStudents} value={active.length} />
            <Stat
              icon={<IconUserCheck />}
              label={m.pendingRequests}
              value={pending.length}
              tone={pending.length > 0 ? "attention" : undefined}
            />
            <Stat
              icon={<IconLink />}
              label={m.inviteStat}
              value={classData.enableInviteLink ? m.inviteOn : m.inviteOff}
            />
          </div>
        )}
      </header>

      {justCreated && (
        <div className={styles.successBanner} role="status">
          {m.createdBanner}
        </div>
      )}
      {feedback && (
        <div className={styles.successBanner} role="status">
          {feedback}
        </div>
      )}
      {liveError && (
        <div className={styles.problem} role="alert">
          {messages.classroom.panel.errors.start}
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "overview"}
          className={`${styles.tab} ${tab === "overview" ? styles.tabActive : ""}`}
          onClick={() => changeTab("overview")}
        >
          <IconLayout />
          {m.overviewTab}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "schedule"}
          className={`${styles.tab} ${tab === "schedule" ? styles.tabActive : ""}`}
          onClick={() => changeTab("schedule")}
        >
          <IconCalendar />
          {messages.schedule.tab}
        </button>
        {!isStudent && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "students"}
            className={`${styles.tab} ${tab === "students" ? styles.tabActive : ""}`}
            onClick={() => changeTab("students")}
          >
            <IconUsers size={16} />
            {m.studentsTab}
            <span className={styles.tabCount} aria-hidden="true">
              {active.length + pending.length}
            </span>
          </button>
        )}
      </div>

      <div role="tabpanel" className={styles.tabPanel}>
        {tab === "overview" ? (
          <Overview
            data={data}
            editableLinks={!isStudent && data.status !== "ARCHIVED"}
            history={isStudent ? undefined : (classData ?? undefined)}
            role={isStudent ? "student" : "teacher"}
          />
        ) : tab === "schedule" ? (
          <>
            {liveRoom && (
              <div className={styles.liveBanner} role="status">
                <span>{m.liveBanner(liveRoom.title)}</span>
                <ButtonLink href={`/app/classes/${id}/live`} variant="primary" size="sm">
                  {m.enterLiveBanner}
                </ButtonLink>
              </div>
            )}
          <ClassCalendar
            load={loadCalendar}
            liveClassSessionId={liveRoom?.classSessionId ?? null}
            liveHref={liveRoom ? `/app/classes/${id}/live` : undefined}
            editable={!isStudent}
            settingsHref={!isStudent ? `/app/classes/${id}/settings` : undefined}
            reloadKey={calendarReload}
            onEditSession={(s) => setEditingSession(s)}
            loadContent={loadContent}
            loadDiary={loadDiary}
            loadCommands={loadCommands}
            role={isStudent ? "student" : "teacher"}
            onEditContent={(s) => setContentSession(s)}
            onStartLive={handleStartLive}
            onAddSession={(d) => setExtraSessionDate(d)}
            onAddEvent={(d) => setEventDate(d)}
            onEditEvent={(e) => setEditingEvent(e)}
            onDeletePeriod={handleDeletePeriod}
            onSelectPeriod={(first, last) => setSelectedPeriodRange({ first, last })}
          />
          {/* The timeline of the class under the calendar (SPEC-073 CA-07). */}
          <ClassTimeline
            classId={id ?? ""}
            courseCode={data.courseCode}
            role={isStudent ? "student" : "teacher"}
            load={loadTimeline}
            loadDiary={loadDiary}
            loadCommands={loadCommands}
            liveHref={`/app/classes/${id}/live`}
            onStartLive={(s) => handleStartLive(s, data.name)}
            onEditContent={isStudent ? undefined : (s) => setContentSession(s)}
            onEditSession={isStudent ? undefined : (s) => setEditingSession(s)}
            reloadKey={calendarReload}
          />
          </>
        ) : members.length === 0 ? (
          <section className={styles.onboarding} aria-labelledby="empty-title">
            <span className={styles.onboardingIcon}>
              <IconUserPlus size={28} />
            </span>
            <h2 id="empty-title" className={styles.onboardingTitle}>
              {m.emptyTitle}
            </h2>
            <p className={styles.onboardingText}>{m.emptyDescription}</p>

            <div className={styles.paths}>
              <PathCard
                icon={<IconSearch />}
                title={m.emptySelect}
                help={m.emptySelectHelp}
                helpId="path-select-help"
                onClick={() => setDialogOpen(true)}
                recommended
              />
              <PathCard
                icon={<IconUserPlus />}
                title={m.emptyNew}
                help={m.emptyNewHelp}
                helpId="path-new-help"
                onClick={() => setNewStudentOpen(true)}
              />
              <PathCard
                icon={<IconFileUp />}
                title={m.emptyCsv}
                help={m.emptyCsvHelp}
                helpId="path-csv-help"
                onClick={() => setCsvOpen(true)}
              />
            </div>

            <div className={styles.divider}>
              <span>{m.emptyInvite}</span>
            </div>
            {classData && <InviteLinkCard classGroup={classData} />}
          </section>
        ) : (
          <div className={styles.students}>
            <div className={styles.studentsBar}>
              <p className={styles.studentsCount}>{m.studentsSummary(active.length, pending.length)}</p>
              <button
                ref={addButtonRef}
                type="button"
                className={styles.primaryButton}
                onClick={() => setDialogOpen(true)}
              >
                <IconPlus />
                {m.addStudents}
              </button>
            </div>
            {classData && <InviteLinkCard classGroup={classData} />}
            <ClassMembersTable
              members={members}
              activeTab={membersTab}
              onTabChange={setMembersTab}
              onApprove={(memberId) => moderate(memberId, true)}
              onReject={(memberId, reason) => moderate(memberId, false, reason)}
            />
          </div>
        )}
      </div>

      {!isStudent && (
        <>
          {contentSession && id && (
            <SessionContentForm
              classId={id}
              session={contentSession}
              onSaved={() => setCalendarReload((n) => n + 1)}
              onClose={() => setContentSession(null)}
            />
          )}

          {editingSession && (
            <SessionForm
              mode="edit"
              session={editingSession}
              studentCount={active.length}
              onSubmit={handleUpdateSession}
              onRevert={handleRevertSession}
              onDelete={editingSession.origin === "EXTRA" ? handleDeleteSession : undefined}
              onClose={() => setEditingSession(null)}
            />
          )}

          {extraSessionDate && (
            <SessionForm
              mode="extra"
              date={extraSessionDate}
              studentCount={active.length}
              onSubmit={handleCreateExtraSession}
              onClose={() => setExtraSessionDate(null)}
            />
          )}

          {(eventDate || editingEvent) && (
            <EventForm
              event={editingEvent ?? undefined}
              date={eventDate ?? undefined}
              studentCount={active.length}
              onSubmit={handleSaveEvent}
              onDelete={editingEvent ? handleDeleteEvent : undefined}
              onClose={() => {
                setEventDate(null);
                setEditingEvent(null);
              }}
            />
          )}

          {selectedPeriodRange && (
            <PeriodForm
              firstDay={selectedPeriodRange.first}
              lastDay={selectedPeriodRange.last}
              countAffected={countAffected}
              studentCount={active.length}
              onSubmit={handleApplyPeriod}
              onClose={() => setSelectedPeriodRange(null)}
            />
          )}

          <AddStudentsDialog
            isOpen={dialogOpen}
            className={data.name}
            memberIds={memberIds}
            onClose={closeDialog}
            onEnrolled={() => {
              setFeedback(m.enrolledFeedback);
              refresh();
            }}
            onChooseNewStudent={openNewStudent}
            onChooseCsv={openCsv}
            enroll={(ids) => classService.enrollStudents(data.id, ids)}
          />
          <StudentFormModal
            isOpen={newStudentOpen}
            onClose={() => setNewStudentOpen(false)}
            onSuccess={() => {
              setFeedback(m.enrolledFeedback);
              refresh();
            }}
            fixedClass={fixedClass}
          />
          <StudentImportCsvModal
            isOpen={csvOpen}
            onClose={() => setCsvOpen(false)}
            onSuccess={() => {
              setFeedback(messages.students.importModal.successSummary);
              refresh();
            }}
            fixedClass={fixedClass}
          />
        </>
      )}
    </main>
  );
}

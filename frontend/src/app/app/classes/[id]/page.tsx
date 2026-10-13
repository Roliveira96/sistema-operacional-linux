"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { AddStudentsDialog } from "@/components/AddStudentsDialog/AddStudentsDialog";
import { ClassMembersTable } from "@/components/ClassMembersTable/ClassMembersTable";
import { InviteLinkCard } from "@/components/InviteLinkCard/InviteLinkCard";
import { StudentFormModal } from "@/components/StudentFormModal/StudentFormModal";
import { StudentImportCsvModal } from "@/components/StudentImportCsvModal/StudentImportCsvModal";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { classService, type ClassGroup, type ClassMember, type StudentClass } from "@/services/classService";
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

type Tab = "overview" | "students";
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

function Overview({ data }: { data: Presentation }) {
  const progress = validityProgress(data.startDate, data.endDate, new Date());
  return (
    <div className={styles.overview}>
      <div className={styles.mainColumn}>
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
      </aside>
    </div>
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
  const tab: Tab = !isStudent && searchParams.get("tab") === "students" ? "students" : "overview";
  const justCreated = searchParams.get("created") === "1";

  const [id, setId] = useState<string | null>(null);
  const [classData, setClassData] = useState<ClassGroup | null>(null);
  const [studentClass, setStudentClass] = useState<StudentClass | null>(null);
  const [members, setMembers] = useState<ClassMember[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [reload, setReload] = useState(0);
  const [membersTab, setMembersTab] = useState<"ACTIVE" | "PENDING_MODERATION">("ACTIVE");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newStudentOpen, setNewStudentOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);

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

      {isStudent ? (
        <Overview data={data} />
      ) : (
        <>
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
          </div>

          <div role="tabpanel" className={styles.tabPanel}>
            {tab === "overview" ? (
              <Overview data={data} />
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

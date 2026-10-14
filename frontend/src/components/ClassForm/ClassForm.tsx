"use client";

import Link from "next/link";
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MeetingsEditor, validateMeetingDrafts, type MeetingDraft } from "@/components/MeetingsEditor/MeetingsEditor";
import { ClassSessionsCalendar } from "@/components/ClassSessionsCalendar/ClassSessionsCalendar";
import { MeetingsPreview } from "@/components/MeetingsPreview/MeetingsPreview";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { parseIsoDate } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type { ClassGroup, CreateClassPayload } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import type { Holiday, Meeting } from "@/services/scheduleService";
import styles from "./ClassForm.module.scss";

const m = messages.classes.form;

/** The largest summary, as in the server (SPEC-041 RN-01). */
export const SUMMARY_MAX_LENGTH = 300;

export interface ClassFormProps {
  initialData?: Partial<ClassGroup>;
  initialMeetings?: MeetingDraft[];
  onSubmit: (data: CreateClassPayload, meetings?: Meeting[]) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Label of the main button while the form is sent (SPEC-041 CA-16). */
  submittingLabel?: string;
  cancelHref?: string;
  /** The id of a saved class: the Horários tab then shows its real calendar (SPEC-044, section 3.1.2). */
  classId?: string;
  /** Saves the weekly meetings of the saved class, so the real calendar shows them. */
  onApplyMeetings?: (meetings: Meeting[]) => Promise<void>;
  /** The holidays of a year, shown in the preview of a new class. */
  loadHolidays?: (year: number) => Promise<Holiday[]>;
}

/** How long after the last change the meetings of a saved class are applied. */
const APPLY_DELAY_MS = 600;

/** The meetings as the server takes them. */
function toMeetings(drafts: MeetingDraft[]): Meeting[] {
  return drafts.map((m) => ({
    weekday: m.weekday,
    startTime: m.startTime,
    endTime: m.endTime,
    lessonCount: m.lessonCount,
    mode: m.mode,
    room: m.room || undefined,
    onlineUrl: m.onlineUrl || undefined,
  })) as Meeting[];
}

/** Fields that can show an error next to them, in the order the focus visits them. */
const FIELD_ORDER = [
  "name",
  "courseCode",
  "semester",
  "summary",
  "startDate",
  "endDate",
  "syllabus",
  "institutionalGuidelines",
  "inviteStart",
  "inviteEnd",
] as const;
type Field = (typeof FIELD_ORDER)[number];
type FieldErrors = Partial<Record<Field, string>>;

/** The tabs of the form, in order (SPEC-044, section 3.1.1). */
const TABS = ["info", "schedule", "content", "enrollment"] as const;
type Tab = (typeof TABS)[number];

/** The tab that holds each field. */
const TAB_OF_FIELD: Record<Field, Tab> = {
  name: "info",
  courseCode: "info",
  semester: "info",
  summary: "info",
  startDate: "info",
  endDate: "info",
  syllabus: "content",
  institutionalGuidelines: "content",
  inviteStart: "enrollment",
  inviteEnd: "enrollment",
};

/** The element that takes the focus when a field has an error. */
const FIELD_IDS: Record<Field, string> = {
  name: "className",
  courseCode: "courseCode",
  semester: "semester",
  summary: "summary",
  startDate: "startDate",
  endDate: "endDate",
  syllabus: "syllabus-field",
  institutionalGuidelines: "institutionalGuidelines-field",
  inviteStart: "inviteStart",
  inviteEnd: "inviteEnd",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The local calendar day of an instant, as a date input value (SPEC-041 CA-17). */
function toDateInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The local date and time of an instant, as a datetime-local input value. */
function toDateTimeInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${toDateInput(iso)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A date input value at the given local time, as an instant. */
function fromDateInput(value: string, hours = 0, minutes = 0, seconds = 0): Date {
  const [y = 0, mo = 1, d = 1] = value.split("-").map(Number);
  return new Date(y, mo - 1, d, hours, minutes, seconds);
}

/** Maps a server problem to the field it is about, when there is one (SPEC-041, section 5.3). */
function fieldOfProblem(err: ApiProblemError): Field | null {
  switch (err.type) {
    case "invalid-summary":
      return "summary";
    case "content-too-long": {
      const field = err.extensions.field;
      return field === "syllabus" || field === "institutionalGuidelines" ? field : null;
    }
    case "class-conflict":
      return "courseCode";
    case "invalid-date-range":
      return "endDate";
    case "invite-link-dates-required":
      return "inviteStart";
    case "invalid-invite-range":
      return "inviteEnd";
    default:
      return null;
  }
}

function messageOfProblem(err: ApiProblemError): string {
  switch (err.type) {
    case "invalid-summary":
      return m.errors.summaryTooLong(SUMMARY_MAX_LENGTH);
    case "content-too-long":
      return m.errors.contentTooLong;
    case "class-conflict":
      return m.errors.classConflict;
    case "invalid-date-range":
      return m.errors.dateRange;
    case "invite-link-dates-required":
      return m.errors.inviteDatesRequired;
    case "invalid-invite-range":
      return m.errors.inviteRange;
    default:
      return m.errors.generic;
  }
}

/** Form to create or edit a class (SPEC-009), grouped and validated next to each field (SPEC-041, section 3.1.4). */
export function ClassForm({
  initialData,
  initialMeetings,
  onSubmit,
  isSubmitting = false,
  submitLabel,
  submittingLabel,
  cancelHref = "/app/classes",
  classId,
  onApplyMeetings,
  loadHolidays,
}: ClassFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [courseCode, setCourseCode] = useState(initialData?.courseCode ?? "");
  const [semester, setSemester] = useState(initialData?.semester ?? "");
  const [summary, setSummary] = useState(initialData?.summary ?? "");
  const [syllabus, setSyllabus] = useState(initialData?.syllabus ?? "");
  const [guidelines, setGuidelines] = useState(initialData?.institutionalGuidelines ?? "");
  const [startDate, setStartDate] = useState(toDateInput(initialData?.startDate));
  const [endDate, setEndDate] = useState(toDateInput(initialData?.endDate));
  const [schedule, setSchedule] = useState(initialData?.scheduleDescription ?? "");
  const [color, setColor] = useState(initialData?.color ?? "orange");
  const [meetings, setMeetings] = useState<MeetingDraft[]>(initialMeetings ?? []);
  const [meetingErrors, setMeetingErrors] = useState<Record<string, string>>({});
  const [appliedMeetings, setAppliedMeetings] = useState(() => JSON.stringify(toMeetings(initialMeetings ?? [])));
  const [applyState, setApplyState] = useState<"idle" | "applying" | "applied">("idle");
  const [calendarReload, setCalendarReload] = useState(0);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [enableVirtual, setEnableVirtual] = useState(initialData?.enableVirtualClassroom ?? false);
  const [enableInvite, setEnableInvite] = useState(initialData?.enableInviteLink ?? false);
  const [inviteStart, setInviteStart] = useState(toDateTimeInput(initialData?.inviteLinkStart));
  const [inviteEnd, setInviteEnd] = useState(toDateTimeInput(initialData?.inviteLinkEnd));

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const baseId = useId();
  const [activeTab, setActiveTab] = useState<Tab>("info");
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ info: null, schedule: null, content: null, enrollment: null });
  const tabId = (t: Tab) => `${baseId}-tab-${t}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t}`;

  // The field to focus once its tab is on screen (a hidden panel cannot take the focus).
  const [focusRequest, setFocusRequest] = useState<{ id: string } | null>(null);
  useLayoutEffect(() => {
    if (focusRequest) document.getElementById(focusRequest.id)?.focus();
  }, [focusRequest]);

  // The holidays of the years of the term, for the preview of a new class (SPEC-044, CA-15).
  useEffect(() => {
    if (!loadHolidays || !startDate || !endDate || startDate > endDate) return;
    let active = true;
    const first = Number(startDate.slice(0, 4));
    const last = Math.min(Number(endDate.slice(0, 4)), first + 5);
    const years = Array.from({ length: last - first + 1 }, (_, i) => first + i);
    void Promise.all(years.map((y) => loadHolidays(y).catch(() => [] as Holiday[]))).then((lists) => {
      if (active) setHolidays(lists.flat());
    });
    return () => {
      active = false;
    };
  }, [loadHolidays, startDate, endDate]);

  // On a saved class the valid meetings are applied to it by themselves, a little after the last change,
  // so the real calendar shows them (SPEC-044, section 3.1.2). A content that failed is not tried again.
  const pendingMeetings = JSON.stringify(toMeetings(meetings));
  const lastTried = useRef(appliedMeetings);
  useEffect(() => {
    if (!classId || !onApplyMeetings) return;
    if (pendingMeetings === appliedMeetings || pendingMeetings === lastTried.current) return;
    if (Object.keys(validateMeetingDrafts(meetings)).length > 0) return;
    const timer = setTimeout(() => {
      lastTried.current = pendingMeetings;
      setApplyState("applying");
      onApplyMeetings(toMeetings(meetings))
        .then(() => {
          setAppliedMeetings(pendingMeetings);
          setCalendarReload((n) => n + 1);
          setApplyState("applied");
        })
        .catch(() => {
          setFormError(m.errors.generic);
          setApplyState("idle");
        });
    }, APPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [classId, onApplyMeetings, pendingMeetings, appliedMeetings, meetings]);

  const showErrors = (found: FieldErrors) => {
    setErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) {
      setActiveTab(TAB_OF_FIELD[first]);
      setFocusRequest({ id: FIELD_IDS[first] });
    }
  };

  const tabHasError = (t: Tab) =>
    FIELD_ORDER.some((f) => TAB_OF_FIELD[f] === t && errors[f]) || (t === "schedule" && Object.keys(meetingErrors).length > 0);

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, t: Tab) => {
    const at = TABS.indexOf(t);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = Math.min(at + 1, TABS.length - 1);
    else if (e.key === "ArrowLeft") next = Math.max(at - 1, 0);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[next]!;
    setActiveTab(target);
    tabRefs.current[target]?.focus();
  };

  /** A panel of a tab; the inactive ones stay mounted, only hidden, so nothing typed is lost. */
  const panel = (t: Tab, children: ReactNode) => (
    <div
      role="tabpanel"
      id={panelId(t)}
      aria-labelledby={tabId(t)}
      hidden={activeTab !== t}
      className={styles.panel}
    >
      {children}
    </div>
  );

  const validate = (): FieldErrors => {
    const found: FieldErrors = {};
    if (!name.trim()) found.name = m.errors.required;
    if (!courseCode.trim()) found.courseCode = m.errors.required;
    if (!semester.trim()) found.semester = m.errors.required;
    if (summary.trim().length > SUMMARY_MAX_LENGTH) found.summary = m.errors.summaryTooLong(SUMMARY_MAX_LENGTH);
    if (!startDate) found.startDate = m.errors.required;
    if (!endDate) found.endDate = m.errors.required;
    if (startDate && endDate && startDate > endDate) found.endDate = m.errors.dateRange;
    if (enableInvite) {
      if (!inviteStart) found.inviteStart = m.errors.inviteDatesRequired;
      if (!inviteEnd) found.inviteEnd = m.errors.inviteDatesRequired;
      if (inviteStart && inviteEnd && new Date(inviteStart) > new Date(inviteEnd)) found.inviteEnd = m.errors.inviteRange;
    }
    return found;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const found = validate();
    if (Object.keys(found).length > 0) {
      showErrors(found);
      return;
    }

    if (meetings.length > 0) {
      const mErrors = validateMeetingDrafts(meetings);
      if (Object.keys(mErrors).length > 0) {
        setMeetingErrors(mErrors);
        setActiveTab("schedule");
        return;
      }
    }

    setErrors({});
    setMeetingErrors({});

    const payload: CreateClassPayload = {
      name: name.trim(),
      courseCode: courseCode.trim(),
      semester: semester.trim(),
      summary: summary.trim(),
      syllabus: syllabus || undefined,
      institutionalGuidelines: guidelines || undefined,
      startDate: fromDateInput(startDate).toISOString(),
      endDate: fromDateInput(endDate, 23, 59, 59).toISOString(),
      scheduleDescription: schedule || undefined,
      color,
      enableVirtualClassroom: enableVirtual,
      enableInviteLink: enableInvite,
      inviteLinkStart: enableInvite && inviteStart ? new Date(inviteStart).toISOString() : undefined,
      inviteLinkEnd: enableInvite && inviteEnd ? new Date(inviteEnd).toISOString() : undefined,
    };

    const meetingsToSend = meetings.length > 0 ? toMeetings(meetings) : undefined;

    try {
      await onSubmit(payload, meetingsToSend);
    } catch (err: unknown) {
      if (err instanceof ApiProblemError) {
        const field = fieldOfProblem(err);
        // A problem about a field that is not on screen (the invite dates with the link off) goes to the top.
        if (field && document.getElementById(FIELD_IDS[field])) {
          showErrors({ [field]: messageOfProblem(err) });
          return;
        }
        setFormError(messageOfProblem(err));
        return;
      }
      setFormError(m.errors.generic);
    }
  };

  /** Accessibility attributes of a field, tying it to its help text and its error. */
  const describe = (field: Field, helpId?: string) => {
    const ids = [helpId, errors[field] ? `${field}-error` : undefined].filter(Boolean).join(" ");
    return {
      "aria-invalid": errors[field] ? true : undefined,
      "aria-describedby": ids || undefined,
    };
  };

  const errorOf = (field: Field) =>
    errors[field] ? (
      <span id={`${field}-error`} className={styles.fieldError}>
        <span aria-hidden="true" className={styles.errorIcon}>
          !
        </span>
        {errors[field]}
      </span>
    ) : null;

  const required = (
    <span className={styles.required} aria-label={m.requiredMark}>
      *
    </span>
  );

  return (
    <form className={styles.form} onSubmit={(e) => void handleSubmit(e)} noValidate>
      {formError && (
        <div className={styles.errorBanner} role="alert">
          {formError}
        </div>
      )}

      <div role="tablist" aria-label={m.tabsLabel} className={styles.tabs}>
        {TABS.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el;
            }}
            type="button"
            role="tab"
            id={tabId(t)}
            aria-selected={activeTab === t}
            aria-controls={panelId(t)}
            tabIndex={activeTab === t ? 0 : -1}
            data-invalid={tabHasError(t) ? "true" : undefined}
            className={`${styles.tab} ${activeTab === t ? styles.tabActive : ""}`}
            onClick={() => setActiveTab(t)}
            onKeyDown={(e) => onTabKeyDown(e, t)}
          >
            {m.tabs[t]}
            {tabHasError(t) && (
              <span aria-hidden="true" className={styles.errorIcon} title={m.tabHasError}>
                !
              </span>
            )}
          </button>
        ))}
      </div>

      {panel(
        "info",
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label htmlFor="className" className={styles.label}>
              {m.nameLabel} {required}
            </label>
            <input
              id="className"
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={m.namePlaceholder}
              {...describe("name")}
            />
            {errorOf("name")}
          </div>

          <div className={styles.field}>
            <label htmlFor="courseCode" className={styles.label}>
              {m.courseCodeLabel} {required}
            </label>
            <input
              id="courseCode"
              type="text"
              className={styles.input}
              value={courseCode}
              onChange={(e) => setCourseCode(e.target.value)}
              placeholder={m.courseCodePlaceholder}
              {...describe("courseCode")}
            />
            {errorOf("courseCode")}
          </div>

          <div className={styles.field}>
            <label htmlFor="semester" className={styles.label}>
              {m.semesterLabel} {required}
            </label>
            <input
              id="semester"
              type="text"
              className={styles.input}
              value={semester}
              onChange={(e) => setSemester(e.target.value)}
              placeholder={m.semesterPlaceholder}
              {...describe("semester")}
            />
            {errorOf("semester")}
          </div>

          <div className={`${styles.field} ${styles.fullWidth}`}>
            <div className={styles.labelRow}>
              <label htmlFor="summary" className={styles.label}>
                {m.summaryLabel}
              </label>
              <span
                className={`${styles.counter} ${summary.trim().length > SUMMARY_MAX_LENGTH ? styles.counterOver : ""}`}
              >
                {m.summaryCounter(summary.trim().length, SUMMARY_MAX_LENGTH)}
              </span>
            </div>
            <textarea
              id="summary"
              className={`${styles.textarea} ${styles.summary}`}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder={m.summaryPlaceholder}
              {...describe("summary", "summary-help")}
            />
            <span id="summary-help" className={styles.help}>
              {m.summaryHelp}
            </span>
            {errorOf("summary")}
          </div>
          <div className={styles.field}>
            <label htmlFor="startDate" className={styles.label}>
              {m.startDateLabel} {required}
            </label>
            <input
              id="startDate"
              type="date"
              className={styles.input}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              {...describe("startDate")}
            />
            {errorOf("startDate")}
          </div>

          <div className={styles.field}>
            <label htmlFor="endDate" className={styles.label}>
              {m.endDateLabel} {required}
            </label>
            <input
              id="endDate"
              type="date"
              className={styles.input}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              {...describe("endDate")}
            />
            {errorOf("endDate")}
          </div>

          <div className={`${styles.field} ${styles.fullWidth}`}>
            <span className={styles.label}>{messages.schedule.colorLabel}</span>
            <div
              role="radiogroup"
              aria-label={messages.schedule.colorLabel}
              className={styles.colorRadiogroup}
            >
              {Object.entries(messages.schedule.colors).map(([cKey, cLabel]) => (
                <label key={cKey} className={styles.colorSwatch} title={cLabel}>
                  <input
                    type="radio"
                    role="radio"
                    name="classColor"
                    value={cKey}
                    aria-label={cLabel}
                    checked={color === cKey}
                    onChange={() => setColor(cKey)}
                  />
                  <span className={styles.swatchDot} data-color={cKey} aria-hidden="true" />
                </label>
              ))}
            </div>
            <span className={styles.help}>{messages.schedule.colorHelp}</span>
          </div>
        </div>,
      )}

      {panel(
        "schedule",
        <div className={styles.grid}>
          <div className={`${styles.field} ${styles.fullWidth}`}>
            <MeetingsEditor
              value={meetings}
              errors={meetingErrors}
              onChange={(next) => {
                setMeetings(next);
                setMeetingErrors(validateMeetingDrafts(next));
              }}
            />
          </div>

          <div className={`${styles.field} ${styles.fullWidth}`}>
            {classId ? (
              <>
                {applyState !== "idle" && (
                  <span role="status" className={styles.help}>
                    {applyState === "applying" ? messages.schedule.preview.applyingStatus : messages.schedule.preview.appliedStatus}
                  </span>
                )}
                <ClassSessionsCalendar
                  classId={classId}
                  reloadKey={calendarReload}
                  initialMonth={startDate ? parseIsoDate(startDate) : undefined}
                />
              </>
            ) : (
              <MeetingsPreview startDate={startDate} endDate={endDate} meetings={meetings} color={color} holidays={holidays} />
            )}
          </div>

          {meetings.length === 0 && (
            <div className={`${styles.field} ${styles.fullWidth}`}>
              <label htmlFor="schedule" className={styles.label}>
                {m.scheduleLabel}
              </label>
              <input
                id="schedule"
                type="text"
                className={styles.input}
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder={m.schedulePlaceholder}
              />
            </div>
          )}

          <div className={`${styles.field} ${styles.fullWidth}`}>
            <label className={styles.checkboxGroup}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={enableVirtual}
                onChange={(e) => setEnableVirtual(e.target.checked)}
                aria-describedby="virtual-help"
              />
              <span>{m.enableVirtualLabel}</span>
            </label>
            <span id="virtual-help" className={styles.help}>
              {m.enableVirtualHelp}
            </span>
          </div>
        </div>,
      )}

      {panel(
        "content",
        <>
        <div id="syllabus-field" className={styles.field} tabIndex={-1}>
          <span className={styles.label} aria-hidden="true">
            {m.contentSyllabusLabel}
          </span>
          <RichTextEditor
            label={m.contentSyllabusLabel}
            value={syllabus}
            onChange={setSyllabus}
            placeholder={m.syllabusPlaceholder}
            invalid={Boolean(errors.syllabus)}
            describedBy={errors.syllabus ? "syllabus-error" : undefined}
          />
          {errorOf("syllabus")}
        </div>

        <div id="institutionalGuidelines-field" className={styles.field} tabIndex={-1}>
          <span className={styles.label} aria-hidden="true">
            {m.contentGuidelinesLabel}
          </span>
          <RichTextEditor
            label={m.contentGuidelinesLabel}
            value={guidelines}
            onChange={setGuidelines}
            placeholder={m.guidelinesPlaceholder}
            invalid={Boolean(errors.institutionalGuidelines)}
            describedBy={errors.institutionalGuidelines ? "institutionalGuidelines-error" : undefined}
          />
          {errorOf("institutionalGuidelines")}
        </div>
        </>,
      )}

      {panel(
        "enrollment",
        <>
        <div className={styles.field}>
          <label className={styles.checkboxGroup}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={enableInvite}
              onChange={(e) => setEnableInvite(e.target.checked)}
              aria-describedby="invite-help"
            />
            <span>{m.enableInviteLabel}</span>
          </label>
          <span id="invite-help" className={styles.help}>
            {m.enableInviteHelp}
          </span>
        </div>

        {enableInvite && (
          <div className={styles.inviteSection}>
            <div className={styles.field}>
              <label htmlFor="inviteStart" className={styles.label}>
                {m.inviteStartLabel} {required}
              </label>
              <input
                id="inviteStart"
                type="datetime-local"
                className={styles.input}
                value={inviteStart}
                onChange={(e) => setInviteStart(e.target.value)}
                {...describe("inviteStart")}
              />
              {errorOf("inviteStart")}
            </div>
            <div className={styles.field}>
              <label htmlFor="inviteEnd" className={styles.label}>
                {m.inviteEndLabel} {required}
              </label>
              <input
                id="inviteEnd"
                type="datetime-local"
                className={styles.input}
                value={inviteEnd}
                onChange={(e) => setInviteEnd(e.target.value)}
                {...describe("inviteEnd")}
              />
              {errorOf("inviteEnd")}
            </div>
          </div>
        )}
        </>,
      )}

      <div className={styles.actions}>
        <Link href={cancelHref} className={styles.cancel}>
          {m.cancel}
        </Link>
        <button type="submit" className={styles.submit} disabled={isSubmitting}>
          {isSubmitting ? (submittingLabel ?? m.submittingCreate) : (submitLabel ?? m.submitCreate)}
        </button>
      </div>
    </form>
  );
}

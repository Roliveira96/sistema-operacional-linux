"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { messages } from "@/messages/pt-BR";
import type { ClassGroup, CreateClassPayload } from "@/services/classService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./ClassForm.module.scss";

const m = messages.classes.form;

/** The largest summary, as in the server (SPEC-041 RN-01). */
export const SUMMARY_MAX_LENGTH = 300;

export interface ClassFormProps {
  initialData?: Partial<ClassGroup>;
  onSubmit: (data: CreateClassPayload) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  /** Label of the main button while the form is sent (SPEC-041 CA-16). */
  submittingLabel?: string;
  cancelHref?: string;
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
  onSubmit,
  isSubmitting = false,
  submitLabel,
  submittingLabel,
  cancelHref = "/app/classes",
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
  const [enableVirtual, setEnableVirtual] = useState(initialData?.enableVirtualClassroom ?? false);
  const [enableInvite, setEnableInvite] = useState(initialData?.enableInviteLink ?? false);
  const [inviteStart, setInviteStart] = useState(toDateTimeInput(initialData?.inviteLinkStart));
  const [inviteEnd, setInviteEnd] = useState(toDateTimeInput(initialData?.inviteLinkEnd));

  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const showErrors = (found: FieldErrors) => {
    setErrors(found);
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) document.getElementById(FIELD_IDS[first])?.focus();
  };

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
    setErrors({});

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
      enableVirtualClassroom: enableVirtual,
      enableInviteLink: enableInvite,
      inviteLinkStart: enableInvite && inviteStart ? new Date(inviteStart).toISOString() : undefined,
      inviteLinkEnd: enableInvite && inviteEnd ? new Date(inviteEnd).toISOString() : undefined,
    };

    try {
      await onSubmit(payload);
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

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{m.groups.identification}</legend>
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
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{m.groups.schedule}</legend>
        <div className={styles.grid}>
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
        </div>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{m.groups.content}</legend>
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
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{m.groups.enrollment}</legend>
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
      </fieldset>

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

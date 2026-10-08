"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { ClassGroup, CreateClassPayload } from "@/services/classService";
import styles from "./ClassForm.module.scss";

export interface ClassFormProps {
  initialData?: Partial<ClassGroup>;
  onSubmit: (data: CreateClassPayload) => Promise<void>;
  isSubmitting?: boolean;
  submitLabel?: string;
  cancelHref?: string;
}

function formatDateForInput(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function formatDateTimeForInput(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    return d.toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

export function ClassForm({
  initialData,
  onSubmit,
  isSubmitting = false,
  submitLabel,
  cancelHref = "/app/classes",
}: ClassFormProps) {
  const [name, setName] = useState(initialData?.name ?? "");
  const [courseCode, setCourseCode] = useState(initialData?.courseCode ?? "");
  const [semester, setSemester] = useState(initialData?.semester ?? "");
  const [syllabus, setSyllabus] = useState(initialData?.syllabus ?? "");
  const [guidelines, setGuidelines] = useState(initialData?.institutionalGuidelines ?? "");
  const [startDate, setStartDate] = useState(formatDateForInput(initialData?.startDate));
  const [endDate, setEndDate] = useState(formatDateForInput(initialData?.endDate));
  const [schedule, setSchedule] = useState(initialData?.scheduleDescription ?? "");
  const [enableVirtual, setEnableVirtual] = useState(initialData?.enableVirtualClassroom ?? false);
  const [enableInvite, setEnableInvite] = useState(initialData?.enableInviteLink ?? false);
  const [inviteStart, setInviteStart] = useState(formatDateTimeForInput(initialData?.inviteLinkStart));
  const [inviteEnd, setInviteEnd] = useState(formatDateTimeForInput(initialData?.inviteLinkEnd));

  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      setError("A data de início deve ser anterior ou igual à data de término.");
      return;
    }

    if (enableInvite) {
      if (!inviteStart || !inviteEnd) {
        setError("Datas de abertura e expiração do link são obrigatórias quando o link estiver habilitado.");
        return;
      }
      if (new Date(inviteStart) > new Date(inviteEnd)) {
        setError("A abertura do link deve ser anterior ou igual à data de expiração.");
        return;
      }
    }

    const payload: CreateClassPayload = {
      name,
      courseCode,
      semester,
      syllabus: syllabus || undefined,
      institutionalGuidelines: guidelines || undefined,
      startDate: new Date(startDate).toISOString(),
      endDate: new Date(`${endDate}T23:59:59Z`).toISOString(),
      scheduleDescription: schedule || undefined,
      enableVirtualClassroom: enableVirtual,
      enableInviteLink: enableInvite,
      inviteLinkStart: enableInvite && inviteStart ? new Date(inviteStart).toISOString() : undefined,
      inviteLinkEnd: enableInvite && inviteEnd ? new Date(inviteEnd).toISOString() : undefined,
    };

    try {
      await onSubmit(payload);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Erro inesperado ao salvar a turma.");
      }
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      <div className={styles.grid}>
        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label htmlFor="className" className={styles.label}>
            {messages.classes.form.nameLabel} *
          </label>
          <input
            id="className"
            type="text"
            className={styles.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={messages.classes.form.namePlaceholder}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="courseCode" className={styles.label}>
            {messages.classes.form.courseCodeLabel} *
          </label>
          <input
            id="courseCode"
            type="text"
            className={styles.input}
            value={courseCode}
            onChange={(e) => setCourseCode(e.target.value)}
            placeholder={messages.classes.form.courseCodePlaceholder}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="semester" className={styles.label}>
            {messages.classes.form.semesterLabel} *
          </label>
          <input
            id="semester"
            type="text"
            className={styles.input}
            value={semester}
            onChange={(e) => setSemester(e.target.value)}
            placeholder={messages.classes.form.semesterPlaceholder}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="startDate" className={styles.label}>
            {messages.classes.form.startDateLabel} *
          </label>
          <input
            id="startDate"
            type="date"
            className={styles.input}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        <div className={styles.field}>
          <label htmlFor="endDate" className={styles.label}>
            {messages.classes.form.endDateLabel} *
          </label>
          <input
            id="endDate"
            type="date"
            className={styles.input}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label htmlFor="schedule" className={styles.label}>
            {messages.classes.form.scheduleLabel}
          </label>
          <input
            id="schedule"
            type="text"
            className={styles.input}
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder={messages.classes.form.schedulePlaceholder}
          />
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label htmlFor="syllabus" className={styles.label}>
            {messages.classes.form.syllabusLabel}
          </label>
          <textarea
            id="syllabus"
            className={styles.textarea}
            value={syllabus}
            onChange={(e) => setSyllabus(e.target.value)}
            placeholder={messages.classes.form.syllabusPlaceholder}
          />
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label htmlFor="guidelines" className={styles.label}>
            {messages.classes.form.guidelinesLabel}
          </label>
          <textarea
            id="guidelines"
            className={styles.textarea}
            value={guidelines}
            onChange={(e) => setGuidelines(e.target.value)}
            placeholder={messages.classes.form.guidelinesPlaceholder}
          />
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.checkboxGroup}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={enableVirtual}
              onChange={(e) => setEnableVirtual(e.target.checked)}
            />
            <span>{messages.classes.form.enableVirtualLabel}</span>
          </label>
        </div>

        <div className={`${styles.field} ${styles.fullWidth}`}>
          <label className={styles.checkboxGroup}>
            <input
              type="checkbox"
              className={styles.checkbox}
              checked={enableInvite}
              onChange={(e) => setEnableInvite(e.target.checked)}
            />
            <span>{messages.classes.form.enableInviteLabel}</span>
          </label>
        </div>

        {enableInvite && (
          <div className={styles.inviteSection}>
            <div className={styles.field}>
              <label htmlFor="inviteStart" className={styles.label}>
                {messages.classes.form.inviteStartLabel} *
              </label>
              <input
                id="inviteStart"
                type="datetime-local"
                className={styles.input}
                value={inviteStart}
                onChange={(e) => setInviteStart(e.target.value)}
                required={enableInvite}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="inviteEnd" className={styles.label}>
                {messages.classes.form.inviteEndLabel} *
              </label>
              <input
                id="inviteEnd"
                type="datetime-local"
                className={styles.input}
                value={inviteEnd}
                onChange={(e) => setInviteEnd(e.target.value)}
                required={enableInvite}
              />
            </div>
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <Link href={cancelHref}>
          <Button variant="secondary" type="button">
            {messages.classes.form.cancel}
          </Button>
        </Link>
        <Button variant="primary" type="submit" disabled={isSubmitting}>
          {submitLabel ?? messages.classes.form.submitCreate}
        </Button>
      </div>
    </form>
  );
}

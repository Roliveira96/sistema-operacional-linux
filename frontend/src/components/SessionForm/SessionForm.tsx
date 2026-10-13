"use client";

import { useEffect, useRef, useState } from "react";
import { isHttpsUrl, minutesOf, suggestLessons } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type { Mode, Session, SessionInput } from "@/services/scheduleService";
import styles from "./SessionForm.module.scss";

export interface SessionFormProps {
  mode: "edit" | "extra";
  session?: Session;
  date?: string;
  studentCount?: number;
  onSubmit: (data: SessionInput) => Promise<void>;
  onRevert?: () => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function formatDateBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function SessionForm({
  mode,
  session,
  date: initialDate,
  studentCount = 0,
  onSubmit,
  onRevert,
  onDelete,
  onClose,
}: SessionFormProps) {
  const dateStr = session?.date ?? initialDate ?? "";
  const formattedDate = dateStr ? formatDateBr(dateStr) : "";
  const dialogTitle =
    mode === "edit"
      ? messages.schedule.session.editTitle(formattedDate)
      : messages.schedule.session.extraTitle;

  const [date, setDate] = useState(dateStr);
  const [status, setStatus] = useState<"SCHEDULED" | "CANCELED">(
    session?.status ?? "SCHEDULED",
  );
  const [startTime, setStartTime] = useState(session?.startTime ?? "08:20");
  const [endTime, setEndTime] = useState(session?.endTime ?? "10:00");
  const [lessonCount, setLessonCount] = useState<number>(session?.lessonCount ?? 2);
  const [sessionMode, setSessionMode] = useState<Mode>(session?.mode ?? "IN_PERSON");
  const [room, setRoom] = useState(session?.room ?? "");
  const [onlineUrl, setOnlineUrl] = useState(session?.onlineUrl ?? "");
  const [reason, setReason] = useState(session?.changeReason ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleEndTimeChange = (newEnd: string) => {
    setEndTime(newEnd);
    if (minutesOf(newEnd) > minutesOf(startTime)) {
      setLessonCount(suggestLessons(startTime, newEnd));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (status === "CANCELED" && !reason.trim()) {
      newErrors.reason = messages.schedule.errors.reasonRequired;
      reasonRef.current?.focus();
    }

    if (minutesOf(endTime) <= minutesOf(startTime)) {
      newErrors.time = messages.schedule.errors.endBeforeStart;
    }

    if (sessionMode === "ONLINE" && !isHttpsUrl(onlineUrl)) {
      newErrors.link = messages.schedule.errors.httpsLink;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setServerError(null);
    setLoading(true);

    try {
      if (mode === "edit") {
        await onSubmit({
          status,
          startTime,
          endTime,
          lessonCount,
          mode: sessionMode,
          room: sessionMode === "IN_PERSON" ? room || undefined : undefined,
          onlineUrl: sessionMode === "ONLINE" ? onlineUrl || undefined : undefined,
          reason: reason || undefined,
        });
      } else {
        await onSubmit({
          date,
          startTime,
          endTime,
          lessonCount,
          mode: sessionMode,
          room: sessionMode === "IN_PERSON" ? room || undefined : undefined,
          onlineUrl: sessionMode === "ONLINE" ? onlineUrl || undefined : undefined,
          reason: reason || undefined,
        });
      }
      onClose();
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : messages.schedule.errors.save);
    } finally {
      setLoading(false);
    }
  };

  const handleRevert = async () => {
    if (!onRevert) return;
    setLoading(true);
    setServerError(null);
    try {
      await onRevert();
      onClose();
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : messages.schedule.errors.save);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    setLoading(true);
    setServerError(null);
    try {
      await onDelete();
      onClose();
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : messages.schedule.errors.save);
    } finally {
      setLoading(false);
    }
  };

  const noticeText = messages.schedule.notify(studentCount);

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={dialogTitle}
        aria-modal="true"
        className={styles.modal}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{dialogTitle}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={messages.schedule.session.close}
          >
            ×
          </button>
        </div>

        {noticeText && <div className={styles.notice}>{noticeText}</div>}

        {serverError && (
          <div role="alert" className={styles.alert}>
            {serverError}
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className={styles.form}>
          {mode === "extra" ? (
            <div className={styles.fieldGroup}>
              <label htmlFor="session-date" className={styles.label}>
                {messages.schedule.session.date}
              </label>
              <input
                id="session-date"
                type="date"
                className={styles.input}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          ) : (
            <div className={styles.fieldGroup}>
              <span className={styles.label}>{messages.schedule.session.status}</span>
              <div className={styles.radioGroup}>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="status"
                    value="SCHEDULED"
                    checked={status === "SCHEDULED"}
                    onChange={() => setStatus("SCHEDULED")}
                  />
                  {messages.schedule.session.kept}
                </label>
                <label className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="status"
                    value="CANCELED"
                    checked={status === "CANCELED"}
                    onChange={() => setStatus("CANCELED")}
                  />
                  {messages.schedule.session.canceled}
                </label>
              </div>
            </div>
          )}

          <div className={styles.row}>
            <div className={styles.fieldGroup}>
              <label htmlFor="session-start" className={styles.label}>
                {messages.schedule.session.start}
              </label>
              <input
                id="session-start"
                type="time"
                className={styles.input}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="session-end" className={styles.label}>
                {messages.schedule.session.end}
              </label>
              <input
                id="session-end"
                type="time"
                className={styles.input}
                value={endTime}
                onChange={(e) => handleEndTimeChange(e.target.value)}
              />
            </div>
          </div>
          {errors.time && <span className={styles.error}>{errors.time}</span>}

          <div className={styles.fieldGroup}>
            <label htmlFor="session-lessons" className={styles.label}>
              {messages.schedule.session.lessons}
            </label>
            <input
              id="session-lessons"
              type="number"
              min={1}
              max={8}
              className={styles.input}
              value={lessonCount}
              onChange={(e) => setLessonCount(Number(e.target.value))}
            />
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.label}>{messages.schedule.session.mode}</span>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="sessionMode"
                  value="IN_PERSON"
                  checked={sessionMode === "IN_PERSON"}
                  onChange={() => setSessionMode("IN_PERSON")}
                />
                {messages.schedule.modes.IN_PERSON}
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="sessionMode"
                  value="ONLINE"
                  checked={sessionMode === "ONLINE"}
                  onChange={() => setSessionMode("ONLINE")}
                />
                {messages.schedule.modes.ONLINE}
              </label>
            </div>
          </div>

          {sessionMode === "IN_PERSON" ? (
            <div className={styles.fieldGroup}>
              <label htmlFor="session-room" className={styles.label}>
                {messages.schedule.session.room}
              </label>
              <input
                id="session-room"
                type="text"
                className={styles.input}
                value={room}
                onChange={(e) => setRoom(e.target.value)}
              />
            </div>
          ) : (
            <div className={styles.fieldGroup}>
              <label htmlFor="session-link" className={styles.label}>
                {messages.schedule.session.link}
              </label>
              <input
                id="session-link"
                type="url"
                className={styles.input}
                value={onlineUrl}
                onChange={(e) => setOnlineUrl(e.target.value)}
              />
              {errors.link && <span className={styles.error}>{errors.link}</span>}
            </div>
          )}

          <div className={styles.fieldGroup}>
            <label htmlFor="session-reason" className={styles.label}>
              {messages.schedule.session.reason}
            </label>
            <textarea
              id="session-reason"
              ref={reasonRef}
              className={styles.textarea}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {errors.reason && <span className={styles.error}>{errors.reason}</span>}
          </div>

          <div className={styles.actions}>
            <button type="submit" disabled={loading} className={styles.submitBtn}>
              {mode === "edit"
                ? messages.schedule.session.save
                : messages.schedule.session.add}
            </button>

            {mode === "edit" && session?.overridden && onRevert && (
              <button
                type="button"
                disabled={loading}
                className={styles.revertBtn}
                onClick={handleRevert}
              >
                {messages.schedule.session.revert}
              </button>
            )}

            {mode === "edit" && session?.origin === "EXTRA" && onDelete && (
              <button
                type="button"
                disabled={loading}
                className={styles.deleteBtn}
                onClick={handleDelete}
              >
                {messages.schedule.session.deleteExtra}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

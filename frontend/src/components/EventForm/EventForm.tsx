"use client";

import { useEffect, useState } from "react";
import { isHttpsUrl } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type { ClassEvent, EventInput } from "@/services/scheduleService";
import styles from "./EventForm.module.scss";

export interface EventFormProps {
  event?: ClassEvent;
  date?: string;
  studentCount?: number;
  onSubmit: (data: EventInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export function EventForm({
  event,
  date: initialDate,
  studentCount = 0,
  onSubmit,
  onDelete,
  onClose,
}: EventFormProps) {
  const isEditing = Boolean(event);
  const dialogTitle = isEditing
    ? messages.schedule.event.editTitle
    : messages.schedule.event.addTitle;

  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [date, setDate] = useState(event?.date ?? initialDate ?? "");
  const [allDay, setAllDay] = useState(event?.allDay ?? false);
  const [startTime, setStartTime] = useState(event?.startTime ?? "");
  const [endTime, setEndTime] = useState(event?.endTime ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [onlineUrl, setOnlineUrl] = useState(event?.onlineUrl ?? "");

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (!title.trim()) {
      newErrors.title = messages.schedule.errors.titleRequired;
    }

    if (!allDay && (!startTime.trim() || !endTime.trim())) {
      newErrors.time = messages.schedule.errors.eventTimes;
    }

    if (onlineUrl.trim() && !isHttpsUrl(onlineUrl)) {
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
      await onSubmit({
        title: title.trim(),
        description: description.trim() || undefined,
        date,
        allDay,
        startTime: allDay ? undefined : startTime || undefined,
        endTime: allDay ? undefined : endTime || undefined,
        location: location.trim() || undefined,
        onlineUrl: onlineUrl.trim() || undefined,
      });
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
            aria-label="Fechar"
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
          <div className={styles.fieldGroup}>
            <label htmlFor="event-title" className={styles.label}>
              {messages.schedule.event.title}
            </label>
            <input
              id="event-title"
              type="text"
              className={styles.input}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            {errors.title && <span className={styles.error}>{errors.title}</span>}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="event-desc" className={styles.label}>
              {messages.schedule.event.description}
            </label>
            <textarea
              id="event-desc"
              className={styles.textarea}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="event-date" className={styles.label}>
              {messages.schedule.event.date}
            </label>
            <input
              id="event-date"
              type="date"
              className={styles.input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
              />
              {messages.schedule.event.allDay}
            </label>
          </div>

          {!allDay && (
            <>
              <div className={styles.row}>
                <div className={styles.fieldGroup}>
                  <label htmlFor="event-start" className={styles.label}>
                    {messages.schedule.event.start}
                  </label>
                  <input
                    id="event-start"
                    type="time"
                    className={styles.input}
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label htmlFor="event-end" className={styles.label}>
                    {messages.schedule.event.end}
                  </label>
                  <input
                    id="event-end"
                    type="time"
                    className={styles.input}
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
              {errors.time && <span className={styles.error}>{errors.time}</span>}
            </>
          )}

          <div className={styles.fieldGroup}>
            <label htmlFor="event-location" className={styles.label}>
              {messages.schedule.event.location}
            </label>
            <input
              id="event-location"
              type="text"
              className={styles.input}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="event-link" className={styles.label}>
              {messages.schedule.event.link}
            </label>
            <input
              id="event-link"
              type="url"
              className={styles.input}
              value={onlineUrl}
              onChange={(e) => setOnlineUrl(e.target.value)}
            />
            {errors.link && <span className={styles.error}>{errors.link}</span>}
          </div>

          <div className={styles.actions}>
            <button type="submit" disabled={loading} className={styles.submitBtn}>
              {messages.schedule.event.save}
            </button>

            {isEditing && onDelete && (
              <button
                type="button"
                disabled={loading}
                className={styles.deleteBtn}
                onClick={handleDelete}
              >
                {messages.schedule.event.delete}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

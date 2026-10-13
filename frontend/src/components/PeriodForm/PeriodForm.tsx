"use client";

import { useEffect, useState } from "react";
import { isHttpsUrl } from "@/lib/calendar";
import { messages } from "@/messages/pt-BR";
import type { PeriodAction, PeriodInput } from "@/services/scheduleService";
import styles from "./PeriodForm.module.scss";

export interface PeriodFormProps {
  firstDay: string;
  lastDay: string;
  countAffected: (first: string, last: string) => number;
  studentCount?: number;
  onSubmit: (data: PeriodInput) => Promise<void>;
  onClose: () => void;
}

export function PeriodForm({
  firstDay: initialFirst,
  lastDay: initialLast,
  countAffected,
  studentCount = 0,
  onSubmit,
  onClose,
}: PeriodFormProps) {
  const [firstDay, setFirstDay] = useState(initialFirst);
  const [lastDay, setLastDay] = useState(initialLast);
  const [action, setAction] = useState<PeriodAction>("NO_CLASSES");
  const [label, setLabel] = useState("");
  const [onlineUrl, setOnlineUrl] = useState("");

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

  const affectedCount = countAffected(firstDay, lastDay);
  const noticeText = messages.schedule.notify(studentCount);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};

    if (lastDay < firstDay) {
      newErrors.range = messages.schedule.errors.lastBeforeFirst;
    }

    if (!label.trim()) {
      newErrors.label = messages.schedule.errors.labelRequired;
    }

    if (action === "ONLINE" && (!onlineUrl.trim() || !isHttpsUrl(onlineUrl))) {
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
        firstDay,
        lastDay,
        action,
        label: label.trim(),
        onlineUrl: action === "ONLINE" ? onlineUrl.trim() || undefined : undefined,
      });
      onClose();
    } catch (err: unknown) {
      setServerError(err instanceof Error ? err.message : messages.schedule.errors.save);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-label={messages.schedule.period.title}
        aria-modal="true"
        className={styles.modal}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{messages.schedule.period.title}</h2>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className={styles.meta}>
          <div className={styles.affected}>
            {messages.schedule.period.affected(affectedCount)}
          </div>
          {noticeText && <div className={styles.notice}>{noticeText}</div>}
        </div>

        {serverError && (
          <div role="alert" className={styles.alert}>
            {serverError}
          </div>
        )}

        <form noValidate onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.row}>
            <div className={styles.fieldGroup}>
              <label htmlFor="period-first" className={styles.label}>
                {messages.schedule.period.firstDay}
              </label>
              <input
                id="period-first"
                type="date"
                className={styles.input}
                value={firstDay}
                onChange={(e) => setFirstDay(e.target.value)}
              />
            </div>
            <div className={styles.fieldGroup}>
              <label htmlFor="period-last" className={styles.label}>
                {messages.schedule.period.lastDay}
              </label>
              <input
                id="period-last"
                type="date"
                className={styles.input}
                value={lastDay}
                onChange={(e) => setLastDay(e.target.value)}
              />
            </div>
          </div>
          {errors.range && <span className={styles.error}>{errors.range}</span>}

          <div className={styles.fieldGroup}>
            <span className={styles.label}>{messages.schedule.period.action}</span>
            <div className={styles.radioGroup}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="periodAction"
                  value="NO_CLASSES"
                  checked={action === "NO_CLASSES"}
                  onChange={() => setAction("NO_CLASSES")}
                />
                {messages.schedule.period.noClasses}
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="periodAction"
                  value="ONLINE"
                  checked={action === "ONLINE"}
                  onChange={() => setAction("ONLINE")}
                />
                {messages.schedule.period.online}
              </label>
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="period-label" className={styles.label}>
              {messages.schedule.period.label}
            </label>
            <input
              id="period-label"
              type="text"
              placeholder={messages.schedule.period.labelPlaceholder}
              className={styles.input}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            {errors.label && <span className={styles.error}>{errors.label}</span>}
          </div>

          {action === "ONLINE" && (
            <div className={styles.fieldGroup}>
              <label htmlFor="period-link" className={styles.label}>
                {messages.schedule.period.link}
              </label>
              <input
                id="period-link"
                type="url"
                className={styles.input}
                value={onlineUrl}
                onChange={(e) => setOnlineUrl(e.target.value)}
              />
              {errors.link && <span className={styles.error}>{errors.link}</span>}
            </div>
          )}

          <div className={styles.actions}>
            <button type="submit" disabled={loading} className={styles.submitBtn}>
              {messages.schedule.period.apply}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

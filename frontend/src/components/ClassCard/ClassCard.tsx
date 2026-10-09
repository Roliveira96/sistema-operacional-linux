"use client";

import Link from "next/link";
import { useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { ClassSummary } from "@/services/classService";
import styles from "./ClassCard.module.scss";

function IconGraduationCap() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function IconUserCheck() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <polyline points="17 11 19 13 23 9" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function IconLink() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconAlertTriangle() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconArchive() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}

function IconArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

export interface ClassCardProps {
  classGroup: ClassSummary;
  onArchive?: (id: string) => void;
}

export function ClassCard({ classGroup, onArchive }: ClassCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (!classGroup.inviteLinkToken) return;
    const url = `${window.location.origin}/invite/${classGroup.inviteLinkToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const statusClass =
    classGroup.status === "ACTIVE"
      ? styles.active
      : classGroup.status === "DRAFT"
        ? styles.draft
        : styles.archived;

  return (
    <article className={styles.card} aria-label={classGroup.name}>
      <div className={`${styles.accentBar} ${statusClass}`} aria-hidden="true" />

      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.courseBadge}>
            <span className={styles.courseIcon} aria-hidden="true">
              <IconGraduationCap />
            </span>
            <span className={styles.meta}>
              {classGroup.courseCode} • {classGroup.semester}
            </span>
          </div>

          <span className={`${styles.badge} ${statusClass}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {messages.classes.statusBadge[classGroup.status] ?? classGroup.status}
          </span>
        </div>

        <h3 className={styles.title}>
          <Link href={`/app/classes/${classGroup.id}/members`} className={styles.titleLink}>
            {classGroup.name}
          </Link>
        </h3>
      </header>

      {classGroup.isExpiringSoon && (
        <div className={styles.expiringAlert} role="alert">
          <span className={styles.alertIcon} aria-hidden="true">
            <IconAlertTriangle />
          </span>
          <div className={styles.alertContent}>
            <span className={styles.alertText}>{messages.classes.expiringAlert}</span>
            <Link href={`/app/classes/${classGroup.id}/settings`} className={styles.extendLink}>
              {messages.classes.extendValidityAction} &rarr;
            </Link>
          </div>
        </div>
      )}

      <div className={styles.body}>
        {classGroup.scheduleDescription && (
          <div className={styles.scheduleRow}>
            <span className={styles.scheduleIcon} aria-hidden="true">
              <IconClock />
            </span>
            <span className={styles.scheduleText}>
              <strong>{messages.classes.card.schedule}:</strong> {classGroup.scheduleDescription}
            </span>
          </div>
        )}

        <div className={styles.counters}>
          <div className={styles.counterItem}>
            <div className={styles.counterIconWrapper} aria-hidden="true">
              <IconUsers />
            </div>
            <div className={styles.counterInfo}>
              <span className={styles.counterLabel}>{messages.classes.card.activeStudents}:</span>
              <strong className={styles.counterValue}>{classGroup.totalActiveStudents}</strong>
            </div>
          </div>

          <Link
            href={`/app/classes/${classGroup.id}/members`}
            className={`${styles.counterItem} ${styles.counterClickable} ${
              classGroup.totalPendingRequests > 0 ? styles.counterPendingAttention : ""
            }`}
            title={classGroup.totalPendingRequests > 0 ? "Ver solicitações pendentes" : undefined}
          >
            <div className={styles.counterIconWrapper} aria-hidden="true">
              <IconUserCheck />
              {classGroup.totalPendingRequests > 0 && <span className={styles.attentionDot} />}
            </div>
            <div className={styles.counterInfo}>
              <span className={styles.counterLabel}>{messages.classes.card.pendingRequests}:</span>
              <strong className={styles.counterValue}>{classGroup.totalPendingRequests}</strong>
            </div>
          </Link>
        </div>

        <div className={styles.inviteArea}>
          <div
            className={`${styles.inviteStatus} ${classGroup.enableInviteLink ? styles.activeLink : ""}`}
          >
            <span className={styles.inviteIcon} aria-hidden="true">
              <IconLink />
            </span>
            <span className={styles.inviteStatusText}>
              {classGroup.enableInviteLink
                ? messages.classes.inviteLink.active
                : messages.classes.inviteLink.inactive}
            </span>
          </div>

          {classGroup.enableInviteLink && classGroup.inviteLinkToken && (
            <button
              type="button"
              className={`${styles.copyButton} ${copied ? styles.copied : ""}`}
              onClick={handleCopyLink}
              title={messages.classes.inviteLink.copyButton}
            >
              <span className={styles.buttonIcon} aria-hidden="true">
                {copied ? <IconCheck /> : <IconCopy />}
              </span>
              <span className={styles.copyButtonText}>
                {copied ? messages.classes.inviteLink.copySuccess : messages.classes.inviteLink.copyButton}
              </span>
            </button>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <Link href={`/app/classes/${classGroup.id}/members`} className={styles.linkActionPrimary}>
          <IconUsers />
          <span>{messages.classes.card.members}</span>
          <IconArrowRight />
        </Link>

        <div className={styles.secondaryActions}>
          <Link
            href={`/app/classes/${classGroup.id}/settings`}
            className={styles.linkAction}
            title={messages.classes.card.manage}
          >
            <IconSettings />
            <span>{messages.classes.card.manage}</span>
          </Link>

          {classGroup.status !== "ARCHIVED" && onArchive && (
            <button
              type="button"
              className={styles.archiveButton}
              onClick={() => onArchive(classGroup.id)}
              title={messages.classes.card.archive}
            >
              <IconArchive />
              <span>{messages.classes.card.archive}</span>
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}


"use client";

import Link from "next/link";
import { useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { ClassSummary } from "@/services/classService";
import styles from "./ClassCard.module.scss";

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
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <h3 className={styles.title}>{classGroup.name}</h3>
          <span className={styles.meta}>
            {classGroup.courseCode} • {classGroup.semester}
          </span>
        </div>
        <span className={`${styles.badge} ${statusClass}`}>
          {messages.classes.statusBadge[classGroup.status] ?? classGroup.status}
        </span>
      </header>

      {classGroup.isExpiringSoon && (
        <div className={styles.expiringAlert} role="alert">
          <span>{messages.classes.expiringAlert}</span>
          <Link href={`/app/classes/${classGroup.id}/settings`} className={styles.extendLink}>
            {messages.classes.extendValidityAction}
          </Link>
        </div>
      )}

      <div className={styles.body}>
        {classGroup.scheduleDescription && (
          <div className={styles.schedule}>
            <strong>{messages.classes.card.schedule}:</strong> {classGroup.scheduleDescription}
          </div>
        )}

        <div className={styles.counters}>
          <div className={styles.counterItem}>
            <span>{messages.classes.card.activeStudents}:</span>
            <strong>{classGroup.totalActiveStudents}</strong>
          </div>
          <div className={styles.counterItem}>
            <span>{messages.classes.card.pendingRequests}:</span>
            <strong>{classGroup.totalPendingRequests}</strong>
          </div>
        </div>

        <div className={styles.inviteArea}>
          <div
            className={`${styles.inviteStatus} ${classGroup.enableInviteLink ? styles.activeLink : ""}`}
          >
            <span>
              {classGroup.enableInviteLink
                ? messages.classes.inviteLink.active
                : messages.classes.inviteLink.inactive}
            </span>
          </div>
          {classGroup.enableInviteLink && classGroup.inviteLinkToken && (
            <button
              type="button"
              className={styles.copyButton}
              onClick={handleCopyLink}
              title={messages.classes.inviteLink.copyButton}
            >
              {copied ? messages.classes.inviteLink.copySuccess : messages.classes.inviteLink.copyButton}
            </button>
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <Link href={`/app/classes/${classGroup.id}/members`} className={styles.linkAction}>
          {messages.classes.card.members}
        </Link>
        <Link href={`/app/classes/${classGroup.id}/settings`} className={styles.linkAction}>
          {messages.classes.card.manage}
        </Link>
        {classGroup.status !== "ARCHIVED" && onArchive && (
          <button
            type="button"
            className={styles.archiveButton}
            onClick={() => onArchive(classGroup.id)}
          >
            {messages.classes.card.archive}
          </button>
        )}
      </footer>
    </article>
  );
}

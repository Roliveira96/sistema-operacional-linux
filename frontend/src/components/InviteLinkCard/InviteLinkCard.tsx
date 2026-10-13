"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { ClassGroup } from "@/services/classService";
import styles from "./InviteLinkCard.module.scss";

const m = messages.classes.inviteCard;

export interface InviteLinkCardProps {
  classGroup: ClassGroup;
  /** Clock used to check the validity window; tests pin it. */
  now?: Date;
}

/** Why the invite link does not take requests now, or null when it does (SPEC-041, section 3.1.3). */
function unavailableReason(c: ClassGroup, now: Date): string | null {
  if (!c.enableInviteLink || !c.inviteLinkToken) return m.disabled;
  if (c.status !== "ACTIVE") return m.classNotActive;
  if (c.inviteLinkStart && now < new Date(c.inviteLinkStart)) return m.notOpenYet;
  if (c.inviteLinkEnd && now > new Date(c.inviteLinkEnd)) return m.expired;
  return null;
}

function IconLink() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconCopy() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

/** The invite link of a class on its students tab: the address to copy, or why it is not available (SPEC-041 CA-09). */
export function InviteLinkCard({ classGroup, now = new Date() }: InviteLinkCardProps) {
  const fieldId = useId();
  const [announcement, setAnnouncement] = useState("");
  const reason = unavailableReason(classGroup, now);
  const url = classGroup.inviteLinkToken ? `${window.location.origin}/invite/${classGroup.inviteLinkToken}` : "";

  const handleCopy = () => {
    setAnnouncement("");
    navigator.clipboard.writeText(url).then(
      () => setAnnouncement(m.copied),
      () => setAnnouncement(m.copyFailed),
    );
  };

  const expiry = classGroup.inviteLinkEnd ? new Date(classGroup.inviteLinkEnd) : null;

  return (
    <section className={`${styles.card} ${reason ? "" : styles.cardOn}`} aria-labelledby={`${fieldId}-title`}>
      <span className={styles.icon}>
        <IconLink />
      </span>

      <div className={styles.body}>
        <div className={styles.heading}>
          <h2 id={`${fieldId}-title`} className={styles.title}>
            {m.title}
          </h2>
          <span className={`${styles.pill} ${reason ? styles.pillOff : styles.pillOn}`}>
            <span className={styles.dot} aria-hidden="true" />
            {reason ? m.statusOff : m.statusOn}
          </span>
        </div>

        {reason ? (
          <p className={styles.note}>{reason}</p>
        ) : (
          <>
            <label htmlFor={fieldId} className={styles.srOnly}>
              {m.fieldLabel}
            </label>
            <div className={styles.row}>
              <input
                id={fieldId}
                className={styles.field}
                value={url}
                readOnly
                onFocus={(e) => e.currentTarget.select()}
              />
              <button type="button" className={styles.copy} onClick={handleCopy}>
                <IconCopy />
                {m.copy}
              </button>
            </div>
            {expiry && (
              <p className={styles.note}>
                {m.expires(
                  expiry.toLocaleDateString("pt-BR"),
                  expiry.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                )}
              </p>
            )}
          </>
        )}

        <p role="status" aria-live="polite" className={styles.announcement}>
          {announcement}
        </p>
      </div>

      {reason && (
        <Link href={`/app/classes/${classGroup.id}/settings`} className={styles.configure}>
          {m.configure}
        </Link>
      )}
    </section>
  );
}

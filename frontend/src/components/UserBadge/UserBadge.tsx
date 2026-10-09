"use client";

import type { Identity } from "@/hooks/useIdentity";
import { contentMessages } from "@/messages/content.pt-BR";
import styles from "./UserBadge.module.scss";

const m = contentMessages.topic.user;

/** First letters of the first and last name, for users without a photo. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : "";
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

/** Photo, name and academic ID of the signed-in user, at the left of the header. */
export function UserBadge({ identity }: { identity: Identity }) {
  return (
    <div className={styles.badge} title={identity.name}>
      {identity.avatarUrl ? (
        // The photo comes from the object storage with its own address; there is nothing to optimize here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={identity.avatarUrl} alt={m.photoOf(identity.name)} className={styles.avatar} />
      ) : (
        <span className={styles.initials} aria-hidden="true">
          {initialsOf(identity.name)}
        </span>
      )}
      <div className={styles.text}>
        <span className={styles.name}>{identity.name}</span>
        {identity.academicId && <span className={styles.academicId}>{m.academicId(identity.academicId)}</span>}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { initialsOf } from "@/components/UserBadge/UserBadge";
import type { Identity } from "@/hooks/useIdentity";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import { classService, type MyClassesResult } from "@/services/classService";
import styles from "./AccountMenu.module.scss";

const m = messages.account;
const MAX_CLASSES = 5;

export interface AccountMenuProps {
  user: Pick<Identity, "name" | "email" | "role" | "avatarUrl">;
  /** Reads the classes of the user; the real service by default. */
  loadClasses?: () => Promise<MyClassesResult>;
  /** Ends the session. */
  logout: () => unknown;
}

type ClassesState = { status: "idle" | "loading" | "error" } | { status: "ready"; data: MyClassesResult };

function Avatar({ user, big }: { user: AccountMenuProps["user"]; big?: boolean }) {
  const size = big ? styles.big : styles.small;
  return user.avatarUrl ? (
    // The photo comes from the object storage with its own address; there is nothing to optimize here.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={user.avatarUrl} alt={contentMessages.topic.user.photoOf(user.name)} className={`${styles.avatar} ${size}`} />
  ) : (
    <span className={`${styles.avatar} ${styles.initials} ${size}`} aria-hidden="true">
      {initialsOf(user.name)}
    </span>
  );
}

/**
 * Account menu of the top bars (SPEC-026): photo and name when closed; email, classes,
 * profile and the way out when open. A disclosure, not a role=menu: plain buttons and links.
 */
export function AccountMenu({ user, loadClasses = () => classService.myClasses(), logout }: AccountMenuProps) {
  const pathname = usePathname();
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  // The path where it was opened: another path means a route change, which closes it.
  const [openedOn, setOpenedOn] = useState<string | null | undefined>(undefined);
  const [classes, setClasses] = useState<ClassesState>({ status: "idle" });
  const open = openedOn !== undefined && openedOn === pathname;
  const isAdmin = user.role === "ADMIN";
  const isTeacher = user.role === "TEACHER";

  const load = () => {
    setClasses({ status: "loading" });
    loadClasses().then(
      (data) => setClasses({ status: "ready", data }),
      () => setClasses({ status: "error" }),
    );
  };

  const close = () => setOpenedOn(undefined);

  const toggle = () => {
    if (open) return close();
    setOpenedOn(pathname);
    // First opening only: the list is reused while the menu stays mounted.
    if (!isAdmin && classes.status === "idle") load();
  };

  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpenedOn(undefined);
      trigger.current?.focus();
    };
    const onPointer = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpenedOn(undefined);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  const leave = () => {
    close();
    void logout();
  };

  return (
    <div
      ref={root}
      className={styles.root}
      // Tab past the last item moves the focus out of the menu: close it, there is no trap.
      onBlur={(e) => {
        if (open && e.relatedTarget && !root.current?.contains(e.relatedTarget as Node)) close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={user.name}
        title={user.name}
        onClick={toggle}
      >
        <Avatar user={user} />
        <span className={styles.name}>{user.name}</span>
        <span className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <section ref={panel} id={panelId} className={styles.panel} aria-label={m.region} tabIndex={-1}>
          <div className={styles.identity}>
            <Avatar user={user} big />
            <div className={styles.who}>
              <span className={styles.fullName}>{user.name}</span>
              {user.email && <span className={styles.email}>{user.email}</span>}
              {isAdmin && <span className={styles.role}>{messages.home.role.ADMIN}</span>}
            </div>
          </div>

          {!isAdmin && (
            <div className={styles.classes}>
              <h2 className={styles.heading}>{m.myClasses}</h2>
              {classes.status === "error" ? (
                <div role="alert" className={styles.error}>
                  <p>{m.error}</p>
                  <button type="button" className={styles.retry} onClick={load}>
                    {m.retry}
                  </button>
                </div>
              ) : classes.status === "ready" ? (
                <ClassList data={classes.data} teacher={isTeacher} onChoose={close} />
              ) : (
                <div className={styles.skeleton} aria-busy="true" data-testid="classes-skeleton">
                  <span />
                  <span />
                </div>
              )}
            </div>
          )}

          <Link href="/app/profile" className={styles.profile} onClick={close}>
            {m.myProfile}
          </Link>
          <hr className={styles.divider} />
          <button type="button" className={styles.logout} onClick={leave}>
            {messages.auth.logout}
          </button>
        </section>
      )}
    </div>
  );
}

function ClassList({ data, teacher, onChoose }: { data: MyClassesResult; teacher: boolean; onChoose: () => void }) {
  if (data.items.length === 0) return <p className={styles.empty}>{m.empty}</p>;
  const shown = data.items.slice(0, MAX_CLASSES);
  const more = data.total > MAX_CLASSES;
  return (
    <>
      <ul className={styles.list}>
        {shown.map((c) => {
          const body = (
            <>
              <span className={styles.className}>{c.name}</span>
              <span className={styles.classMeta}>{`${c.courseCode} · ${c.semester}`}</span>
              {c.enrollmentStatus === "PENDING_MODERATION" && <span className={styles.tag}>{m.pending}</span>}
            </>
          );
          return (
            <li key={c.id}>
              {teacher ? (
                <Link href={`/app/classes/${c.id}`} className={`${styles.item} ${styles.itemLink}`} onClick={onChoose}>
                  {body}
                </Link>
              ) : (
                <div className={styles.item}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {more &&
        (teacher ? (
          <Link href="/app/classes" className={styles.seeAll} onClick={onChoose}>
            {m.seeAll}
          </Link>
        ) : (
          <p className={styles.count}>{m.count(shown.length, data.total)}</p>
        ))}
    </>
  );
}

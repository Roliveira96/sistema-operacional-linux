"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./page.module.scss";

const m = messages.classroom;

type State = { kind: "loading" } | { kind: "none" } | { kind: "denied" } | { kind: "error" } | { kind: "room"; session: LiveSession };

export interface LiveGateProps {
  params: Promise<{ id: string }> | { id: string };
  /** Who the window is for: the teacher and the administrator, or everybody. */
  teacherOnly?: boolean;
  children(room: { classId: string; userId: string; isStudent: boolean; session: LiveSession }): ReactNode;
}

/** Opens the class in progress for a window of the live class, and says why when it cannot (SPEC-051; SPEC-055). */
export function LiveGate({ params, teacherOnly = false, children }: LiveGateProps) {
  const { user } = useAuth();
  const [id, setId] = useState<string | null>(null);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    void Promise.resolve(params).then((p) => active && setId(p.id));
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    classroomService.getActive(id).then(
      (room) => active && setState(room.hasActiveSession ? { kind: "room", session: room.session } : { kind: "none" }),
      (err: unknown) => {
        if (!active) return;
        const refused = err instanceof ApiProblemError && (err.status === 403 || err.status === 404);
        setState({ kind: refused ? "denied" : "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [id]);

  if (!user || !id) return null;

  const isStudent = user.role === "STUDENT";
  if (state.kind === "room" && !(teacherOnly && isStudent)) {
    return <>{children({ classId: id, userId: user.userId, isStudent, session: state.session })}</>;
  }

  const text =
    state.kind === "room"
      ? m.present.teacherOnly
      : state.kind === "none"
        ? m.room.noActive
        : state.kind === "denied"
          ? m.room.noAccess
          : state.kind === "error"
            ? m.room.loadError
            : m.panel.loading;
  return (
    <main className={styles.container}>
      <p className={styles.message} role={state.kind === "loading" ? "status" : undefined}>
        {text}
      </p>
      {state.kind !== "loading" && (
        <Link href={`/app/classes/${id}`} className={styles.link}>
          {m.room.backToClass}
        </Link>
      )}
    </main>
  );
}

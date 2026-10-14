"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LiveClassroom } from "@/components/Classroom/LiveClassroom/LiveClassroom";
import { useAuth } from "@/hooks/useAuth";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveSession } from "@/services/classroomService";
import { ApiProblemError } from "@/services/httpClient";
import styles from "./page.module.scss";

const m = messages.classroom;

type State = { kind: "loading" } | { kind: "none" } | { kind: "denied" } | { kind: "error" } | { kind: "room"; session: LiveSession };

/** The live classroom of a class (SPEC-051): it opens the class in progress, for the teacher and for the enrolled students. */
export default function LivePage({ params }: { params: Promise<{ id: string }> | { id: string } }) {
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

  if (state.kind === "room") {
    return <LiveClassroom classId={id} role={user.role === "STUDENT" ? "student" : "teacher"} userId={user.userId} session={state.session} />;
  }

  const text = state.kind === "none" ? m.room.noActive : state.kind === "denied" ? m.room.noAccess : state.kind === "error" ? m.room.loadError : m.panel.loading;
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

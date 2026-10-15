"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ClassCalendar } from "@/components/ClassCalendar/ClassCalendar";
import { SessionContentForm } from "@/components/SessionContentForm/SessionContentForm";
import { SessionForm } from "@/components/SessionForm/SessionForm";
import { messages } from "@/messages/pt-BR";
import { scheduleService, startLiveFromSession, type Session, type SessionInput } from "@/services/scheduleService";

export interface ClassSessionsCalendarProps {
  classId: string;
  /** Changes when the calendar has to load again, e.g. after the meetings were applied. */
  reloadKey?: number;
  /** Active students, only to tell how many get the e-mail of a change. */
  studentCount?: number;
  initialMonth?: Date;
  today?: Date;
}

/** Takes the browser to the live class; it exists only after a class was started, so the router is not needed before (SPEC-053 CA-11). */
function GoToLive({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.push(href);
  }, [router, href]);
  return null;
}

/**
 * The real calendar of a saved class, where the teacher cancels, adjusts or adds a lesson on a day
 * (SPEC-044, section 3.1.2). Events and special periods are edited only in the agenda of the class.
 */
export function ClassSessionsCalendar({ classId, reloadKey = 0, studentCount = 0, initialMonth, today }: ClassSessionsCalendarProps) {
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Session | null>(null);
  const [extraDate, setExtraDate] = useState<string | null>(null);
  const [contentOf, setContentOf] = useState<Session | null>(null);
  const [startError, setStartError] = useState(false);
  const [startedLive, setStartedLive] = useState(false);

  const load = useCallback((from: string, to: string) => scheduleService.classCalendar(classId, from, to), [classId]);
  const reloadCalendar = () => setReload((n) => n + 1);
  const loadContent = useCallback((s: Session) => scheduleService.getSessionContent(classId, s.id), [classId]);

  const startLive = (s: Session, className: string) => {
    setStartError(false);
    startLiveFromSession(classId, s, className).then(
      () => setStartedLive(true),
      () => setStartError(true),
    );
  };

  const update = async (payload: SessionInput) => {
    if (!editing) return;
    await scheduleService.updateSession(classId, editing.id, payload);
    reloadCalendar();
  };
  const revert = async () => {
    if (!editing) return;
    await scheduleService.revertSession(classId, editing.id);
    reloadCalendar();
  };
  const remove = async () => {
    if (!editing) return;
    await scheduleService.deleteSession(classId, editing.id);
    reloadCalendar();
  };
  const createExtra = async (payload: SessionInput) => {
    await scheduleService.createSession(classId, payload);
    reloadCalendar();
  };

  return (
    <>
      <ClassCalendar
        load={load}
        editable
        initialMonth={initialMonth}
        today={today}
        reloadKey={reloadKey + reload}
        onEditSession={setEditing}
        onAddSession={setExtraDate}
        loadContent={loadContent}
        onEditContent={setContentOf}
        onStartLive={startLive}
      />
      {startError && (
        <p role="alert">
          {messages.classroom.panel.errors.start}
        </p>
      )}
      {startedLive && <GoToLive href={`/app/classes/${classId}/live`} />}
      {contentOf && <SessionContentForm classId={classId} session={contentOf} onSaved={reloadCalendar} onClose={() => setContentOf(null)} />}
      {editing && (
        <SessionForm
          mode="edit"
          session={editing}
          studentCount={studentCount}
          onSubmit={update}
          onRevert={revert}
          onDelete={editing.origin === "EXTRA" ? remove : undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {extraDate && (
        <SessionForm
          mode="extra"
          date={extraDate}
          studentCount={studentCount}
          onSubmit={createExtra}
          onClose={() => setExtraDate(null)}
        />
      )}
    </>
  );
}

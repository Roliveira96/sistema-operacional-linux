"use client";

import { useCallback, useState } from "react";
import { ClassCalendar } from "@/components/ClassCalendar/ClassCalendar";
import { SessionForm } from "@/components/SessionForm/SessionForm";
import { scheduleService, type Session, type SessionInput } from "@/services/scheduleService";

export interface ClassSessionsCalendarProps {
  classId: string;
  /** Changes when the calendar has to load again, e.g. after the meetings were applied. */
  reloadKey?: number;
  /** Active students, only to tell how many get the e-mail of a change. */
  studentCount?: number;
  initialMonth?: Date;
  today?: Date;
}

/**
 * The real calendar of a saved class, where the teacher cancels, adjusts or adds a lesson on a day
 * (SPEC-044, section 3.1.2). Events and special periods are edited only in the agenda of the class.
 */
export function ClassSessionsCalendar({ classId, reloadKey = 0, studentCount = 0, initialMonth, today }: ClassSessionsCalendarProps) {
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Session | null>(null);
  const [extraDate, setExtraDate] = useState<string | null>(null);

  const load = useCallback((from: string, to: string) => scheduleService.classCalendar(classId, from, to), [classId]);
  const reloadCalendar = () => setReload((n) => n + 1);

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
      />
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

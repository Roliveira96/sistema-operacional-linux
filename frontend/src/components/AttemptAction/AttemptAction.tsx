"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/Button/ButtonLink";
import { formatDateTime } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { MyAccess, StudentAttempt } from "@/services/assessmentService";

const a = messages.assessments.attemptAction;
/** How often the access is asked again while the exam is not open yet. */
const RECHECK_MS = 15_000;

export interface AttemptActionProps {
  classId: string;
  assessmentId: string;
  loadAccess: () => Promise<MyAccess>;
  /** The own attempt of the student, or null when there is none. */
  loadAttempt: () => Promise<StudentAttempt | null>;
}

/**
 * The way of the student into the exam, on the detail (SPEC-090 CA-11): enter it when the access is allowed or the exam waits for the teacher
 * (the waiting room, SPEC-091 RN-02), go back to the attempt in progress, or
 * read that it was delivered. The exam opens in a window of its own, as the simulator does.
 */
export function AttemptAction({ classId, assessmentId, loadAccess, loadAttempt }: AttemptActionProps) {
  const [state, setState] = useState<{ access: MyAccess | null; attempt: StudentAttempt | null } | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      Promise.all([loadAccess().catch(() => null), loadAttempt().catch(() => null)]).then(([access, attempt]) => {
        if (!alive) return;
        setState({ access, attempt });
        // the page may be open before the period: ask again until the exam opens, so the way in shows up without a reload
        if (!attempt && access?.reason === "NOT_OPEN_YET") timer = setTimeout(load, RECHECK_MS);
      });
    load();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [loadAccess, loadAttempt]);

  if (!state) return null;
  const href = `/app/classes/${classId}/assessments/${assessmentId}/take`;
  const { access, attempt } = state;
  if (attempt && attempt.status !== "IN_PROGRESS") return <p role="status">{a.delivered(formatDateTime(attempt.submittedAt ?? attempt.startedAt))}</p>;
  // Before the start the window shows the waiting room and enters by itself (SPEC-091 RN-02), so the way in is there too.
  if (!attempt && !access?.allowed && access?.reason !== "NOT_STARTED") return null;
  const label = attempt ? a.back : a.enter;
  return (
    <ButtonLink href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={a.newWindow}>
      {label}
    </ButtonLink>
  );
}

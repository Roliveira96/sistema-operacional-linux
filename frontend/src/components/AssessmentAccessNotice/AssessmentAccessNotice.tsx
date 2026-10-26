"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { MyAccess } from "@/services/assessmentService";
import styles from "./AssessmentAccessNotice.module.scss";

const m = messages.assessments;

/** How often the access is asked again while the tab is in view, the same of the countdown (SPEC-075 CA-28, SPEC-076 CA-17). */
const CHECK_EVERY_MS = 30_000;

export interface AssessmentAccessNoticeProps {
  /** Reads the own access of the student: the modality and, when the clearance is required, their own state of it. */
  load: () => Promise<MyAccess>;
}

/**
 * What the student reads of their own access (SPEC-076 section 3.1, D-09): the modality, and for an in-person assessment that requires the clearance
 * whether they are cleared, still waiting or refused, with a fixed banner and the reason in the last case. It asks again every 30 seconds with the tab
 * in view and the moment it comes back into view, so the decision of the teacher shows without reloading the page. It stays quiet while it cannot
 * read. There is no field for a token and no button to start here.
 */
export function AssessmentAccessNotice({ load }: AssessmentAccessNoticeProps) {
  const [access, setAccess] = useState<MyAccess | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      load().then(
        (read) => alive && setAccess(read),
        () => undefined, // quiet: the card of the assessment already says what failed, and the next reading tries again
      );
    };
    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [load]);

  if (!access) return null;
  // until the teacher starts the exam the student reads only that, and not their own state of the clearance (SPEC-083 RN-06)
  const notStarted = access.reason === "NOT_STARTED";
  const own = access.requiresClearance && !notStarted ? access.clearance : undefined;
  return (
    <section className={styles.notice}>
      <p className={styles.modality}>{m.modalityIs(m.modality[access.modality] ?? "")}</p>
      {notStarted && (
        <p role="status" className={styles.pending}>
          {m.access.notStarted}
        </p>
      )}
      {own?.status === "PENDING" && (
        <p role="status" className={styles.pending}>
          {m.access.pending}
        </p>
      )}
      {own?.status === "APPROVED" && (
        <p role="status" className={styles.approved}>
          {m.access.approved}
        </p>
      )}
      {own?.status === "REJECTED" && (
        <div role="alert" className={styles.rejected}>
          <strong>{m.access.rejectedTitle}</strong>
          <span>{own.rejectionReason || m.access.defaultReason}</span>
        </div>
      )}
    </section>
  );
}

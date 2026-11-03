"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { MyAccess } from "@/services/assessmentService";
import styles from "./AssessmentAccessNotice.module.scss";

const m = messages.assessments;

/** How often the access is asked again while the tab is in view, the same of the countdown (SPEC-075 CA-28, SPEC-076 CA-17). */
const CHECK_EVERY_MS = 30_000;

export interface AssessmentAccessNoticeProps {
  /** Reads the own access of the student: whether they may enter, why and the modality. */
  load: () => Promise<MyAccess>;
}

/**
 * What the student reads of their own access (SPEC-076 D-09, SPEC-083 RN-06, SPEC-091 RN-03): the modality and, while the teacher has not started
 * the exam, that they wait for her. It asks again every 30 seconds with the tab in view and the moment it comes back into view, so the start shows
 * without reloading the page. It stays quiet while it cannot read. There is no field for a token and no button to start here.
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
  return (
    <section className={styles.notice}>
      <p className={styles.modality}>{m.modalityIs(m.modality[access.modality] ?? "")}</p>
      {access.reason === "NOT_STARTED" && (
        <p role="status" className={styles.pending}>
          {m.access.notStartedOpen}
        </p>
      )}
    </section>
  );
}

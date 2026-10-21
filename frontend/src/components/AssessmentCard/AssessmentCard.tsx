"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { countdown, formatDay, formatHour, formatPeriod, formatScore } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AssessmentPublic } from "@/services/assessmentService";
import styles from "./AssessmentCard.module.scss";

const m = messages.assessments;

/** How often the assessment is asked again while the tab is in view (SPEC-075 CA-28). */
const CHECK_EVERY_MS = 30_000;

export interface AssessmentCardProps {
  /** Reads the assessment in the public form; it brings the clock of the server for the countdown. */
  load: () => Promise<AssessmentPublic>;
}

/**
 * The assessment for the student (SPEC-075 section 3.1): the public data, a countdown with the clock of the server before it starts, and the
 * canceled form with the reason. It asks the server again every 30 seconds with the tab in view, and the moment the tab comes back into view, so
 * a change of the dates or a cancellation shows up without reloading the page. There is no way to start the assessment here.
 */
export function AssessmentCard({ load }: AssessmentCardProps) {
  const [data, setData] = useState<{ assessment: AssessmentPublic; offset: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState === "hidden") return;
      load().then(
        (assessment) => {
          if (!alive) return;
          // the countdown runs on the clock of the server: the distance between it and the browser at the moment it answered
          setData({ assessment, offset: Date.parse(assessment.serverNow) - Date.now() });
          setNow(Date.now());
          setFailed(false);
        },
        () => alive && setFailed(true),
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
  }, [load, attempt]);

  const counting = data?.assessment.status === "SCHEDULED" && data.assessment.phase === "UPCOMING";
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  // A later reading that fails keeps the card there is: the error is for when there is none.
  if (!data) {
    return failed ? (
      <div role="alert" className={styles.problem}>
        <span>{m.card.loadError}</span>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {m.retry}
        </Button>
      </div>
    ) : (
      <p role="status" className={styles.muted}>
        {m.card.loading}
      </p>
    );
  }

  const a = data.assessment;
  const canceled = a.status === "CANCELED";
  const remaining = Date.parse(a.startsAt) - (now + data.offset);
  return (
    <article className={styles.card} data-canceled={canceled ? "true" : undefined}>
      <p className={styles.kind}>{m.type[a.type]}</p>
      <h2 className={styles.title}>{canceled ? <s>{a.title}</s> : a.title}</h2>
      {canceled && (
        <p className={styles.banner}>
          <strong>{m.canceledBanner}</strong>
          {a.cancelReason && <span>{a.cancelReason}</span>}
        </p>
      )}
      <p>{formatPeriod(a.startsAt, a.endsAt)}</p>
      <p>{m.duration(a.durationMinutes)}</p>
      <p>{m.maxScore(formatScore(a.maxScore))}</p>
      {a.description && (
        // HTML that the server filtered when the instructions were saved (SPEC-077 RN-01).
        <div className={styles.description} dangerouslySetInnerHTML={{ __html: a.description }} />
      )}
      {!canceled &&
        (a.phase === "UPCOMING" ? (
          <div className={styles.count}>
            <p>{m.card.startsIn}</p>
            <p role="timer" aria-live="off" className={styles.timer}>
              {countdown(remaining)}
            </p>
          </div>
        ) : a.phase === "RUNNING" ? (
          <p className={styles.state}>{m.card.running(formatDay(a.endsAt), formatHour(a.endsAt))}</p>
        ) : (
          <p className={styles.state}>{m.card.ended(formatDay(a.endsAt), formatHour(a.endsAt))}</p>
        ))}
    </article>
  );
}

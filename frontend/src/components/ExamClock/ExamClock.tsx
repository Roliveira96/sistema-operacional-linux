"use client";

import { useEffect, useState } from "react";
import { countdown, formatHour } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import type { AssessmentDetail } from "@/services/assessmentService";
import styles from "./ExamClock.module.scss";

const r = messages.assessments.room;

/** The last minutes of the exam, when the time turns to a warning. */
const LAST_MINUTES_MS = 10 * 60_000;

/** What the room of the exam tells the clock through the channel of the browser. */
interface RoomState {
  type: "state";
  startedAt: string | null;
  endsAt: string;
  offset: number;
  hands: string[];
}

/**
 * The clock of the exam for the class (SPEC-092): a tab of its own, made to be projected, with the time to the end in big letters and the names of
 * the raised hands. The times come from the assessment; the start, the hands and the clock of the server come from the room of the exam open in
 * another tab, through a `BroadcastChannel`. Without the room the clock keeps counting, without the hands.
 */
export function ExamClock({ assessment }: { assessment: AssessmentDetail }) {
  const [startedAt, setStartedAt] = useState<string | null>(assessment.startedAt ?? null);
  const [endsAt, setEndsAt] = useState(assessment.endsAt);
  const [offset, setOffset] = useState(() => (assessment.serverNow ? Date.parse(assessment.serverNow) - Date.now() : 0));
  const [hands, setHands] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(`exam-room:${assessment.id}`);
    ch.onmessage = (e: MessageEvent<RoomState>) => {
      if (e.data?.type !== "state") return;
      setStartedAt(e.data.startedAt);
      setEndsAt(e.data.endsAt);
      setOffset(e.data.offset);
      setHands(e.data.hands);
    };
    ch.postMessage({ type: "hello" });
    return () => ch.close();
  }, [assessment.id]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  const left = Math.max(Date.parse(endsAt) - (now + offset), 0);

  return (
    <div className={styles.clock}>
      <h1 className={styles.title}>{assessment.title}</h1>
      {!startedAt ? (
        <p className={styles.state}>{r.clock.notStarted}</p>
      ) : left === 0 ? (
        <p className={styles.state}>{r.clock.over}</p>
      ) : (
        <div className={`${styles.time} ${left <= LAST_MINUTES_MS ? styles.ending : ""}`}>
          <p className={styles.label}>{r.endsIn}</p>
          <p role="timer" aria-label={r.timeLeft} className={styles.timer}>
            {countdown(left)}
          </p>
          <p className={styles.label}>{r.endsAt(formatHour(endsAt))}</p>
        </div>
      )}
      <div aria-live="polite" className={styles.handsSlot}>
        {hands.length > 0 && <p className={styles.hands}>{r.clock.hands(hands)}</p>}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { messages } from "@/messages/pt-BR";
import type { LiveExercise } from "@/services/classroomService";
import { mmss } from "./format";

export interface ExerciseClockProps {
  exercise: Pick<LiveExercise, "endsAt" | "skewMs"> & Partial<Pick<LiveExercise, "status">>;
  label: string;
  className?: string;
}

/**
 * The time left of the round, as mm:ss, counted to its end by the clock of the server (the one of the browser plus the difference the room told), so it is the
 * same for every student (SPEC-065 CA-03). It stops at 00:00 and waits for the room to say the round ended: the server is the one that ends it. A paused round
 * says so instead of a time (SPEC-071).
 */
export function ExerciseClock({ exercise, label, className }: ExerciseClockProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const left = Date.parse(exercise.endsAt) - (now + exercise.skewMs);
  return (
    <span role="timer" aria-label={label} className={className}>
      {exercise.status === "PAUSED" ? messages.classroom.exerciseArea.pausedClock : mmss(Math.ceil(left / 1000))}
    </span>
  );
}

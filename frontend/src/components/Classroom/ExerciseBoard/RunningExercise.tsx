"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import type { ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import type { AdmissionEntry, ExerciseProgressEntry, LiveExercise } from "@/services/classroomService";
import { TerminalMirror } from "../TerminalMirror/TerminalMirror";
import styles from "./ExerciseBoard.module.scss";
import { cardState, hintMessage, mmss, secondsLeft, type BoardHint, type CardState } from "./exercises";

const m = messages.classroom.exerciseBoard;

/** A clock that ticks every second, starting from the time of the moment it is mounted. */
function useSecondClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

const byName = (a: AdmissionEntry, b: AdmissionEntry) => a.name.localeCompare(b.name, "pt-BR");

interface StudentCardProps {
  student: AdmissionEntry;
  entry: ExerciseProgressEntry | undefined;
  state: CardState;
  watched: boolean;
  canControl: boolean;
  onWatch(studentId: string | null): void;
  onTip(studentId: string): void;
}

/**
 * A student in the round (SPEC-065 CA-06): the name, where he stands in words, how far he is in words and in a bar, his last command and the two buttons.
 * Everything that came from the student is drawn as text; React writes it as such, so no HTML in it ever runs (CA-15).
 */
function StudentCard({ student, entry, state, watched, canControl, onWatch, onTip }: StudentCardProps) {
  const total = entry?.total ?? 0;
  const met = state === "done" ? total : (entry?.met ?? 0);
  const where = state === "doing" ? m.doing : state === "silent" ? m.silent : m.done(mmss(entry?.elapsedSeconds ?? 0), m.points(entry?.points ?? 0));
  return (
    <li className={`${styles.card} ${styles[state]}`}>
      <strong className={styles.studentName} data-testid="exercise-student-name">
        {student.name}
      </strong>
      <span className={styles.state}>{where}</span>
      {total > 0 ? (
        <>
          <span className={styles.muted}>{m.progress(met, total)}</span>
          <div className={styles.bar} role="progressbar" aria-label={m.progressLabel(student.name)} aria-valuemin={0} aria-valuemax={total} aria-valuenow={met}>
            <span className={styles.fill} style={{ inlineSize: `${(met / total) * 100}%` }} />
          </div>
        </>
      ) : (
        state !== "done" && <span className={styles.muted}>{m.noProgress}</span>
      )}
      {entry?.last && (
        <code className={styles.last} title={entry.last}>
          {entry.last}
        </code>
      )}
      <div className={styles.actions}>
        <Button
          variant={watched ? "primary" : "secondary"}
          size="sm"
          aria-pressed={watched}
          aria-label={m.watchFor(student.name)}
          disabled={!canControl}
          onClick={() => onWatch(watched ? null : student.studentId)}
        >
          {m.watch}
        </Button>
        <Button variant="secondary" size="sm" aria-label={m.tipFor(student.name)} onClick={() => onTip(student.studentId)}>
          {m.tip}
        </Button>
      </div>
    </li>
  );
}

export interface RunningExerciseProps {
  exercise: LiveExercise;
  /** The students who are accepted and online, each with a card. */
  students: AdmissionEntry[];
  progress: Record<string, ExerciseProgressEntry>;
  watching: string | null;
  watchedScreen: { studentId: string; screen: ScreenElement } | null;
  /** The tips of the exercise, to send to everybody. */
  hints: BoardHint[];
  canControl: boolean;
  /** The class went back to the slides while the students stay in the exercise (SPEC-065 section 6). */
  classOnSlides: boolean;
  nameOf(studentId: string): string;
  onEnd(): void;
  onWatch(studentId: string | null): void;
  onTip(studentId: string): void;
  /** Sends the text to the whole class by the chat, and says whether it went. */
  onSendTip(text: string): boolean;
}

/**
 * The round that is running (SPEC-065 3.3): the clock by the time of the server, how many finished, the button that ends it, the terminal of the student
 * who is watched, the tips of the exercise and a card for each student. The clock lives here, so it only runs while a round does and always starts fresh.
 */
export function RunningExercise({ exercise, students, progress, watching, watchedScreen, hints, canControl, classOnSlides, nameOf, onEnd, onWatch, onTip, onSendTip }: RunningExerciseProps) {
  const now = useSecondClock();
  const tipsId = useId();
  const terminalId = useId();
  const [sent, setSent] = useState<"sent" | "failed" | null>(null);

  const left = secondsLeft(exercise.endsAt, exercise.skewMs, now);
  const serverNow = now + exercise.skewMs;
  // Who is still doing it comes first, by name; who finished comes after, by time.
  const cards = students
    .map((student) => ({ student, entry: progress[student.studentId], state: cardState(progress[student.studentId], exercise.startedAt, serverNow) }))
    .sort((a, b) => {
      const aDone = a.state === "done";
      if (aDone !== (b.state === "done")) return aDone ? 1 : -1;
      return aDone ? (a.entry?.elapsedSeconds ?? 0) - (b.entry?.elapsedSeconds ?? 0) || byName(a.student, b.student) : byName(a.student, b.student);
    });
  const done = cards.filter((card) => card.state === "done").length;

  return (
    <div className={styles.running}>
      <div className={styles.head}>
        <div className={styles.what}>
          <h3 className={styles.roundTitle}>{exercise.title}</h3>
          <span className={styles.level}>{m.level[exercise.difficulty]}</span>
        </div>
        <span className={styles.clock} role="timer" aria-label={m.timer}>
          {mmss(left)}
        </span>
        <span className={styles.count}>{m.completed(done, cards.length)}</span>
        <Button variant="danger" size="sm" disabled={!canControl} onClick={onEnd}>
          {m.end}
        </Button>
      </div>
      {left === 0 && (
        <p className={styles.muted} role="status">
          {m.timeUp}
        </p>
      )}
      {classOnSlides && <p className={styles.notice}>{m.onSlides}</p>}

      {watching && (
        <section className={styles.terminal} aria-labelledby={terminalId}>
          <div className={styles.terminalHead}>
            <h4 id={terminalId} className={styles.subtitle}>
              {m.terminalOf(nameOf(watching))}
            </h4>
            <Button variant="secondary" size="sm" onClick={() => onWatch(null)}>
              {m.stopWatching}
            </Button>
          </div>
          <div className={styles.terminalBody}>
            <TerminalMirror screen={watchedScreen?.studentId === watching ? watchedScreen.screen : null} />
          </div>
        </section>
      )}

      <section className={styles.tips} aria-labelledby={tipsId}>
        <h4 id={tipsId} className={styles.subtitle}>
          {m.tipsTitle}
        </h4>
        {hints.length === 0 ? (
          <p className={styles.muted}>{m.noTips}</p>
        ) : (
          <ol className={styles.tipList} aria-labelledby={tipsId}>
            {hints.map((hint, index) => (
              <li key={index} className={styles.tip}>
                <div className={styles.tipText}>
                  <span>{hint.text}</span>
                  {hint.command && <code className={styles.command}>{hint.command}</code>}
                </div>
                <Button variant="secondary" size="sm" aria-label={m.sendTipAllFor(index + 1)} onClick={() => setSent(onSendTip(hintMessage(hint)) ? "sent" : "failed")}>
                  {m.sendTipAll}
                </Button>
              </li>
            ))}
          </ol>
        )}
        {sent === "sent" && (
          <p className={styles.sent} role="status">
            {m.tipSent}
          </p>
        )}
        {sent === "failed" && (
          <p className={styles.failed} role="alert">
            {m.tipFailed}
          </p>
        )}
      </section>

      {cards.length === 0 ? (
        <p className={styles.muted}>{m.noStudents}</p>
      ) : (
        <ul className={styles.grid} aria-label={m.studentsLabel}>
          {cards.map(({ student, entry, state }) => (
            <StudentCard key={student.studentId} student={student} entry={entry} state={state} watched={watching === student.studentId} canControl={canControl} onWatch={onWatch} onTip={onTip} />
          ))}
        </ul>
      )}
    </div>
  );
}

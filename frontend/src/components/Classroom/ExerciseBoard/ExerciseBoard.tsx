"use client";

import { useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import type { ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import type { AdmissionEntry, ChatTarget, ExerciseProgressEntry, LiveChatMessage, LiveExercise } from "@/services/classroomService";
import styles from "./ExerciseBoard.module.scss";
import { clampMinutes, DEFAULT_MINUTES, hintsOf, mmss, type BoardExercise } from "./exercises";
import { BackToLesson, ExtendControl } from "./GuidedControls";
import { RunningExercise } from "./RunningExercise";

const m = messages.classroom.exerciseBoard;

interface ExerciseListProps {
  exercises: BoardExercise[];
  canControl: boolean;
  onStart(blockId: string, index: number, minutes: number): void;
}

/** The exercises of the module with the minutes of each and the button that starts it (SPEC-065 3.3). */
function ExerciseList({ exercises, canControl, onStart }: ExerciseListProps) {
  const idBase = useId();
  // What the teacher typed in the field of each exercise, as text: it can be empty while he types, and is brought to the limits when he leaves it.
  const [typed, setTyped] = useState<Record<string, string>>({});

  if (exercises.length === 0) return <p className={styles.muted}>{m.noExercises}</p>;

  return (
    <ul className={styles.list} aria-label={m.listLabel}>
      {exercises.map((exercise) => {
        const key = `${exercise.blockId}:${exercise.index}`;
        const where = m.where(exercise.blockNumber, exercise.index + 1);
        const title = exercise.title || m.untitled;
        const startable = exercise.conditions > 0;
        const minutes = typed[key] ?? String(DEFAULT_MINUTES);
        const reasonId = `${idBase}-${key}`;
        return (
          <li key={key} className={styles.item}>
            <div className={styles.what}>
              <span className={styles.where}>{where}</span>
              <strong className={styles.name}>{title}</strong>
              <span className={styles.level}>{m.level[exercise.difficulty]}</span>
            </div>
            <div className={styles.controls}>
              <label className={styles.minutes}>
                <span>{m.minutes}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={60}
                  step={1}
                  value={minutes}
                  disabled={!startable}
                  aria-label={m.minutesFor(`${where}: ${title}`)}
                  onChange={(event) => setTyped((all) => ({ ...all, [key]: event.target.value }))}
                  onBlur={() => setTyped((all) => ({ ...all, [key]: String(clampMinutes(minutes)) }))}
                />
              </label>
              <Button
                variant="primary"
                size="sm"
                disabled={!canControl || !startable}
                aria-label={m.startFor(`${where}: ${title}`)}
                aria-describedby={startable ? undefined : reasonId}
                onClick={() => onStart(exercise.blockId, exercise.index, clampMinutes(minutes))}
              >
                {m.start}
              </Button>
            </div>
            {!startable && (
              <span id={reasonId} className={styles.reason}>
                {m.noConditions}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface EndedExerciseProps {
  exercise: LiveExercise;
  /** The students who are accepted and online. */
  students: AdmissionEntry[];
  progress: Record<string, ExerciseProgressEntry>;
  canControl: boolean;
  nameOf(studentId: string): string;
  onReveal(visible: boolean): void;
  onNewRound(): void;
  onExtend(minutes: number): void;
  onClose(): void;
}

/**
 * The round that ended (SPEC-065 3.3): why it ended, who finished and how many did not, the decision of showing the result. While the students are still in
 * the area (ENDED), more time or going back to the lesson; once the class went back (CLOSED), the way to a new round (SPEC-071 section 3.5).
 */
function EndedExercise({ exercise, students, progress, canControl, nameOf, onReveal, onNewRound, onExtend, onClose }: EndedExerciseProps) {
  const closed = exercise.status === "CLOSED";
  const finished = Object.values(progress)
    .filter((entry) => entry.completedAt)
    .map((entry) => ({ id: entry.studentId, name: nameOf(entry.studentId), seconds: entry.elapsedSeconds ?? 0, points: entry.points ?? 0 }))
    .sort((a, b) => b.points - a.points || a.seconds - b.seconds || a.name.localeCompare(b.name, "pt-BR"));
  // The panel is not told how many took part, so it counts who sent progress and who is here now: a student who came and left with nothing sent is not counted.
  const participants = new Set([...Object.keys(progress), ...students.map((student) => student.studentId)]);
  const notFinished = participants.size - finished.length;
  const visible = exercise.resultVisible;

  return (
    <div className={styles.ended}>
      <h3 className={styles.roundTitle}>{m.ended}</h3>
      {exercise.endedBy && <p className={styles.muted}>{m.endedBy[exercise.endedBy]}</p>}
      <div className={styles.what}>
        <strong className={styles.name}>{exercise.title}</strong>
        <span className={styles.level}>{m.level[exercise.difficulty]}</span>
      </div>

      <h4 className={styles.subtitle}>{m.summaryTitle}</h4>
      {finished.length === 0 ? (
        <p className={styles.muted}>{m.nobodyFinished}</p>
      ) : (
        <ol className={styles.finished} aria-label={m.finishedLabel}>
          {finished.map((row) => (
            <li key={row.id} className={styles.finishedRow}>
              <strong>{row.name}</strong>
              <span>{mmss(row.seconds)}</span>
              <span>{m.points(row.points)}</span>
            </li>
          ))}
        </ol>
      )}
      {notFinished > 0 ? <p className={styles.muted}>{m.notFinished(notFinished)}</p> : finished.length > 0 && <p className={styles.muted}>{m.allFinished}</p>}

      <div className={styles.actions}>
        {!closed && <ExtendControl canControl={canControl} onExtend={onExtend} />}
        <Button variant={visible ? "primary" : "secondary"} size="sm" aria-pressed={visible} disabled={!canControl} onClick={() => onReveal(!visible)}>
          {visible ? m.hide : m.reveal}
        </Button>
        {closed ? (
          <Button variant="ghost" size="sm" onClick={onNewRound}>
            {m.newRound}
          </Button>
        ) : (
          <BackToLesson canControl={canControl} secondsLeft={null} notFinished={notFinished} onClose={onClose} />
        )}
      </div>
      {visible && (
        <p className={styles.muted} role="status">
          {m.revealed}
        </p>
      )}
    </div>
  );
}

export interface ExerciseBoardProps {
  /** The round the room tells about, running or the last one that ended; null when the class had none. */
  exercise: LiveExercise | null;
  /** The practical exercises of the module of the class; null when there is no module, or it is not read yet. */
  exercises: BoardExercise[] | null;
  admitted: AdmissionEntry[];
  /** The ids of the accepted students who are in the room. */
  online: string[];
  /** What the panel knows of each student in the round. */
  progress: Record<string, ExerciseProgressEntry>;
  /** The student whose terminal the panel watches, and the last picture of it. */
  watching: string | null;
  watchedScreen: { studentId: string; screen: ScreenElement } | null;
  /** Whether this panel is the one that controls the class; the others only follow. */
  canControl: boolean;
  /** The class is on the slides. */
  classOnSlides?: boolean;
  onStart(blockId: string, index: number, minutes: number): void;
  onEnd(): void;
  onReveal(visible: boolean): void;
  onWatch(studentId: string | null): void;
  /** Opens the private conversation with the student, where the tips of the exercise wait. */
  onTip(studentId: string): void;
  /** Sends the text of a tip to the whole class, by the chat, and says whether it went. */
  onSendTip(text: string): boolean;
  /** SPEC-071: the student taken over, the students with the hand up, the chat of the room and the controls of the guided practice. */
  takeover?: string | null;
  hands?: string[];
  chat?: LiveChatMessage[];
  connected?: boolean;
  onPause?(paused: boolean): void;
  onExtend?(minutes: number): void;
  onClose?(): void;
  onTakeover?(studentId: string, on: boolean): void;
  onKey?(studentId: string, key: { key: string; ctrl: boolean; alt: boolean; shift: boolean }): void;
  onPaste?(studentId: string, text: string): void;
  onSendChat?(text: string, to: ChatTarget): boolean;
}

const nothing = () => undefined;
const notSent = () => false;

/**
 * The section "Exercício ao vivo" of the panel of the teacher (SPEC-065 3.3), in the three states of a round: no round (the list of the exercises of the
 * module, to start one), running (the clock, the cards, the terminal of a student, the tips) and ended (the summary and the result). It shows what it is
 * given and decides nothing: the room does.
 */
export function ExerciseBoard({
  exercise,
  exercises,
  admitted,
  online,
  progress,
  watching,
  watchedScreen,
  canControl,
  classOnSlides = false,
  takeover = null,
  hands = [],
  chat = [],
  connected = true,
  onStart,
  onEnd,
  onReveal,
  onWatch,
  onTip,
  onSendTip,
  onPause = nothing,
  onExtend = nothing,
  onClose = nothing,
  onTakeover = nothing,
  onKey = nothing,
  onPaste = nothing,
  onSendChat = notSent,
}: ExerciseBoardProps) {
  const titleId = useId();
  // The round that "Nova rodada" sent away: the list is back until another round comes, and a reload brings the ended round back.
  const [dismissed, setDismissed] = useState<string | null>(null);

  const round = exercise && !(exercise.status === "CLOSED" && exercise.runId === dismissed) ? exercise : null;
  // No module and no round: nothing to start and nothing to follow.
  if (!round && exercises === null) return null;

  const here = new Set(online);
  const students = admitted.filter((student) => here.has(student.studentId));
  const nameOf = (studentId: string) => admitted.find((student) => student.studentId === studentId)?.name ?? progress[studentId]?.name ?? m.unknownStudent;

  return (
    <section className={styles.board} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {m.title}
      </h2>
      {!round ? (
        <ExerciseList exercises={exercises ?? []} canControl={canControl} onStart={onStart} />
      ) : round.status === "RUNNING" || round.status === "PAUSED" ? (
        <RunningExercise
          exercise={round}
          students={students}
          progress={progress}
          watching={watching}
          watchedScreen={watchedScreen}
          hints={hintsOf(exercises, round)}
          canControl={canControl}
          classOnSlides={classOnSlides}
          takeover={takeover}
          hands={hands}
          chat={chat}
          connected={connected}
          nameOf={nameOf}
          onEnd={onEnd}
          onWatch={onWatch}
          onTip={onTip}
          onSendTip={onSendTip}
          onPause={onPause}
          onExtend={onExtend}
          onClose={onClose}
          onTakeover={onTakeover}
          onKey={onKey}
          onPaste={onPaste}
          onSendChat={onSendChat}
        />
      ) : (
        <EndedExercise
          exercise={round}
          students={students}
          progress={progress}
          canControl={canControl}
          nameOf={nameOf}
          onReveal={onReveal}
          onNewRound={() => setDismissed(round.runId)}
          onExtend={onExtend}
          onClose={onClose}
        />
      )}
    </section>
  );
}

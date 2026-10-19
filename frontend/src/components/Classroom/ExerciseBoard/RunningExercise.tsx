"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/Button/Button";
import type { ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import type { AdmissionEntry, ChatTarget, ExerciseProgressEntry, LiveChatMessage, LiveExercise } from "@/services/classroomService";
import { TerminalMirror } from "../TerminalMirror/TerminalMirror";
import styles from "./ExerciseBoard.module.scss";
import { cardState, hintMessage, mmss, nearEnd, secondsLeft, type BoardHint, type CardState } from "./exercises";
import { BackToLesson, ExtendControl } from "./GuidedControls";
import { HelpTabs, MAX_TABS, useCommandHistory } from "./HelpTabs";

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
  /** Near the end without finishing (SPEC-071 RN-11). */
  near: boolean;
  handUp: boolean;
  /** The teacher has his terminal now. */
  takenOver: boolean;
  watched: boolean;
  canControl: boolean;
  onWatch(studentId: string | null): void;
  onTip(studentId: string): void;
  onAttend(studentId: string): void;
}

/**
 * A student in the round (SPEC-065 CA-06, SPEC-071 CA-11): the name, where he stands in words, how far he is in words and in a bar, his last command, how many
 * commands he ran, his hand, the takeover, and the buttons. Everything that came from the student is drawn as text; React writes it as such, so no HTML in it
 * ever runs (CA-15).
 */
function StudentCard({ student, entry, state, near, handUp, takenOver, watched, canControl, onWatch, onTip, onAttend }: StudentCardProps) {
  const total = entry?.total ?? 0;
  const met = state === "done" ? total : (entry?.met ?? 0);
  const where = state === "doing" ? m.doing : state === "silent" ? m.silent : state === "idle" ? m.idle : m.done(mmss(entry?.elapsedSeconds ?? 0), m.points(entry?.points ?? 0));
  return (
    <li className={`${styles.card} ${styles[state]}`} data-near={near ? "true" : undefined}>
      <span className={styles.nameRow}>
        <strong className={styles.studentName} data-testid="exercise-student-name">
          {student.name}
        </strong>
        {handUp && (
          <span className={styles.hand} role="img" aria-label={m.handUp} title={m.handUp}>
            ✋
          </span>
        )}
      </span>
      <span className={styles.state}>{where}</span>
      {near && <span className={styles.near}>{m.nearEnd}</span>}
      {takenOver ? <span className={styles.helped}>{m.takenOverCard}</span> : entry?.takenOver && <span className={styles.helped}>{m.helpedCard}</span>}
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
      {entry?.commands !== undefined && <span className={styles.muted}>{m.commands(entry.commands)}</span>}
      {entry?.last && (
        <code className={styles.last} title={entry.last}>
          {entry.last}
        </code>
      )}
      <div className={styles.actions}>
        <Button variant="primary" size="sm" aria-label={m.attendFor(student.name)} onClick={() => onAttend(student.studentId)}>
          {m.attend}
        </Button>
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
  /** SPEC-071: the student taken over, the students with the hand up, the chat of the room. */
  takeover: string | null;
  hands: string[];
  chat: LiveChatMessage[];
  connected: boolean;
  nameOf(studentId: string): string;
  onEnd(): void;
  onWatch(studentId: string | null): void;
  onTip(studentId: string): void;
  /** Sends the text to the whole class by the chat, and says whether it went. */
  onSendTip(text: string): boolean;
  onPause(paused: boolean): void;
  onExtend(minutes: number): void;
  onClose(): void;
  onTakeover(studentId: string, on: boolean): void;
  onKey(studentId: string, key: { key: string; ctrl: boolean; alt: boolean; shift: boolean }): void;
  onPaste(studentId: string, text: string): void;
  onSendChat(text: string, to: ChatTarget): boolean;
}

/**
 * The round that is running or paused (SPEC-065 3.3, SPEC-071 3.5): the clock by the time of the server, how many finished, the controls (pause, more time, end,
 * back to the lesson), the tabs of help, the tips of the exercise and a card for each student. The clock lives here, so it only runs while a round does and
 * always starts fresh.
 */
export function RunningExercise(props: RunningExerciseProps) {
  const { exercise, students, progress, watching, watchedScreen, hints, canControl, classOnSlides, takeover, hands, chat, connected, nameOf } = props;
  const now = useSecondClock();
  const tipsId = useId();
  const terminalId = useId();
  const [sent, setSent] = useState<"sent" | "failed" | null>(null);
  const paused = exercise.status === "PAUSED";

  const left = secondsLeft(exercise.endsAt, exercise.skewMs, now);
  const serverNow = now + exercise.skewMs;
  const closing = !paused && nearEnd(left, exercise.durationSeconds);
  const raised = useMemo(() => new Set(hands), [hands]);
  // Who is near the end without finishing comes first, then who is still doing it, by name; who finished comes after, by time.
  const cards = students
    .map((student) => {
      const entry = progress[student.studentId];
      const state = cardState(entry, exercise.startedAt, serverNow, paused);
      return { student, entry, state, near: closing && state !== "done" };
    })
    .sort((a, b) => {
      if (a.near !== b.near) return a.near ? -1 : 1;
      const aDone = a.state === "done";
      if (aDone !== (b.state === "done")) return aDone ? 1 : -1;
      return aDone ? (a.entry?.elapsedSeconds ?? 0) - (b.entry?.elapsedSeconds ?? 0) || byName(a.student, b.student) : byName(a.student, b.student);
    });
  const done = cards.filter((card) => card.state === "done").length;

  // The tabs of help, only of this screen (RN-12): the order they were opened; the open one is the student watched.
  const [tabs, setTabs] = useState<string[]>([]);
  const [full, setFull] = useState(false);
  const attend = (studentId: string) => {
    if (!tabs.includes(studentId)) {
      if (tabs.length >= MAX_TABS) {
        setFull(true);
        return;
      }
      setTabs([...tabs, studentId]);
    }
    setFull(false);
    if (watching !== studentId) props.onWatch(studentId);
  };
  const closeTab = (studentId: string) => {
    setTabs(tabs.filter((id) => id !== studentId));
    setFull(false);
    if (watching === studentId) props.onWatch(null);
  };
  const lasts = Object.fromEntries(Object.entries(progress).map(([id, entry]) => [id, entry.last]));
  const history = useCommandHistory(lasts, exercise.runId);
  // When each tab was last seen, for the mark of a new message of its student.
  const [seen, setSeen] = useState<Record<string, string>>({});
  const lastWord = (studentId: string) => [...chat].reverse().find((message) => message.from === "STUDENT" && message.studentId === studentId)?.createdAt ?? "";
  const activeTab = watching !== null && tabs.includes(watching) ? watching : null;
  const activeWord = activeTab ? lastWord(activeTab) : "";
  if (activeTab && seen[activeTab] !== activeWord) setSeen({ ...seen, [activeTab]: activeWord });
  const helpTabs = tabs.map((studentId) => {
    const word = lastWord(studentId);
    return {
      studentId,
      name: nameOf(studentId),
      done: Boolean(progress[studentId]?.completedAt),
      attention: raised.has(studentId) || (word !== "" && word !== seen[studentId]),
      history: history[studentId] ?? [],
    };
  });

  const participants = new Set([...Object.keys(progress), ...students.map((student) => student.studentId)]);
  const notFinished = [...participants].filter((id) => !progress[id]?.completedAt).length;

  return (
    <div className={styles.running}>
      <div className={styles.head}>
        <div className={styles.what}>
          <h3 className={styles.roundTitle}>{exercise.title}</h3>
          <span className={styles.level}>{m.level[exercise.difficulty]}</span>
        </div>
        <span className={styles.clock} role="timer" aria-label={m.timer}>
          {paused ? m.pausedClock : mmss(left)}
        </span>
        <span className={styles.count}>{m.completed(done, cards.length)}</span>
      </div>
      <div className={styles.controlsRow}>
        <Button variant="secondary" size="sm" disabled={!canControl} onClick={() => props.onPause(!paused)}>
          {paused ? m.resume : m.pause}
        </Button>
        <ExtendControl canControl={canControl} onExtend={props.onExtend} />
        <Button variant="danger" size="sm" disabled={!canControl} onClick={props.onEnd}>
          {m.end}
        </Button>
        <BackToLesson canControl={canControl} secondsLeft={left} notFinished={notFinished} onClose={props.onClose} />
      </div>
      {paused && (
        <p className={styles.notice} role="status">
          {m.pausedNote}
        </p>
      )}
      {!paused && left === 0 && (
        <p className={styles.muted} role="status">
          {m.timeUp}
        </p>
      )}
      {classOnSlides && <p className={styles.notice}>{m.onSlides}</p>}
      {full && (
        <p className={styles.failed} role="alert">
          {m.tooManyTabs}
        </p>
      )}

      {tabs.length > 0 && (
        <HelpTabs
          tabs={helpTabs}
          active={activeTab}
          watchedScreen={watchedScreen}
          takeover={takeover}
          canControl={canControl}
          paused={paused}
          chat={chat}
          connected={connected}
          onSelect={attend}
          onCloseTab={closeTab}
          onTakeover={props.onTakeover}
          onKey={props.onKey}
          onPaste={props.onPaste}
          onSendChat={props.onSendChat}
        />
      )}

      {watching && !activeTab && (
        <section className={styles.terminal} aria-labelledby={terminalId}>
          <div className={styles.terminalHead}>
            <h4 id={terminalId} className={styles.subtitle}>
              {m.terminalOf(nameOf(watching))}
            </h4>
            <Button variant="secondary" size="sm" onClick={() => props.onWatch(null)}>
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
                <Button variant="secondary" size="sm" aria-label={m.sendTipAllFor(index + 1)} onClick={() => setSent(props.onSendTip(hintMessage(hint)) ? "sent" : "failed")}>
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
          {cards.map(({ student, entry, state, near }) => (
            <StudentCard
              key={student.studentId}
              student={student}
              entry={entry}
              state={state}
              near={near}
              handUp={raised.has(student.studentId)}
              takenOver={takeover === student.studentId}
              watched={watching === student.studentId}
              canControl={canControl}
              onWatch={props.onWatch}
              onTip={props.onTip}
              onAttend={attend}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

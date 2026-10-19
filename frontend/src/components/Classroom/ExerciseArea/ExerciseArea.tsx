"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { Html } from "@/components/ContentRenderer/blocks";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { TakeoverKey } from "@/hooks/useLiveClassroom";
import { checkConditions } from "@/lib/exerciseConditions";
import { messages } from "@/messages/pt-BR";
import { classroomService, type ExerciseMyResult, type ExerciseVerdict, type LiveChatMessage, type LiveExercise, type LiveModuleContent } from "@/services/classroomService";
import { exerciseSetup, type ExerciseSetup } from "./exerciseMachine";
import { clearExercise, forgetOtherRuns, loadExercise, saveExercise } from "./exerciseStorage";
import { ExerciseClock } from "./ExerciseClock";
import { ExerciseResult } from "./ExerciseResult";
import { ExerciseTerminal } from "./ExerciseTerminal";
import { mmss } from "./format";
import { createPaced, type Paced } from "./pace";
import styles from "./ExerciseArea.module.scss";

const m = messages.classroom.exerciseArea;

/** How often the progress, the picture of the terminal and the machine kept in the browser go out at most (SPEC-065 section 3.1). */
const PROGRESS_MS = 2000;
const SCREEN_MS = 200;
const SAVE_MS = 2000;
/** The progress is told again this often while the round runs, so the panel does not take a student who is only thinking for one without signal (SPEC-065 CA-06). */
const BEAT_MS = 10_000;
/** A check that fails on the network is tried again this many times, this long after the one before. */
const RETRIES = 3;
const RETRY_MS = 3000;

export interface ExerciseAreaProps {
  classId: string;
  /** The student himself, so his row of the scoreboard stands out. */
  userId: string;
  exercise: LiveExercise;
  /** The student looks at the lesson: the area is hidden, and the terminal stays open under it. */
  away: boolean;
  /** The teacher watches the terminal of this student, so its picture goes to him. */
  watched: boolean;
  /** SPEC-071: the teacher has the terminal of this student now, and where his keys come from. */
  takenOver?: boolean;
  takeoverTeacher?: string | null;
  onTakeoverKey?(listener: (key: TakeoverKey) => void): () => void;
  /** SPEC-071 RN-13: the last private message of the teacher in this round, shown over the terminal. */
  notice?: LiveChatMessage | null;
  /** How far the student is, with the commands he ran; says whether the room took it. */
  onProgress(progress: { runId: string; met: number; total: number; last: string; commands: number }): boolean;
  /** The picture of the terminal of the student; says whether the room took it. */
  onScreen(runId: string, screen: ScreenElement): boolean;
}

type Loaded = { kind: "loading" } | { kind: "error" } | { kind: "ready"; module: LiveModuleContent };

/**
 * The area of the exercise of the student, in the place of the stage while the round runs (SPEC-065 3.3): the statement, his own terminal, how many
 * conditions the machine meets, the clock and what the server says of his state. When the round ends he is told so and goes back to the stage, or sees
 * the result, if the teacher shows it. Everything is for one round: a new round starts all over.
 */
export function ExerciseArea(props: ExerciseAreaProps) {
  return <Round key={props.exercise.runId} {...props} />;
}

function Round({ classId, userId, exercise, away, watched, takenOver = false, onTakeoverKey, notice = null, onProgress, onScreen }: ExerciseAreaProps) {
  // The student stays in the area while the round runs, is paused or ended, until the class goes back to the lesson (SPEC-071 section 3.1).
  const active = exercise.status !== "CLOSED";
  const result = exercise.resultVisible ? exercise.result : undefined;
  // The module is needed to run the exercise and to show how the teacher did it, and for nothing else.
  const needed = active || result !== undefined;
  // He saw the round in this page: only then is he told that it ended; a round already over when he came in or reloaded says nothing.
  const [saw] = useState(active);
  const [resultClosed, setResultClosed] = useState(false);
  const [noticeClosed, setNoticeClosed] = useState(false);
  // What the check of the server said of the student: the room tells it only in the snapshot, so it is kept here for the end of the round, and the room's
  // own (the student reloaded after he concluded) is the same.
  const [passed, setPassed] = useState<ExerciseMyResult | null>(null);
  const mine = passed ?? exercise.myResult ?? null;
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });

  useEffect(() => forgetOtherRuns(exercise.runId), [exercise.runId]);
  // The machine is kept while the round can still get more time; a closed round needs none (SPEC-071 RN-03).
  useEffect(() => {
    if (!active) clearExercise(exercise.runId);
  }, [active, exercise.runId]);
  useEffect(() => {
    if (!needed) return;
    let active = true;
    classroomService.getLiveModule(classId).then(
      (module) => active && setLoaded({ kind: "ready", module }),
      () => active && setLoaded({ kind: "error" }),
    );
    return () => {
      active = false;
    };
  }, [classId, needed]);
  const setup = useMemo(() => (loaded.kind === "ready" ? exerciseSetup(loaded.module, exercise.blockId, exercise.index) : null), [loaded, exercise.blockId, exercise.index]);

  if (result && !resultClosed) return <ExerciseResult exercise={exercise} result={result} userId={userId} mine={mine} solution={setup?.item.solution ?? null} onBack={() => setResultClosed(true)} />;
  if (active) {
    // The shell stays the same while the exercise loads, pauses and ends, so it is one element, with one terminal, for the whole round.
    return (
      <section className={styles.area} aria-label={m.region} hidden={away}>
        {setup ? (
          <Workspace
            classId={classId}
            exercise={exercise}
            setup={setup}
            mine={mine}
            watched={watched}
            takenOver={takenOver}
            onTakeoverKey={onTakeoverKey}
            notice={notice}
            onPassed={setPassed}
            onProgress={onProgress}
            onScreen={onScreen}
          />
        ) : loaded.kind === "loading" ? (
          <p className={styles.note} role="status">
            {m.loading}
          </p>
        ) : (
          <p className={styles.error} role="alert">
            {m.loadError}
          </p>
        )}
      </section>
    );
  }

  if (result) return null;
  // The end is told to who saw the round run in this page; the personal gain is told to whoever has one, also when he came after the end (SPEC-065 CA-09).
  if (noticeClosed || resultClosed || (!saw && !mine)) return null;
  return (
    <div className={styles.toast}>
      <div role="status">
        {saw && m.ended}
        {mine && <span className={styles.mine}>{saw ? m.passed(mine.points, mmss(mine.elapsedSeconds)) : m.gain(mine.points, mmss(mine.elapsedSeconds))}</span>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setNoticeClosed(true)}>
        {m.close}
      </Button>
    </div>
  );
}

interface WorkspaceProps extends Pick<ExerciseAreaProps, "classId" | "exercise" | "watched" | "onTakeoverKey" | "onProgress" | "onScreen"> {
  takenOver: boolean;
  notice: LiveChatMessage | null;
  setup: ExerciseSetup;
  /** What the student made of the round, when he concluded. */
  mine: ExerciseMyResult | null;
  /** The server passed the machine of the student. */
  onPassed(result: ExerciseMyResult): void;
}

type Phase = "idle" | "checking" | "rejected" | "failed";

function Workspace({ classId, exercise, setup, mine, watched, takenOver, onTakeoverKey, notice, onPassed, onProgress, onScreen }: WorkspaceProps) {
  const { runId } = exercise;
  const running = exercise.status === "RUNNING";
  // The teacher gave the control back: told until something else happens.
  const [released, setReleased] = useState(false);
  const [wasTaken, setWasTaken] = useState(takenOver);
  if (wasTaken !== takenOver) {
    setWasTaken(takenOver);
    setReleased(!takenOver);
  }
  // The private message over the terminal, until the student closes it; only while the round runs or is paused (SPEC-071 RN-13).
  const [closedNotice, setClosedNotice] = useState<string | null>(null);
  const showNotice = notice !== null && notice.id !== closedNotice && exercise.status !== "ENDED";
  const { item, layers, scenario } = setup;
  const total = item.conditions.length;
  // The machine the terminal starts on: the one kept in the browser when the page was reloaded, else the scenario of the module, which is then prepared.
  const [start] = useState(() => {
    const kept = loadExercise(runId);
    return kept === null ? { state: scenario, prepare: true } : { state: kept, prepare: false };
  });
  const [met, setMet] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");

  // What the callbacks of the terminal and of the timers read is the latest render's, and what must not wait for a render.
  const latest = useRef({ onProgress, onScreen, conditions: item.conditions, done: mine !== null, running });
  useEffect(() => {
    latest.current = { onProgress, onScreen, conditions: item.conditions, done: latest.current.done || mine !== null, running };
  });
  const machine = useRef<unknown>(null);
  const checking = useRef({ busy: false, sent: "" });
  const alive = useRef(true);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(retry.current);
    };
  }, []);

  // Where the student is now, which the beat tells again.
  const now = useRef({ met: 0, last: "", commands: 0 });
  const pace = useRef<{ progress: Paced<{ met: number; last: string; commands: number; beat?: boolean }>; screen: Paced<ScreenElement>; save: Paced<unknown> } | null>(null);
  useEffect(() => {
    // The room already knows what it was told last: the same progress is not told again. Nothing is told while the round is paused or over.
    let told = "";
    const made = {
      progress: createPaced<{ met: number; last: string; commands: number; beat?: boolean }>(({ met: count, last, commands, beat }) => {
        if (!latest.current.running) return true;
        const key = `${count}|${last}|${commands}`;
        if (!beat && key === told) return true;
        const went = latest.current.onProgress({ runId, met: count, total, last, commands });
        if (went) told = key;
        return went;
      }, PROGRESS_MS),
      screen: createPaced<ScreenElement>((tree) => void latest.current.onScreen(runId, tree), SCREEN_MS),
      save: createPaced<unknown>((snapshot) => saveExercise(runId, snapshot), SAVE_MS, { leading: false }),
    };
    pace.current = made;
    // The beat goes through the same pace as the changes, so two seconds still stand between any two sends.
    const beating = setInterval(() => made.progress.push({ ...now.current, beat: true }), BEAT_MS);
    // What waits to be kept is kept when the page is hidden or the student leaves: a reload loses nothing.
    const keep = () => made.save.flush();
    window.addEventListener("pagehide", keep);
    return () => {
      clearInterval(beating);
      window.removeEventListener("pagehide", keep);
      keep();
      made.progress.cancel();
      made.screen.cancel();
      pace.current = null;
    };
  }, [runId, total]);

  // The picture of the terminal goes to the teacher while he watches, the last one at once when he starts.
  const lastScreen = useRef<ScreenElement | null>(null);
  const watching = useRef(watched);
  useEffect(() => {
    watching.current = watched;
    if (watched && lastScreen.current) pace.current?.screen.push(lastScreen.current);
  }, [watched]);
  const handleScreen = (tree: ScreenElement) => {
    lastScreen.current = tree;
    if (watching.current) pace.current?.screen.push(tree);
  };

  /** Sends the machine to the server, which is the one that says if the exercise is done (SPEC-065 CA-04): one at a time, and not the same state twice. */
  const submit = async (snapshot: unknown): Promise<void> => {
    const body = JSON.stringify(snapshot);
    const turn = checking.current;
    if (turn.busy || turn.sent === body || latest.current.done || !latest.current.running) return;
    turn.busy = true;
    turn.sent = body;
    setPhase("checking");
    let verdict: ExerciseVerdict | null = null;
    for (let tries = 0; tries <= RETRIES && !verdict; tries += 1) {
      if (tries > 0) {
        await new Promise<void>((resolve) => {
          retry.current = setTimeout(resolve, RETRY_MS);
        });
      }
      if (!alive.current) return;
      verdict = await classroomService.submitExercise(classId, runId, snapshot).catch(() => null);
    }
    turn.busy = false;
    // A pass is told even when the area is gone: the server takes a check on its way for two seconds after the end of the round (SPEC-065 section 6).
    if (verdict?.passed) {
      latest.current.done = true;
      onPassed({ completedAt: verdict.completedAt ?? new Date().toISOString(), elapsedSeconds: verdict.elapsedSeconds ?? 0, points: verdict.points ?? 0 });
    }
    if (!alive.current) return;
    if (!verdict) {
      // Nothing was checked: the next command, whatever the machine, sends it again.
      turn.sent = "";
      setPhase("failed");
    } else if (verdict.passed) {
      setPhase("idle");
    } else {
      setPhase("rejected");
      // The student went on while the server was checking: look at where he is now.
      const newest = machine.current;
      if (newest !== snapshot && checkConditions(latest.current.conditions, newest).done) void submit(newest);
    }
  };

  const handleChange = (snapshot: unknown, last: string, commands: number) => {
    machine.current = snapshot;
    const { done, missing } = checkConditions(item.conditions, snapshot);
    const count = total - missing.length;
    now.current = { met: count, last, commands };
    setMet(count);
    pace.current?.progress.push({ met: count, last, commands });
    pace.current?.save.push(snapshot);
    if (done) void submit(snapshot);
  };

  return (
    <>
      <header className={styles.head}>
        <h2 className={styles.title}>{exercise.title}</h2>
        <span className={styles.level} data-difficulty={exercise.difficulty}>
          {m.difficulty[exercise.difficulty]}
        </span>
        <ExerciseClock exercise={exercise} label={m.timer} className={styles.clock} />
        <span className={styles.progress}>{m.progress(met, total)}</span>
      </header>
      <div className={styles.body}>
        <article className={styles.statement} aria-label={m.statement} tabIndex={0}>
          <Html html={item.description} />
        </article>
        <div className={styles.terminalBox}>
          <ExerciseTerminal
            initialState={start.state}
            layers={layers}
            prepare={start.prepare}
            readOnly={mine !== null || !running}
            takenOver={takenOver}
            onTakeoverKey={onTakeoverKey}
            onChange={handleChange}
            onScreen={handleScreen}
          />
          {showNotice && (
            <aside className={styles.notice} role="note" aria-label={m.noticeTitle}>
              <strong>{m.noticeTitle}</strong>
              <p className={styles.noticeText}>{notice.text}</p>
              <Button variant="ghost" size="sm" onClick={() => setClosedNotice(notice.id)}>
                {m.noticeClose}
              </Button>
            </aside>
          )}
        </div>
      </div>
      {exercise.status === "PAUSED" ? (
        <p className={styles.lock} role="status">
          {m.pausedNotice}
        </p>
      ) : exercise.status === "ENDED" ? (
        <p className={styles.lock} role="status">
          {exercise.endedBy === "TEACHER" ? m.endedByTeacher : exercise.endedBy === "SESSION" ? m.ended : m.timeUp}
        </p>
      ) : takenOver ? (
        <p className={styles.lock} role="status">
          {m.takenOver}
        </p>
      ) : (
        released && (
          <p className={styles.feedback} role="status">
            {m.released}
          </p>
        )
      )}
      {mine ? (
        <p className={styles.feedback} role="status">
          <strong>{mine.points === 0 ? m.passedHelped : m.passed(mine.points, mmss(mine.elapsedSeconds))}</strong> <span>{m.readOnly}</span>
        </p>
      ) : phase === "checking" ? (
        <p className={styles.feedback} role="status">
          {m.checking}
        </p>
      ) : phase === "rejected" ? (
        <p className={styles.feedback} role="status">
          {m.rejected}
        </p>
      ) : phase === "failed" ? (
        <p className={styles.feedback} role="alert">
          {m.sendFailed}
        </p>
      ) : null}
    </>
  );
}

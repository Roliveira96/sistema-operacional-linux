"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import styles from "@/components/AssessmentSimulator/AssessmentSimulator.module.scss";
import { ExamTerminal } from "@/components/AssessmentSimulator/ExamTerminal";
import { SolvedCelebration } from "@/components/AssessmentSimulator/SolvedCelebration";
import { Button } from "@/components/Button/Button";
import { Html } from "@/components/ContentRenderer/blocks";
import { MatchingAnswer } from "@/components/MatchingAnswer/MatchingAnswer";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { SingleChoiceAnswer } from "@/components/SingleChoiceAnswer/SingleChoiceAnswer";
import { TrueFalseAnswer } from "@/components/TrueFalseAnswer/TrueFalseAnswer";
import { countdown, formatScore } from "@/lib/assessment";
import { isAnswered, type SimulatedResponse } from "@/lib/assessmentSimulation";
import { fromApiAnswer, stableOrder, toApiAnswer } from "@/lib/attemptAnswers";
import { answerText, isDiscursive, isMatching, isSingleChoice, isTrueFalse } from "@/lib/questionKinds";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import type { CommandRun } from "@/engine/terminalWindow";
import type { ScreenElement } from "@/engine/terminalScreen";
import type { AttemptItem, StudentAttempt } from "@/services/assessmentService";

const m = messages.assessments;
const s = m.simulator;
const t = m.take;

/** The machine of a practical question is saved at most once in this interval (SPEC-090 section 3.1). */
const MACHINE_EVERY_MS = 2000;
/** How long after the last command the practical question checks itself (SPEC-090 revision 3, as the simulator of SPEC-085). */
const CHECK_AFTER_MS = 1000;
/** A written answer is saved this long after the student stops typing. */
const WRITTEN_AFTER_MS = 1000;
/** An answer that could not be saved is tried again after this long. */
const RETRY_MS = 3000;

type Phase = "answering" | "delivered" | "timeUp";
type SaveState = "idle" | "saving" | "saved" | "offline";

const isPractical = (item: AttemptItem) => item.kind === "PRACTICAL";

/** What the window keeps in the browser of an attempt: the answers the server did not confirm and the lines typed without Enter (SPEC-090 revision 2). */
interface LocalCopy {
  pending?: Record<string, unknown>;
  typed?: Record<string, string>;
}
const localKey = (attemptId: string) => `exam-attempt:${attemptId}`;
function readLocal(attemptId: string): LocalCopy {
  try {
    return (JSON.parse(localStorage.getItem(localKey(attemptId)) ?? "{}") as LocalCopy | null) ?? {};
  } catch {
    return {};
  }
}

export interface ExamRunnerProps {
  attempt: StudentAttempt;
  title: string;
  /** Saves the answer of a question in the form of the server (SPEC-090 RN-04). */
  save: (position: number, answer: unknown) => Promise<void>;
  /** Checks the machine of a practical question and says whether it is solved (RN-05). */
  check: (position: number, snapshot: unknown) => Promise<boolean>;
  /** Delivers the attempt (RN-06). */
  submit: () => Promise<StudentAttempt>;
  /** The room of the exam, when there is one (SPEC-091). */
  room?: ExamRunnerRoom;
}

/** What the window of the exam tells the room, and what it shows of it (SPEC-091 RN-05 to RN-07). */
export interface ExamRunnerRoom {
  /** Whether the teacher watches this student: only then the screen goes. */
  watched: boolean;
  onCommand(position: number, command: string, output: string): void;
  /** The question the student is in and the picture of the terminal, or null in a question without it. */
  onScreen(position: number, title: string, screen: ScreenElement | null): void;
  /** The question the student opened, at once and on each change, watched or not (SPEC-092 revision 2). */
  onQuestion?(position: number, title: string): void;
  /** What goes in the header, by the question that is open: the request for help. */
  header?(position: number): ReactNode;
}

/**
 * The window of the exam of the student (SPEC-090): the questions beside the terminal, as in the simulator, with each answer saved on the server while
 * the student works, the time by the clock of the server, the check of the practical questions and the delivery, by the student or by the time.
 */
export function ExamRunner({ attempt, title, save, check, submit, room }: ExamRunnerProps) {
  const items = attempt.items;
  /** The copy in the browser, read once: what it has goes over what came from the server. */
  const [local] = useState(() => readLocal(attempt.id));
  const savedOf = (it: AttemptItem) => local.pending?.[it.position] ?? it.answer;
  const [current, setCurrent] = useState(0);
  const [responses, setResponses] = useState<Record<number, SimulatedResponse>>(() => {
    const out: Record<number, SimulatedResponse> = {};
    for (const it of items) {
      const value = fromApiAnswer(it.kind, savedOf(it));
      if (value !== undefined) out[it.position] = value;
    }
    return out;
  });
  const [solved, setSolved] = useState<Record<number, boolean>>(() => Object.fromEntries(items.map((it) => [it.position, !!it.checkedSolved])));
  const [phase, setPhase] = useState<Phase>("answering");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [confirming, setConfirming] = useState(false);
  const [celebrating, setCelebrating] = useState<number | null>(null);
  /** The practical questions being checked, and the one a command undid after it was solved (SPEC-090 revision 3, D-06). */
  const [checking, setChecking] = useState<Record<number, boolean>>({});
  const [undone, setUndone] = useState<number | null>(null);
  /** The practical questions in which the student ran a command, which count as answered. */
  const [touched, setTouched] = useState<Record<number, boolean>>({});

  /** The clock of the server, as an offset from the one of this computer (SPEC-090 RN-03). */
  const [offset] = useState(() => Date.parse(attempt.serverNow) - Date.now());
  const deadline = useMemo(() => Date.parse(attempt.deadlineAt), [attempt.deadlineAt]);
  const left = useCallback(() => Math.max(deadline - (Date.now() + offset), 0), [deadline, offset]);
  const [remaining, setRemaining] = useState(left);

  // ---- saving: one queue of the answers not sent yet, by question ----
  const pending = useRef(new Map<number, unknown>(Object.entries(local.pending ?? {}).map(([position, value]) => [Number(position), value])));
  const typed = useRef<Record<string, string>>({ ...local.typed });
  /** Writes the copy in the browser; a browser that does not let it goes on with the server alone. */
  const keep = useCallback(() => {
    try {
      localStorage.setItem(localKey(attempt.id), JSON.stringify({ pending: Object.fromEntries(pending.current), typed: typed.current }));
    } catch {
      // nothing kept: the server has what it confirmed
    }
  }, [attempt.id]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMachine = useRef(new Map<number, number>());
  const flushing = useRef<Promise<void> | null>(null);
  const saveRef = useRef(save);
  /** The flush itself, for the retry that it schedules. */
  const retry = useRef<() => void>(() => {});
  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback((): Promise<void> => {
    if (flushing.current) return flushing.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current.size === 0) return Promise.resolve();
    const run = (async () => {
      setSaveState("saving");
      try {
        while (pending.current.size > 0) {
          const [position, answer] = pending.current.entries().next().value as [number, unknown];
          await saveRef.current(position, answer);
          // a newer answer of the same question that came meanwhile stays to be sent
          if (pending.current.get(position) === answer) pending.current.delete(position);
          keep();
        }
        setSaveState("saved");
      } catch {
        setSaveState("offline");
        timer.current = setTimeout(() => retry.current(), RETRY_MS);
      } finally {
        flushing.current = null;
      }
    })();
    flushing.current = run;
    return run;
  }, [keep]);

  useEffect(() => {
    retry.current = () => void flush();
  }, [flush]);
  // what the browser had and the server did not confirm goes at once
  useEffect(() => {
    void flush();
  }, [flush]);

  const queue = useCallback(
    (position: number, answer: unknown, delay: number) => {
      pending.current.set(position, answer);
      keep();
      if (timer.current) clearTimeout(timer.current);
      if (delay <= 0) void flush();
      else timer.current = setTimeout(() => void flush(), delay);
    },
    [flush, keep],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // ---- delivering ----
  const delivering = useRef(false);
  const deliver = useCallback(
    async (byTime: boolean) => {
      if (delivering.current) return;
      delivering.current = true;
      setConfirming(false);
      setCelebrating(null);
      await flush().catch(() => {});
      try {
        await submit();
      } catch {
        // past the tolerance the server delivered it already (RN-07): the student reads the same
      }
      try {
        localStorage.removeItem(localKey(attempt.id));
      } catch {
        // nothing was kept
      }
      setPhase(byTime ? "timeUp" : "delivered");
    },
    [flush, submit, attempt.id],
  );

  useEffect(() => {
    if (phase !== "answering") return;
    const tick = () => {
      const now = left();
      setRemaining(now);
      if (now <= 0) void deliver(true);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [phase, left, deliver]);

  // ---- the questions ----
  const answer = (item: AttemptItem, value: SimulatedResponse) => {
    setResponses((all) => ({ ...all, [item.position]: value }));
    queue(item.position, toApiAnswer(item.kind, value), isDiscursive(item.kind) ? WRITTEN_AFTER_MS : 0);
  };

  /** The machine of each practical question, as the terminal last had it. */
  const machines = useRef(new Map<number, unknown>());

  // ---- the check by itself (SPEC-090 revision 3) ----
  const checkRef = useRef(check);
  const openPosition = useRef<number | null>(null);
  useEffect(() => {
    checkRef.current = check;
    openPosition.current = items[current]?.position ?? null;
  });
  /** The waits after a command, the checks running and the ones asked meanwhile, the solved questions and the ones already celebrated. */
  const checks = useRef({
    timers: new Map<number, ReturnType<typeof setTimeout>>(),
    running: new Set<number>(),
    again: new Set<number>(),
    solved: new Set(items.filter((it) => it.checkedSolved).map((it) => it.position)),
    celebrated: new Set(items.filter((it) => it.checkedSolved).map((it) => it.position)),
  });
  useEffect(() => {
    const timers = checks.current.timers;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);
  /** Checks the last machine of a question, one check at a time; a machine that came meanwhile goes after, only the last one (CA-19, CA-20). */
  const runCheck = useCallback(async (position: number) => {
    const c = checks.current;
    if (c.running.has(position)) {
      c.again.add(position);
      return;
    }
    c.running.add(position);
    setChecking((all) => ({ ...all, [position]: true }));
    try {
      do {
        c.again.delete(position);
        const machine = machines.current.get(position) ?? null;
        try {
          const ok = await checkRef.current(position, machine);
          if (pending.current.get(position) === machine) pending.current.delete(position);
          const was = c.solved.has(position);
          if (ok) {
            c.solved.add(position);
            setUndone((u) => (u === position ? null : u));
            if (!c.celebrated.has(position)) {
              c.celebrated.add(position);
              // the celebration is only for the question that is open; solved while away, it only gets the mark (SPEC-087 CA-09)
              if (openPosition.current === position) setCelebrating(position);
            }
          } else {
            c.solved.delete(position);
            if (was) setUndone(position);
          }
          setSolved((all) => ({ ...all, [position]: ok }));
        } catch {
          // a check that fails on the network is not an error: the next command tries again
        }
      } while (c.again.has(position));
    } finally {
      c.running.delete(position);
      setChecking((all) => ({ ...all, [position]: false }));
    }
  }, []);

  const machineChanged = useCallback(
    (id: string, snapshot: unknown) => {
      const position = Number(id);
      machines.current.set(position, snapshot);
      const timers = checks.current.timers;
      clearTimeout(timers.get(position));
      timers.set(position, setTimeout(() => void runCheck(position), CHECK_AFTER_MS));
      setTouched((all) => (all[position] ? all : { ...all, [position]: true }));
      const since = Date.now() - (lastMachine.current.get(position) ?? 0);
      const wait = since >= MACHINE_EVERY_MS ? 0 : MACHINE_EVERY_MS - since;
      lastMachine.current.set(position, Date.now() + wait);
      queue(position, snapshot, wait);
    },
    [queue, runCheck],
  );
  const machineFormatted = useCallback(
    (id: string) => {
      const position = Number(id);
      const item = items.find((it) => it.position === position);
      setSolved((all) => ({ ...all, [position]: false }));
      checks.current.solved.delete(position);
      const start = item?.studentView.scenario ?? null;
      machines.current.set(position, start);
      if (start !== null) queue(position, start, 0);
    },
    [items, queue],
  );
  const loadScenario = useCallback(async (id: string) => items.find((it) => String(it.position) === id)?.studentView.scenario ?? null, [items]);
  const resume = useMemo(() => {
    const out: Record<string, unknown> = {};
    for (const it of items.filter(isPractical)) {
      const saved = savedOf(it);
      const line = local.typed?.[it.position];
      const base = saved ?? (line ? it.studentView.scenario : undefined);
      if (base === undefined || base === null) continue;
      const terminal = (base as { terminal?: object }).terminal;
      out[String(it.position)] = line ? { ...(base as object), terminal: { ...terminal, linha: line } } : base;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the copy in the browser is read once, as the attempt
  }, [items]);
  const typedChanged = useCallback(
    (id: string, line: string) => {
      if (line) typed.current[id] = line;
      else delete typed.current[id];
      keep();
    },
    [keep],
  );

  // ---- the room: the commands as they run, the screen while the teacher watches (SPEC-091) ----
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });
  const screens = useRef(new Map<number, ScreenElement>());
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);
  const commandRun = useCallback((id: string, run: CommandRun) => roomRef.current?.onCommand(Number(id), run.command, run.output), []);
  const screenChanged = useCallback(
    (id: string, tree: ScreenElement) => {
      const position = Number(id);
      screens.current.set(position, tree);
      if (roomRef.current?.watched && items[currentRef.current]?.position === position) {
        roomRef.current.onScreen(position, items.find((it) => it.position === position)?.studentView.title ?? "", tree);
      }
    },
    [items],
  );
  useEffect(() => {
    const item = items[current];
    if (item) roomRef.current?.onQuestion?.(item.position, item.studentView.title);
  }, [current, items]);
  const watched = !!room?.watched;
  useEffect(() => {
    const item = items[current];
    if (!watched || !item) return;
    roomRef.current?.onScreen(item.position, item.studentView.title, isPractical(item) ? (screens.current.get(item.position) ?? null) : null);
  }, [watched, current, items]);

  const isDone = (it: AttemptItem) => (isPractical(it) ? !!solved[it.position] || savedOf(it) !== undefined || !!touched[it.position] : isAnswered(responses[it.position]));
  const blank = items.filter((it) => !isDone(it)).length;
  const open = items[current];
  const hasTerminal = items.some(isPractical);

  const goTo = (i: number) => {
    setCelebrating(null);
    setUndone(null);
    if (timer.current) void flush();
    setCurrent(i);
  };

  if (phase !== "answering") {
    return (
      <div className={styles.cover}>
        <div className={styles.coverCard}>
          <h2 className={styles.coverTitle} role="status">
            {phase === "timeUp" ? t.timeUp : t.delivered}
          </h2>
        </div>
      </div>
    );
  }
  if (!open) return null;

  return (
    <div className={styles.exam}>
      <div className={styles.examHead}>
        <p className={styles.examName}>{title}</p>
        <span role="timer" aria-label={s.answering.timeLeft} className={styles.timer}>
          {countdown(Math.ceil(remaining / 1000) * 1000)}
        </span>
        <span role="status" className={styles.situation}>
          {saveState === "saving" ? t.saving : saveState === "saved" ? t.saved : saveState === "offline" ? t.offline : ""}
        </span>
        {room?.header?.(open.position)}
        <Button onClick={() => setConfirming(true)}>{t.deliver}</Button>
      </div>
      <div className={`${styles.examBody} ${hasTerminal ? styles.withTerminal : ""}`}>
        <div className={styles.questionCol}>
          <div className={styles.questionScroll}>
            <ol aria-label={s.answering.navigator} className={styles.navigator}>
              {items.map((it, i) => (
                <li key={it.position}>
                  <button
                    type="button"
                    className={`${styles.step} ${isDone(it) ? styles.stepDone : ""}`}
                    aria-label={s.answering.navItem(i + 1, solved[it.position] ? "solved" : isDone(it) ? "answered" : "blank")}
                    aria-current={i === current ? "step" : undefined}
                    onClick={() => goTo(i)}
                  >
                    {i + 1}
                  </button>
                </li>
              ))}
            </ol>
            <div className={styles.questionHead}>
              <h3 className={styles.examTitle}>{s.answering.position(current + 1, items.length)}</h3>
              <p className={styles.worth}>{m.points(formatScore(open.weight))}</p>
            </div>
            <Html html={open.studentView.statement} />
            <Answer key={open.position} item={open} seed={`${attempt.id}:${open.position}`} response={responses[open.position]} onChange={(v) => answer(open, v)} />
            {isPractical(open) && checking[open.position] && (
              <p role="status" className={styles.note}>
                {t.checking}
              </p>
            )}
            {solved[open.position] && (
              <p role="status" className={styles.solvedNote}>
                {s.answering.solved}
              </p>
            )}
            {undone === open.position && (
              <p role="status" className={styles.notice}>
                {t.undone}
              </p>
            )}
            <div className={styles.footer}>
              <Button variant="secondary" disabled={current === 0} onClick={() => goTo(current - 1)}>
                {s.answering.previous}
              </Button>
              <Button variant="secondary" disabled={current === items.length - 1} onClick={() => goTo(current + 1)}>
                {s.answering.next}
              </Button>
            </div>
          </div>
          {celebrating === open.position && (
            <SolvedCelebration
              last={current === items.length - 1}
              onNext={() => goTo(current + 1)}
              onDeliver={() => {
                setCelebrating(null);
                setConfirming(true);
              }}
              onClose={() => setCelebrating(null)}
            />
          )}
        </div>
        {hasTerminal && (
          <ExamTerminal
            questionId={isPractical(open) ? String(open.position) : null}
            loadScenario={loadScenario}
            onCommand={machineChanged}
            onFormat={machineFormatted}
            resume={resume}
            onCommandRun={commandRun}
            onScreen={screenChanged}
            onTyped={typedChanged}
          />
        )}
      </div>

      {confirming && (
        <AssessmentDialog title={t.confirm.title} onClose={() => setConfirming(false)}>
          <p>{t.confirm.blank(blank)}</p>
          <div className={dialog.actions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t.confirm.keep}
            </Button>
            <Button onClick={() => void deliver(false)}>{t.confirm.deliver}</Button>
          </div>
        </AssessmentDialog>
      )}
    </div>
  );
}

/** The answer of the kind of the question, in the mode of an assessment: it never says whether the answer is right (SPEC-090 CA-12). */
function Answer({ item, seed, response, onChange }: { item: AttemptItem; seed: string; response: SimulatedResponse | undefined; onChange: (value: SimulatedResponse) => void }) {
  const view = item.studentView;
  const mix = <T extends { id: string }>(list: T[], side: string) => (view.shuffle === false ? list : stableOrder(list, `${seed}:${side}`));
  if (isTrueFalse(item.kind)) {
    return <TrueFalseAnswer mode="assessment" value={typeof response === "boolean" ? response : null} onChange={onChange} />;
  }
  if (isSingleChoice(item.kind)) {
    return <SingleChoiceAnswer mode="assessment" choices={mix(view.choices ?? [], "choices")} value={typeof response === "string" ? response : null} onChange={onChange} />;
  }
  if (isMatching(item.kind)) {
    return (
      <MatchingAnswer
        mode="assessment"
        left={mix(view.columns?.left ?? [], "left")}
        right={mix(view.columns?.right ?? [], "right")}
        value={Array.isArray(response) ? response : []}
        onChange={onChange}
      />
    );
  }
  if (isDiscursive(item.kind)) {
    const html = typeof response === "string" ? response : "";
    const max = view.maxLength ?? 2000;
    const length = answerText(html).length;
    return (
      <div className={styles.stack}>
        <p className={styles.note}>{s.answering.descriptive}</p>
        <RichTextEditor label={contentMessages.descriptive.group} variant="answer" value={html} onChange={onChange} invalid={length > max} />
        <p className={`${styles.count} ${length > max ? styles.over : ""}`} aria-live="polite">
          {contentMessages.descriptive.count(length, max)}
        </p>
      </div>
    );
  }
  return <p className={styles.notice}>{s.answering.practical}</p>;
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AssessmentDialog } from "@/components/AssessmentDialog/AssessmentDialog";
import dialog from "@/components/AssessmentDialog/AssessmentDialog.module.scss";
import { DrawRulesTable, QuestionBlock } from "@/components/AssessmentPreview/AssessmentPreview";
import { Button } from "@/components/Button/Button";
import { Html } from "@/components/ContentRenderer/blocks";
import { MatchingAnswer, type MatchingItem } from "@/components/MatchingAnswer/MatchingAnswer";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import { SingleChoiceAnswer, type ChoiceOption } from "@/components/SingleChoiceAnswer/SingleChoiceAnswer";
import { TrueFalseAnswer } from "@/components/TrueFalseAnswer/TrueFalseAnswer";
import { countdown, formatPeriod, formatScore, situationOf } from "@/lib/assessment";
import { isAnswered, shuffled, simulatedQuestions, type SimulatedQuestion, type SimulatedResponse } from "@/lib/assessmentSimulation";
import { answerText, isDiscursive, isMatching, isSingleChoice, isTrueFalse, parseKind, usesTerminal } from "@/lib/questionKinds";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import type { AssessmentDetail, PreviewData } from "@/services/assessmentService";
import { ExamTerminal } from "./ExamTerminal";
import styles from "./AssessmentSimulator.module.scss";

const m = messages.assessments;
const s = m.simulator;
const content = contentMessages;

/** The width from which the exam, and so the simulator, fits (SPEC-081 D-02): the same one where the list of assessments becomes cards. */
const WIDE = "(min-width: 48rem)";

function useWideWindow(): boolean {
  const [wide, setWide] = useState(() => typeof window === "undefined" || typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return wide;
}

/** What the student sees in order for a question, drawn when the simulation starts: the alternatives and the columns shuffled unless the teacher keeps hers. */
interface Order {
  choices?: ChoiceOption[];
  left?: MatchingItem[];
  right?: MatchingItem[];
}

function orderOf(question: SimulatedQuestion): Order {
  const view = question.studentView;
  const mix = <T,>(items: T[]) => (view.shuffle === false ? items : shuffled(items));
  return {
    choices: view.choices && mix(view.choices),
    left: view.columns && mix(view.columns.left),
    right: view.columns && mix(view.columns.right),
  };
}

type Phase = "intro" | "answering" | "done";

/** What the simulator keeps of the checks of the practical questions: the waits that run, the last state of each machine, the ones being checked and the solved ones. */
const newChecks = () => ({
  timers: new Map<string, ReturnType<typeof setTimeout>>(),
  latest: new Map<string, unknown>(),
  running: new Set<string>(),
  again: new Set<string>(),
  solved: new Set<string>(),
  /** Grows each time the machine of a question is formatted, so an answer that was on its way is known to be of the old machine. */
  generation: new Map<string, number>(),
});
type Tab = "student" | "teacher";

/** Whether the question is answered in the terminal: a question of command Linux (SPEC-084). */
const isPractical = (question: SimulatedQuestion): boolean => usesTerminal(parseKind(question.kind));

export interface AssessmentSimulatorProps {
  detail: AssessmentDetail;
  /** Reads the preview of the assessment; the simulator only reads (SPEC-081 RN-04). */
  load: () => Promise<PreviewData>;
  /** Reads the machine a question of command Linux starts from; null is the default machine (SPEC-084). */
  loadScenario: (questionId: string) => Promise<unknown>;
  /** Asks the server whether the machine meets the conditions of a question of command Linux; it only says yes or no and stores nothing (SPEC-085). */
  checkQuestion: (questionId: string, snapshot: unknown) => Promise<boolean>;
  /** Where "back to the assessment" goes. */
  backHref: string;
}

/**
 * The simulator of the exam (SPEC-081, SPEC-084): the view of the student, which is the screen of the exam with the question beside the terminal, and
 * the view of the teacher, in two tabs. The teacher goes through the exam as a student; the answers and the machines live only in this page, and
 * nothing is sent or stored.
 */
export function AssessmentSimulator(props: AssessmentSimulatorProps) {
  const wide = useWideWindow();
  if (!wide) {
    return (
      <div className={styles.narrow}>
        <p role="status">{s.narrow}</p>
        <Link href={props.backHref} className={styles.back}>
          {s.back}
        </Link>
      </div>
    );
  }
  return <Simulator {...props} />;
}

/** How long the terminal has to be without a command before the machine of the question is sent to be checked (SPEC-085 D-01). */
const CHECK_WAIT_MS = 1000;

function Simulator({ detail, load, loadScenario, checkQuestion, backHref }: AssessmentSimulatorProps) {
  const baseId = useId();
  const [tab, setTab] = useState<Tab>("student");
  const [data, setData] = useState<PreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const [phase, setPhase] = useState<Phase>("intro");
  const [current, setCurrent] = useState(0);
  const [responses, setResponses] = useState<Record<string, SimulatedResponse>>({});
  const [orders, setOrders] = useState<Record<string, Order>>({});
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [timeUp, setTimeUp] = useState(false);
  const [confirming, setConfirming] = useState(false);
  /** The practical questions the server gave as solved, and the one whose check failed last (SPEC-085). */
  const [solved, setSolved] = useState<Record<string, boolean>>({});
  const [checkFailed, setCheckFailed] = useState<string | null>(null);
  const checks = useRef(newChecks());
  const check = useRef(checkQuestion);
  useEffect(() => {
    check.current = checkQuestion;
  });

  const questions = useMemo(() => (data ? simulatedQuestions(data) : []), [data]);
  const isDraw = detail.composition === "DRAW";

  /** Forgets what was checked: the waits that run, the machines that were sent and the marks of solved. */
  const forgetChecks = useCallback(() => {
    for (const timer of checks.current.timers.values()) clearTimeout(timer);
    checks.current = newChecks();
    setSolved({});
    setCheckFailed(null);
  }, []);

  const restart = useCallback(() => {
    forgetChecks();
    setPhase("intro");
    setCurrent(0);
    setResponses({});
    setOrders({});
    setDeadline(null);
    setRemaining(null);
    setTimeUp(false);
    setConfirming(false);
  }, [forgetChecks]);

  /** Sends the last state of the machine of a question to be checked, one check at a time for the question; a state that came meanwhile goes after (CA-05). */
  const runCheck = useCallback(async (id: string) => {
    const c = checks.current;
    if (c.solved.has(id)) return;
    if (c.running.has(id)) {
      c.again.add(id);
      return;
    }
    c.running.add(id);
    try {
      do {
        c.again.delete(id);
        const generation = c.generation.get(id) ?? 0;
        try {
          const passed = await check.current(id, c.latest.get(id));
          // the machine was formatted or the exam was done again while the server answered: the answer is of a machine that is gone
          if (checks.current !== c || (c.generation.get(id) ?? 0) !== generation) continue;
          setCheckFailed((failed) => (failed === id ? null : failed));
          if (passed) {
            c.solved.add(id);
            setSolved((all) => ({ ...all, [id]: true }));
          }
        } catch {
          if (checks.current === c) setCheckFailed(id);
        }
      } while (checks.current === c && c.again.has(id) && !c.solved.has(id));
    } finally {
      c.running.delete(id);
    }
  }, []);

  /** A command ran in the terminal: after a second without another one, the last machine goes to be checked. */
  const machineChanged = useCallback(
    (id: string, snapshot: unknown) => {
      const c = checks.current;
      if (c.solved.has(id)) return;
      c.latest.set(id, snapshot);
      clearTimeout(c.timers.get(id));
      c.timers.set(
        id,
        setTimeout(() => {
          c.timers.delete(id);
          void runCheck(id);
        }, CHECK_WAIT_MS),
      );
    },
    [runCheck],
  );

  /** The machine of a question was formatted: it is back at the start, so it is not solved and what was waiting to be checked is of the old one. */
  const machineFormatted = useCallback((id: string) => {
    const c = checks.current;
    clearTimeout(c.timers.get(id));
    c.timers.delete(id);
    c.latest.delete(id);
    c.again.delete(id);
    c.solved.delete(id);
    c.generation.set(id, (c.generation.get(id) ?? 0) + 1);
    setSolved((all) => ({ ...all, [id]: false }));
    setCheckFailed((failed) => (failed === id ? null : failed));
  }, []);

  // nothing waits to be checked once the exam leaves the screen of the questions, or when the simulator goes away
  useEffect(() => {
    if (phase === "answering") return;
    for (const timer of checks.current.timers.values()) clearTimeout(timer);
    checks.current.timers.clear();
  }, [phase]);
  useEffect(() => {
    const pending = checks;
    return () => {
      for (const timer of pending.current.timers.values()) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    load().then(
      (loaded) => {
        if (!alive) return;
        setData(loaded);
        setFailed(false);
        restart();
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [load, attempt, restart]);

  const finish = useCallback((byTime: boolean) => {
    setTimeUp(byTime);
    setConfirming(false);
    setPhase("done");
  }, []);

  useEffect(() => {
    if (phase !== "answering" || deadline === null) return;
    const timer = setInterval(() => {
      const left = deadline - Date.now();
      setRemaining(Math.max(left, 0));
      if (left <= 0) finish(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase, deadline, finish]);

  const begin = () => {
    setOrders(Object.fromEntries(questions.map((q) => [q.questionId, orderOf(q)])));
    setResponses({});
    setCurrent(0);
    setTimeUp(false);
    if (detail.durationMinutes) {
      setDeadline(Date.now() + detail.durationMinutes * 60_000);
      setRemaining(detail.durationMinutes * 60_000);
    } else {
      setDeadline(null);
      setRemaining(null);
    }
    setPhase("answering");
  };

  const answer = (id: string, value: SimulatedResponse) => setResponses((all) => ({ ...all, [id]: value }));
  /** A question is done when it has an answer or, a practical one, when the server gave it as solved. */
  const isDone = (q: SimulatedQuestion) => !!solved[q.questionId] || isAnswered(responses[q.questionId]);
  const answeredCount = questions.filter(isDone).length;
  const open = phase === "answering" ? questions[current] : undefined;
  const hasTerminal = questions.some(isPractical);
  const tabIds = { student: { tab: `${baseId}-tab-student`, panel: `${baseId}-panel-student` }, teacher: { tab: `${baseId}-tab-teacher`, panel: `${baseId}-panel-teacher` } };
  /** The tabs move with the arrows, as the pattern of tabs asks. */
  const moveTab = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = tab === "student" ? "teacher" : "student";
    setTab(next);
    document.getElementById(tabIds[next].tab)?.focus();
  };

  if (failed && !data) {
    return (
      <div role="alert" className={styles.problem}>
        <span>{s.loadError}</span>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {m.retry}
        </Button>
      </div>
    );
  }
  if (!data) return <p role="status">{m.preview.loading}</p>;

  return (
    <div className={styles.simulator}>
      <div className={styles.bar}>
        <p role="note" className={styles.banner}>
          {s.banner}
        </p>
        <span className={styles.situation}>{s.realSituation(situationOf(detail))}</span>
        {isDraw && (
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {s.drawAgain}
          </Button>
        )}
      </div>

      <div role="tablist" aria-label={s.tabsLabel} className={styles.tabs} onKeyDown={moveTab}>
        {(["student", "teacher"] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={tabIds[key].tab}
            aria-selected={tab === key}
            aria-controls={tabIds[key].panel}
            tabIndex={tab === key ? 0 : -1}
            className={`${styles.tab} ${tab === key ? styles.tabActive : ""}`}
            onClick={() => setTab(key)}
          >
            {s.tabs[key]}
          </button>
        ))}
      </div>

        <section role="tabpanel" id={tabIds.student.panel} aria-label={s.studentView} hidden={tab !== "student"} className={styles.pane}>
          <h2 className={styles.paneTitle}>{s.studentView}</h2>
          {phase === "intro" && (
            <div className={styles.stack}>
              <h3 className={styles.examTitle}>{detail.title}</h3>
              {detail.description && <div className={styles.richText} dangerouslySetInnerHTML={{ __html: detail.description }} />}
              <dl className={styles.facts}>
                <div>
                  <dt>{s.intro.duration}</dt>
                  <dd>{detail.durationMinutes ? s.intro.minutes(detail.durationMinutes) : s.intro.wholePeriod}</dd>
                </div>
                <div>
                  <dt>{s.intro.maxScore}</dt>
                  <dd>{formatScore(detail.maxScore)}</dd>
                </div>
                <div>
                  <dt>{s.intro.questions}</dt>
                  <dd>{s.intro.count(questions.length)}</dd>
                </div>
              </dl>
              <div>
                <Button onClick={begin} disabled={questions.length === 0}>
                  {s.intro.begin}
                </Button>
              </div>
            </div>
          )}

          {phase === "answering" && open && (
            <div className={styles.exam}>
              <div className={styles.examHead}>
                <p className={styles.examName}>{detail.title}</p>
                <h3 className={styles.examTitle}>{s.answering.position(current + 1, questions.length)}</h3>
                {remaining !== null && (
                  <span role="timer" aria-label={s.answering.timeLeft} className={styles.timer}>
                    {countdown(remaining)}
                  </span>
                )}
                <Button onClick={() => setConfirming(true)}>{s.answering.deliver}</Button>
              </div>
              <div className={`${styles.examBody} ${hasTerminal ? styles.withTerminal : ""}`}>
                <div className={styles.questionCol}>
                  <ol aria-label={s.answering.navigator} className={styles.navigator}>
                    {questions.map((q, i) => (
                      <li key={q.questionId}>
                        <button
                          type="button"
                          className={`${styles.step} ${isDone(q) ? styles.stepDone : ""}`}
                          aria-label={s.answering.navItem(i + 1, solved[q.questionId] ? "solved" : isDone(q) ? "answered" : "blank")}
                          aria-current={i === current ? "step" : undefined}
                          onClick={() => setCurrent(i)}
                        >
                          {i + 1}
                        </button>
                      </li>
                    ))}
                  </ol>
                  <p className={styles.worth}>{m.points(formatScore(open.weight))}</p>
                  <Html html={open.statement} />
                  <Answer key={open.questionId} question={open} response={responses[open.questionId]} order={orders[open.questionId]} onChange={(value) => answer(open.questionId, value)} />
                  {solved[open.questionId] && (
                    <p role="status" className={styles.solvedNote}>
                      {s.answering.solved}
                    </p>
                  )}
                  {checkFailed === open.questionId && (
                    <p role="status" className={styles.notice}>
                      {s.answering.checkFailed}
                    </p>
                  )}
                  <div className={styles.footer}>
                    <Button variant="secondary" disabled={current === 0} onClick={() => setCurrent((n) => n - 1)}>
                      {s.answering.previous}
                    </Button>
                    <Button variant="secondary" disabled={current === questions.length - 1} onClick={() => setCurrent((n) => n + 1)}>
                      {s.answering.next}
                    </Button>
                  </div>
                </div>
                {hasTerminal && (
                  <ExamTerminal questionId={isPractical(open) ? open.questionId : null} loadScenario={loadScenario} onCommand={machineChanged} onFormat={machineFormatted} />
                )}
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className={styles.stack}>
              <h3 className={styles.examTitle}>{s.done.title}</h3>
              {timeUp && <p>{s.done.timeUp}</p>}
              <p>{s.done.nothingSent}</p>
              <p>{s.done.answered(answeredCount, questions.length)}</p>
              <div className={styles.footer}>
                <Button onClick={restart}>{s.done.redo}</Button>
                <Link href={backHref} className={styles.back}>
                  {s.back}
                </Link>
              </div>
            </div>
          )}
        </section>

        <section role="tabpanel" id={tabIds.teacher.panel} aria-label={s.teacherView} hidden={tab !== "teacher"} className={styles.pane}>
          <h2 className={styles.paneTitle}>{s.teacherView}</h2>
          <dl className={styles.facts}>
            {(
              [
                [m.page.facts.type, m.type[detail.type]],
                [m.page.facts.modality, m.modality[detail.modality]],
                [m.page.facts.period, formatPeriod(detail.startsAt, detail.endsAt)],
                [m.page.facts.maxScore, formatScore(detail.maxScore)],
                [m.page.facts.composition, m.composition[detail.composition]],
              ] as [string, string][]
            ).map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {data.rules && <DrawRulesTable rules={data.rules} stock={data.stock} />}
          <ol className={styles.list}>
            {questions.map((q) => (
              <QuestionBlock key={q.questionId} question={q} position={q.position} weight={q.weight} current={open === q}>
                <p className={styles.label}>{s.teacher.simulated}</p>
                <div data-testid="simulated" className={styles.simulated}>
                  <Simulated question={q} response={responses[q.questionId]} order={orders[q.questionId]} solved={!!solved[q.questionId]} />
                </div>
              </QuestionBlock>
            ))}
          </ol>
        </section>

      {confirming && (
        <AssessmentDialog title={s.confirm.title} onClose={() => setConfirming(false)}>
          <p>{s.confirm.blank(questions.length - answeredCount)}</p>
          <div className={dialog.actions}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {s.confirm.keep}
            </Button>
            <Button onClick={() => finish(false)}>{s.confirm.deliver}</Button>
          </div>
        </AssessmentDialog>
      )}
    </div>
  );
}

/** The component of the answer of the kind of the question, in the mode of an assessment: it never says whether the answer is right. */
function Answer({ question, response, order, onChange }: { question: SimulatedQuestion; response: SimulatedResponse | undefined; order: Order | undefined; onChange: (value: SimulatedResponse) => void }) {
  if (isTrueFalse(question.kind)) {
    return <TrueFalseAnswer mode="assessment" value={typeof response === "boolean" ? response : null} onChange={onChange} />;
  }
  if (isSingleChoice(question.kind)) {
    return <SingleChoiceAnswer mode="assessment" choices={order?.choices ?? []} value={typeof response === "string" ? response : null} onChange={onChange} />;
  }
  if (isMatching(question.kind)) {
    return <MatchingAnswer mode="assessment" left={order?.left ?? []} right={order?.right ?? []} value={Array.isArray(response) ? response : []} onChange={onChange} />;
  }
  if (isDiscursive(question.kind)) {
    return <WrittenAnswer question={question} html={typeof response === "string" ? response : ""} onChange={onChange} />;
  }
  return <p className={styles.notice}>{s.answering.practical}</p>;
}

/** The descriptive answer: the editor of the answer and the count of characters. The component of the exercise sends once, so the simulator has its own area. */
function WrittenAnswer({ question, html, onChange }: { question: SimulatedQuestion; html: string; onChange: (html: string) => void }) {
  const max = question.studentView.maxLength ?? 2000;
  const length = answerText(html).length;
  const tooLong = length > max;
  return (
    <div className={styles.stack}>
      <p className={styles.note}>{s.answering.descriptive}</p>
      <RichTextEditor label={content.descriptive.group} variant="answer" value={html} onChange={onChange} invalid={tooLong} />
      <p className={`${styles.count} ${tooLong ? styles.over : ""}`} aria-live="polite">
        {content.descriptive.count(length, max)}
      </p>
      {tooLong && (
        <p className={styles.error} role="alert">
          {s.answering.tooLong(max)}
        </p>
      )}
    </div>
  );
}

/** What the teacher answered as a student, written for the teacher to compare with the key. */
function Simulated({ question, response, order, solved }: { question: SimulatedQuestion; response: SimulatedResponse | undefined; order: Order | undefined; solved: boolean }) {
  // a practical question is answered in the terminal: the server says whether it was solved (SPEC-085 D-04)
  if (isPractical(question)) return <span>{solved ? s.teacher.solved : s.teacher.notSolved}</span>;
  if (response === undefined || !isAnswered(response)) return <span>{s.teacher.notAnswered}</span>;
  if (typeof response === "boolean") return <span>{response ? content.trueFalse.true : content.trueFalse.false}</span>;
  if (typeof response === "string") {
    if (isSingleChoice(question.kind)) {
      const choice = (order?.choices ?? question.studentView.choices ?? []).find((c) => c.id === response);
      return choice ? <Html html={choice.html} /> : <span>{response}</span>;
    }
    return <Html html={response} />;
  }
  const textOf = (side: "left" | "right", id: string) => (question.studentView.columns?.[side] ?? []).find((it) => it.id === id)?.text ?? id;
  return (
    <ul className={styles.links}>
      {response.map((link) => (
        <li key={link.left}>{content.matching.pairLine(textOf("left", link.left), textOf("right", link.right))}</li>
      ))}
    </ul>
  );
}

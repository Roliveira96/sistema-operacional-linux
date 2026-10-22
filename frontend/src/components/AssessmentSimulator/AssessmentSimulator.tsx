"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { answerText, isDiscursive, isMatching, isSingleChoice, isTrueFalse } from "@/lib/questionKinds";
import { contentMessages } from "@/messages/content.pt-BR";
import { messages } from "@/messages/pt-BR";
import type { AssessmentDetail, PreviewData } from "@/services/assessmentService";
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

export interface AssessmentSimulatorProps {
  detail: AssessmentDetail;
  /** Reads the preview of the assessment; the simulator only reads (SPEC-081 RN-04). */
  load: () => Promise<PreviewData>;
  /** Where "back to the assessment" goes. */
  backHref: string;
}

/**
 * The simulator of the exam (SPEC-081): the view of the teacher and the view of the student side by side. The teacher goes through the exam as
 * a student; the answers live only in this page, and nothing is sent or stored.
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

function Simulator({ detail, load, backHref }: AssessmentSimulatorProps) {
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

  const questions = useMemo(() => (data ? simulatedQuestions(data) : []), [data]);
  const isDraw = detail.composition === "DRAW";

  const restart = useCallback(() => {
    setPhase("intro");
    setCurrent(0);
    setResponses({});
    setOrders({});
    setDeadline(null);
    setRemaining(null);
    setTimeUp(false);
    setConfirming(false);
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
  const answeredCount = questions.filter((q) => isAnswered(responses[q.questionId])).length;
  const open = phase === "answering" ? questions[current] : undefined;

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

      <div className={styles.panes}>
        <section aria-label={s.teacherView} className={styles.pane}>
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
                  <Simulated question={q} response={responses[q.questionId]} order={orders[q.questionId]} />
                </div>
              </QuestionBlock>
            ))}
          </ol>
        </section>

        <section aria-label={s.studentView} className={styles.pane}>
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
            <div className={styles.stack}>
              <div className={styles.head}>
                <h3 className={styles.examTitle}>{s.answering.position(current + 1, questions.length)}</h3>
                {remaining !== null && (
                  <span role="timer" aria-label={s.answering.timeLeft} className={styles.timer}>
                    {countdown(remaining)}
                  </span>
                )}
              </div>
              <ol aria-label={s.answering.navigator} className={styles.navigator}>
                {questions.map((q, i) => (
                  <li key={q.questionId}>
                    <button
                      type="button"
                      className={`${styles.step} ${isAnswered(responses[q.questionId]) ? styles.stepDone : ""}`}
                      aria-label={s.answering.navItem(i + 1, isAnswered(responses[q.questionId]))}
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
              <div className={styles.footer}>
                <Button variant="secondary" disabled={current === 0} onClick={() => setCurrent((n) => n - 1)}>
                  {s.answering.previous}
                </Button>
                <Button variant="secondary" disabled={current === questions.length - 1} onClick={() => setCurrent((n) => n + 1)}>
                  {s.answering.next}
                </Button>
                <Button onClick={() => setConfirming(true)}>{s.answering.deliver}</Button>
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
      </div>

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
function Simulated({ question, response, order }: { question: SimulatedQuestion; response: SimulatedResponse | undefined; order: Order | undefined }) {
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

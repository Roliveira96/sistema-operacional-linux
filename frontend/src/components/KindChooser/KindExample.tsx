"use client";

import { useEffect, useState } from "react";
import { DescriptiveAnswer } from "@/components/DescriptiveAnswer/DescriptiveAnswer";
import { MatchingAnswer } from "@/components/MatchingAnswer/MatchingAnswer";
import { SingleChoiceAnswer } from "@/components/SingleChoiceAnswer/SingleChoiceAnswer";
import { TrueFalseAnswer } from "@/components/TrueFalseAnswer/TrueFalseAnswer";
import type { QuestionKind } from "@/lib/questionKinds";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./KindExample.module.scss";

const m = authoringMessages.questionKinds;
const e = m.example;

/** How long each step of the example lasts: the question, the answer and the result make a cycle of about 6 seconds (SPEC-040 D-03). */
export const EXAMPLE_STEP_MS = 2000;
const STEPS = 3;
const RESULT = STEPS - 1;

const noop = () => undefined;

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const choices = e.choices.map((html, i) => ({ id: `c${i}`, html }));
const left = e.left.map((text, i) => ({ id: `l${i}`, text }));
const right = e.right.map((text, i) => ({ id: `r${i}`, text }));
const pairs = left.map((it, i) => ({ left: it.id, right: right[i]!.id }));
const answerHtml = `<p>${e.answer}</p>`;

/** One step of the example of a kind: 0 is the question, 1 the student answering, 2 the result, always right (SPEC-040 D-05). */
function Step({ kind, step }: { kind: QuestionKind; step: number }) {
  switch (kind) {
    case "THEORETICAL_BOOLEAN":
      return step === 0 ? (
        <TrueFalseAnswer mode="exercise" result={null} onAnswer={noop} />
      ) : step === 1 ? (
        <TrueFalseAnswer mode="assessment" value={true} onChange={noop} />
      ) : (
        <TrueFalseAnswer mode="exercise" result={{ choice: true, passed: true, correctAnswer: true }} onAnswer={noop} />
      );
    case "THEORETICAL_SINGLE":
      return step === 0 ? (
        <SingleChoiceAnswer mode="exercise" choices={choices} result={null} onAnswer={noop} />
      ) : step === 1 ? (
        <SingleChoiceAnswer mode="assessment" choices={choices} value="c1" onChange={noop} />
      ) : (
        <SingleChoiceAnswer mode="exercise" choices={choices} result={{ choice: "c1", passed: true, correctChoice: "c1" }} onAnswer={noop} />
      );
    case "THEORETICAL_MATCHING":
      return step === 0 ? (
        <MatchingAnswer mode="exercise" left={left} right={right} result={null} onAnswer={noop} />
      ) : step === 1 ? (
        <MatchingAnswer mode="assessment" left={left} right={right} value={pairs} onChange={noop} />
      ) : (
        <MatchingAnswer
          mode="exercise"
          left={left}
          right={right}
          result={{ links: pairs, passed: true, pairs, results: pairs.map((p) => ({ ...p, correct: true })) }}
          onAnswer={noop}
        />
      );
    case "DISCURSIVE":
      return step === 0 ? (
        <p className={styles.writing}>
          <span className={styles.typed} style={{ "--chars": e.answer.length } as React.CSSProperties}>
            {e.answer}
          </span>
        </p>
      ) : (
        <DescriptiveAnswer
          maxLength={2000}
          result={
            step === 1
              ? { html: answerHtml, status: "PENDING", score: null, studentNote: null, expectedAnswer: null }
              : { html: answerHtml, status: "GRADED", score: 100, studentNote: e.note, expectedAnswer: null }
          }
          onAnswer={noop}
        />
      );
    default:
      // A light play of the terminal, without its engine (SPEC-040 D-01).
      return (
        <div className={styles.terminal}>
          <p className={styles.line}>
            <span className={styles.prompt}>aluno@linux:~$</span>{" "}
            {step >= 1 && (
              <span className={step === 1 ? styles.typed : undefined} style={{ "--chars": e.terminalCommand.length } as React.CSSProperties}>
                {e.terminalCommand}
              </span>
            )}
            {step === 0 && <span className={styles.cursor} aria-hidden="true" />}
          </p>
          {step === RESULT && <p className={styles.done}>{e.terminalDone}</p>}
        </div>
      );
  }
}

/**
 * The example of a kind of question as the student sees it, playing the answer and the result in a cycle (SPEC-040). It uses the same
 * answer components as the "Desafios" tab, never calls the server and is out of reach of the mouse, the keyboard and assistive
 * technology, which only hears that it is an example.
 */
export function KindExample({ kind }: { kind: QuestionKind }) {
  const [still] = useState(prefersReducedMotion);
  const [step, setStep] = useState(still ? RESULT : 0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (still || paused) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % STEPS), EXAMPLE_STEP_MS);
    return () => clearInterval(timer);
  }, [still, paused]);

  const label = e.label(m.label[kind]);
  return (
    <figure className={styles.example} aria-label={label}>
      <figcaption className={styles.head}>
        <span className={styles.title}>{e.title}</span>
        <span className={styles.badge}>{e.badge}</span>
        {!still && (
          <button type="button" className={styles.pause} onClick={() => setPaused((p) => !p)} aria-label={paused ? e.play : e.pause} title={paused ? e.play : e.pause}>
            <span aria-hidden="true">{paused ? "▶" : "❚❚"}</span>
          </button>
        )}
      </figcaption>
      <div className={styles.screen} inert aria-hidden="true">
        <p className={styles.statement}>{e.statement[kind]}</p>
        <div key={`${kind}-${step}`} className={styles.step}>
          <Step kind={kind} step={step} />
        </div>
      </div>
    </figure>
  );
}

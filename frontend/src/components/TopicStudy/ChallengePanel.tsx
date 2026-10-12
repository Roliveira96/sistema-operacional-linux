"use client";

import Link from "next/link";
import { Html } from "@/components/ContentRenderer/blocks";
import { MatchingAnswer } from "@/components/MatchingAnswer/MatchingAnswer";
import { SingleChoiceAnswer } from "@/components/SingleChoiceAnswer/SingleChoiceAnswer";
import { TrueFalseAnswer } from "@/components/TrueFalseAnswer/TrueFalseAnswer";
import type { AnswerResponse, GivenAnswer } from "@/lib/answers";
import { isMatching, isSingleChoice, isTrueFalse } from "@/lib/questionKinds";
import { contentMessages } from "@/messages/content.pt-BR";
import type { PublicQuestion } from "@/services/contentService";
import styles from "./ChallengePanel.module.scss";

const m = contentMessages.topic.challenges;
const tf = contentMessages.trueFalse;

export interface ChallengePanelProps {
  challenges: PublicQuestion[];
  completed: ReadonlySet<string>;
  needsLogin: boolean;
  /** Id of the challenge whose machine is being prepared. */
  starting: string | null;
  /** True while a solution or a scenario is running in the terminal. */
  busy: boolean;
  onStart(challenge: PublicQuestion): void;
  onRunSolution(challenge: PublicQuestion): void;
  /** The answers already given to the questions without a terminal, by question (SPEC-035 RN-08, SPEC-036 RN-06). */
  answers?: ReadonlyMap<string, GivenAnswer>;
  /** The question whose answer is being sent. */
  answering?: string | null;
  /** Why a question could not be answered, by question. */
  answerErrors?: ReadonlyMap<string, string>;
  onAnswer?(challenge: PublicQuestion, response: AnswerResponse): void;
}

/** The "Desafios" tab: practical exercises checked automatically by the server (SPEC-016). */
export function ChallengePanel({
  challenges,
  completed,
  needsLogin,
  starting,
  busy,
  onStart,
  onRunSolution,
  answers = new Map(),
  answering = null,
  answerErrors = new Map(),
  onAnswer,
}: ChallengePanelProps) {
  if (challenges.length === 0) return <p className={styles.empty}>{m.empty}</p>;

  return (
    <div>
      <p className={styles.intro}>{m.intro}</p>
      {needsLogin && (
        <p className={styles.login} role="status">
          {m.needsLogin} <Link href="/login">{m.login}</Link>
        </p>
      )}
      <ol className={styles.list}>
        {challenges.map((challenge, i) => {
          if (isTrueFalse(challenge.kind) || isSingleChoice(challenge.kind) || isMatching(challenge.kind)) {
            const given = answers.get(challenge.id) ?? null;
            const result = given?.result ?? null;
            const error = answerErrors.get(challenge.id);
            const message = needsLogin ? (
              <>
                {tf.needsLogin} <Link href="/login">{tf.login}</Link>
              </>
            ) : (
              error
            );
            const state = result ? (result.passed ? styles.done : styles.wrong) : "";
            return (
              <li key={challenge.id} className={`${styles.item} ${state}`} data-challenge={challenge.id}>
                <span className={styles.status} role="img" aria-label={result ? (result.passed ? m.done : m.wrong) : m.todo} />
                <div className={styles.body}>
                  <p className={styles.title}>
                    <b>{i + 1}.</b> {challenge.title}
                  </p>
                  <Html html={challenge.statement} />
                  {!result && (
                    <p className={styles.intro}>{isMatching(challenge.kind) ? m.matchingIntro : isSingleChoice(challenge.kind) ? m.singleChoiceIntro : m.trueFalseIntro}</p>
                  )}
                  {isMatching(challenge.kind) ? (
                    <MatchingAnswer
                      mode="exercise"
                      label={challenge.title}
                      left={challenge.left ?? []}
                      right={challenge.right ?? []}
                      result={given?.type === "matching" ? given.result : null}
                      busy={answering === challenge.id}
                      disabled={needsLogin || !onAnswer}
                      message={message}
                      onAnswer={(links) => onAnswer?.(challenge, { links })}
                    />
                  ) : isSingleChoice(challenge.kind) ? (
                    <SingleChoiceAnswer
                      mode="exercise"
                      label={challenge.title}
                      choices={challenge.choices ?? []}
                      result={given?.type === "single" ? given.result : null}
                      busy={answering === challenge.id}
                      disabled={needsLogin || !onAnswer}
                      message={message}
                      onAnswer={(choice) => onAnswer?.(challenge, { choice })}
                    />
                  ) : (
                    <TrueFalseAnswer
                      mode="exercise"
                      label={challenge.title}
                      result={given?.type === "boolean" ? given.result : null}
                      busy={answering === challenge.id}
                      disabled={needsLogin || !onAnswer}
                      message={message}
                      onAnswer={(value) => onAnswer?.(challenge, { value })}
                    />
                  )}
                  {challenge.hint && (
                    <details className={styles.details}>
                      <summary>{m.hint}</summary>
                      <Html html={challenge.hint} />
                    </details>
                  )}
                </div>
              </li>
            );
          }
          const done = completed.has(challenge.id);
          const solution = challenge.solution ?? [];
          return (
            <li key={challenge.id} className={`${styles.item} ${done ? styles.done : ""}`} data-challenge={challenge.id}>
              <span className={styles.status} role="img" aria-label={done ? m.done : m.todo} />
              <div className={styles.body}>
                <div className={styles.statement}>
                  <b>{i + 1}.</b> <Html html={challenge.statement} className={styles.inline} />
                </div>
                <div className={styles.actions}>
                  <button type="button" className={styles.start} onClick={() => onStart(challenge)} disabled={busy || starting !== null}>
                    {starting === challenge.id ? m.starting : m.start}
                  </button>
                </div>
                {challenge.hint && (
                  <details className={styles.details}>
                    <summary>{m.hint}</summary>
                    <Html html={challenge.hint} />
                  </details>
                )}
                {solution.length > 0 && (
                  <details className={styles.details}>
                    <summary>{m.solution}</summary>
                    <pre className={styles.solution}>
                      {solution.map((step) => `${(step.terminal ?? 1) > 1 ? `[T${step.terminal}] ` : ""}${step.command}`).join("\n")}
                    </pre>
                    <button type="button" className={styles.runSolution} onClick={() => onRunSolution(challenge)} disabled={busy || starting !== null}>
                      {m.runSolution}
                    </button>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

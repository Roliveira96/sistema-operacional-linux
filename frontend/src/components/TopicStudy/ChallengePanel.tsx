"use client";

import Link from "next/link";
import { Html } from "@/components/ContentRenderer/blocks";
import { contentMessages } from "@/messages/content.pt-BR";
import type { PublicQuestion } from "@/services/contentService";
import styles from "./ChallengePanel.module.scss";

const m = contentMessages.topic.challenges;

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
}

/** The "Desafios" tab: practical exercises checked automatically by the server (SPEC-016). */
export function ChallengePanel({ challenges, completed, needsLogin, starting, busy, onStart, onRunSolution }: ChallengePanelProps) {
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

"use client";

import Link from "next/link";
import { contentMessages } from "@/messages/content.pt-BR";
import type { PublicQuestion } from "@/services/contentService";
import styles from "./TopicScreen.module.scss";

const m = contentMessages.topic;

export interface ChallengeListProps {
  challenges: PublicQuestion[];
  completed: ReadonlySet<string>;
  /** The student has no session: challenges are not checked. */
  needsLogin: boolean;
  busy: boolean;
  onStart(index: number): void;
  onRunSolution(index: number): void;
}

/** The "Desafios" tab of the prototype, checked automatically on the server (SPEC-016). */
export function ChallengeList({ challenges, completed, needsLogin, busy, onStart, onRunSolution }: ChallengeListProps) {
  if (challenges.length === 0) return <p className="desafios-intro">{m.noChallenges}</p>;
  return (
    <>
      <p className="desafios-intro">{m.challengesIntro}</p>
      {needsLogin && (
        <p className="desafios-intro" role="status">
          {m.challengesLogin} <Link href="/login">{contentMessages.goToLogin}</Link>
        </p>
      )}
      <ol className="desafios">
        {challenges.map((q, i) => {
          const done = completed.has(q.id);
          return (
            <li key={q.id} className={`desafio ${done ? "concluido" : ""}`} data-challenge={q.id}>
              <span className="desafio-status" aria-hidden="true" />
              <div className="desafio-corpo">
                <p className="desafio-enunciado">
                  <b>{i + 1}.</b> <span dangerouslySetInnerHTML={{ __html: q.statement }} />
                  {done && <span className={styles.srOnly}> ({m.done})</span>}
                </p>
                <button type="button" className="bloco-play" title={m.startTitle} disabled={busy} onClick={() => onStart(i)}>
                  {m.start}
                </button>
                {q.hint && (
                  <details>
                    <summary>{m.hint}</summary>
                    <p dangerouslySetInnerHTML={{ __html: q.hint }} />
                  </details>
                )}
                {q.solution && q.solution.length > 0 && (
                  <details>
                    <summary>{m.solution}</summary>
                    <pre className="desafio-solucao">
                      {q.solution
                        .map((s) => ((s.terminal ?? 1) > 1 ? `[${m.terminalTag(s.terminal ?? 1)}] ` : "") + s.command)
                        .join("\n")}
                    </pre>
                    <button type="button" className="bloco-play" disabled={busy} onClick={() => onRunSolution(i)}>
                      {m.runSolution}
                    </button>
                  </details>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}

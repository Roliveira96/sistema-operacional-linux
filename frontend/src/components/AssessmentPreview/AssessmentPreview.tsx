"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/Button/Button";
import { formatScore } from "@/lib/assessment";
import { messages } from "@/messages/pt-BR";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import type { DrawRule, PreviewContent, PreviewData, Stock } from "@/services/assessmentService";
import styles from "./AssessmentPreview.module.scss";

const m = messages.assessments;
const p = m.preview;

/** The rules of a draw by level; the stock column is there when the stock is known. */
export function DrawRulesTable({ rules, stock }: { rules: DrawRule[]; stock?: Stock }) {
  return (
    <table className={styles.table} aria-label={p.rules}>
      <thead>
        <tr>
          <th scope="col">{p.ruleColumns.level}</th>
          <th scope="col">{p.ruleColumns.quantity}</th>
          <th scope="col">{p.ruleColumns.points}</th>
          {stock && <th scope="col">{p.ruleColumns.stock}</th>}
        </tr>
      </thead>
      <tbody>
        {rules.map((r) => (
          <tr key={r.difficulty}>
            <td>{m.difficulty[r.difficulty]}</td>
            <td>{r.quantity}</td>
            <td>{formatScore(r.pointsPerQuestion)}</td>
            {stock && <td>{stock[r.difficulty] ?? 0}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A question with its answer: the title, the statement (HTML that the bank of the module already cleaned), the correct answer and why. */
function QuestionBlock({ question, position, weight }: { question: PreviewContent; position?: number; weight?: number }) {
  return (
    <li className={styles.question}>
      <div className={styles.head}>
        {position !== undefined && <span className={styles.position}>{position}</span>}
        <span className={styles.name}>{question.title}</span>
        <span className={styles.tag}>{(authoringMessages.questionKinds.label as Record<string, string>)[question.kind] ?? question.kind}</span>
        <span className={styles.tag}>{m.difficulty[question.difficulty]}</span>
        {weight !== undefined && <span className={styles.tag}>{m.points(formatScore(weight))}</span>}
      </div>
      <div className={styles.statement} dangerouslySetInnerHTML={{ __html: question.statement }} />
      <p className={styles.label}>{p.answer}</p>
      <pre className={styles.answer}>{question.answerKey}</pre>
      {question.explanation && (
        <>
          <p className={styles.label}>{p.explanation}</p>
          <p className={styles.explanation}>{question.explanation}</p>
        </>
      )}
    </li>
  );
}

/** The whole assessment as the teacher sees it, with the answers (SPEC-075 RN-16): the questions in order, and for a draw its rules and a sample. */
export function AssessmentPreview({ load }: { load: () => Promise<PreviewData> }) {
  const [data, setData] = useState<PreviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    load().then(
      (loaded) => {
        if (!alive) return;
        setData(loaded);
        setFailed(false);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [load, attempt]);

  if (failed) {
    return (
      <div role="alert" className={styles.problem}>
        <span>{p.loadError}</span>
        <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
          {m.retry}
        </Button>
      </div>
    );
  }
  if (!data) {
    return (
      <p role="status" className={styles.muted}>
        {p.loading}
      </p>
    );
  }

  return (
    <div className={styles.preview}>
      {data.rules && <DrawRulesTable rules={data.rules} stock={data.stock} />}
      {data.questions.length > 0 && (
        <ol className={styles.list}>
          {data.questions.map((q) => (
            <QuestionBlock key={q.questionId} question={q} position={q.position} weight={q.weight} />
          ))}
        </ol>
      )}
      {data.sample && data.sample.length > 0 && (
        <section>
          <h3 className={styles.heading}>{p.sample}</h3>
          <ul className={styles.list}>
            {data.sample.map((q) => (
              <QuestionBlock key={q.questionId} question={q} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

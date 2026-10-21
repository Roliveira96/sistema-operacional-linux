"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/Button/Button";
import { QUESTION_KINDS } from "@/lib/questionKinds";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { messages } from "@/messages/pt-BR";
import type { Difficulty, EligibleQuestion, EligibleQuestions, PickedQuestion, QuestionQuery } from "@/services/assessmentService";
import styles from "./AssessmentQuestionPicker.module.scss";

const m = messages.assessments.picker;
const kindName = (kind: string) => (authoringMessages.questionKinds.label as Record<string, string>)[kind] ?? kind;

const PAGE_SIZE = 20;
/** How long after the last key the search is made. */
const SEARCH_DELAY_MS = 300;
const LEVELS: Difficulty[] = ["EASY", "MEDIUM", "HARD"];

export interface AssessmentQuestionPickerProps {
  moduleId: string;
  /** Reads the eligible questions of the module; it must keep its identity between renders, or the list is read again each time. */
  load: (query: QuestionQuery) => Promise<EligibleQuestions>;
  selected: PickedQuestion[];
  onChange: (next: PickedQuestion[]) => void;
  /** An assessment that already started: the questions are only read. */
  disabled?: boolean;
  /** The maximum score of the assessment, for the share each chosen question has of it (SPEC-079). */
  maxScore?: number;
}

/** A weight the server takes: from 0.01 to 100, with at most 2 decimal places (SPEC-075 RN-06). */
const validWeight = (weight: number) => {
  const cents = Math.round(weight * 100);
  return Number.isFinite(weight) && Math.abs(weight * 100 - cents) < 1e-6 && cents >= 1 && cents <= 10000;
};

/**
 * The manual composition of an assessment (SPEC-075 section 3.1): the eligible questions of the module, with a filter by level and kind and a
 * search by title, each one marked to enter, and below them the questions that were chosen, with the weight of each.
 */
export function AssessmentQuestionPicker({ moduleId, load, selected, onChange, disabled = false, maxScore }: AssessmentQuestionPickerProps) {
  const baseId = useId();
  const headingId = `${baseId}-chosen`;
  const [difficulty, setDifficulty] = useState<Difficulty | "">("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<EligibleQuestions | null>(null);
  const [failed, setFailed] = useState(false);

  // The search waits for the typing to stop.
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let alive = true;
    load({ moduleId, difficulty: difficulty || undefined, kind: kind || undefined, q: term || undefined, page, pageSize: PAGE_SIZE }).then(
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
  }, [load, moduleId, difficulty, kind, term, page, attempt]);

  const chosen = new Set(selected.map((s) => s.questionId));
  const toggle = (q: EligibleQuestion) =>
    onChange(chosen.has(q.questionId) ? selected.filter((s) => s.questionId !== q.questionId) : [...selected, { ...q, weight: 0 }]);
  const setWeight = (id: string, weight: number) => onChange(selected.map((s) => (s.questionId === id ? { ...s, weight } : s)));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className={styles.picker}>
      <div className={styles.filters}>
        <div className={styles.field}>
          <label htmlFor={`${baseId}-level`}>{m.level}</label>
          <select
            id={`${baseId}-level`}
            value={difficulty}
            onChange={(e) => {
              setDifficulty(e.target.value as Difficulty | "");
              setPage(1);
            }}
          >
            <option value="">{m.allLevels}</option>
            {LEVELS.map((level) => (
              <option key={level} value={level}>
                {messages.assessments.difficulty[level]}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.field}>
          <label htmlFor={`${baseId}-kind`}>{m.kind}</label>
          <select
            id={`${baseId}-kind`}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{m.allKinds}</option>
            {QUESTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {kindName(k)}
              </option>
            ))}
          </select>
        </div>
        <div className={`${styles.field} ${styles.grow}`}>
          <label htmlFor={`${baseId}-search`}>{m.search}</label>
          <input id={`${baseId}-search`} type="search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {failed ? (
        <div role="alert" className={styles.problem}>
          <span>{m.loadError}</span>
          <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
            {messages.assessments.retry}
          </Button>
        </div>
      ) : !data ? (
        <p role="status" className={styles.muted}>
          {m.loading}
        </p>
      ) : data.items.length === 0 ? (
        <p className={styles.muted}>{m.empty}</p>
      ) : (
        <ul className={styles.list}>
          {data.items.map((q) => (
            <li key={q.questionId}>
              <label className={styles.row}>
                <input type="checkbox" aria-label={m.include(q.title)} checked={chosen.has(q.questionId)} disabled={disabled} onChange={() => toggle(q)} />
                <span className={styles.name}>{q.title}</span>
                <span className={styles.tag}>{kindName(q.kind)}</span>
                <span className={styles.tag}>{messages.assessments.difficulty[q.difficulty]}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {data && pages > 1 && (
        <div className={styles.pager}>
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            {m.previous}
          </Button>
          <span>{m.page(page, pages)}</span>
          <Button variant="secondary" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            {m.next}
          </Button>
        </div>
      )}

      {selected.length > 0 && (
        <section className={styles.chosen}>
          <h3 id={headingId} className={styles.heading}>
            {m.chosen(selected.length)}
          </h3>
          <div className={styles.scroll}>
            <table className={styles.table} aria-labelledby={headingId}>
              <thead>
                <tr>
                  <th scope="col" className={styles.position} aria-label={m.columns.positionName}>
                    {m.columns.position}
                  </th>
                  <th scope="col">{m.columns.question}</th>
                  <th scope="col">{m.columns.level}</th>
                  <th scope="col">{m.columns.weight}</th>
                  <th scope="col">{m.columns.share}</th>
                  <th scope="col">
                    <span className={styles.srOnly}>{m.columns.actions}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {selected.map((s, index) => {
                  const valid = validWeight(s.weight);
                  const problemId = `${baseId}-problem-${s.questionId}`;
                  const share = valid && maxScore !== undefined && maxScore > 0 ? m.share(Math.round((s.weight / maxScore) * 100)) : m.noShare;
                  return (
                    <tr key={s.questionId} data-invalid={valid ? undefined : "true"}>
                      <td className={styles.position}>{index + 1}</td>
                      <td>
                        <span className={styles.name}>{s.title}</span>
                        {!valid && (
                          <p id={problemId} className={styles.rowProblem}>
                            {m.weightProblem}
                          </p>
                        )}
                      </td>
                      <td>
                        <span className={styles.tag}>{messages.assessments.difficulty[s.difficulty]}</span>
                      </td>
                      <td>
                        <input
                          type="number"
                          className={styles.weight}
                          aria-label={m.weight(s.title)}
                          aria-invalid={valid ? undefined : true}
                          aria-describedby={valid ? undefined : problemId}
                          min={0}
                          max={100}
                          step={0.01}
                          value={s.weight}
                          disabled={disabled}
                          onChange={(e) => setWeight(s.questionId, e.target.value === "" ? 0 : Number(e.target.value))}
                        />
                      </td>
                      <td className={styles.share}>{share}</td>
                      <td>
                        <Button variant="ghost" aria-label={m.remove(s.title)} disabled={disabled} onClick={() => onChange(selected.filter((x) => x.questionId !== s.questionId))}>
                          {m.removeText}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

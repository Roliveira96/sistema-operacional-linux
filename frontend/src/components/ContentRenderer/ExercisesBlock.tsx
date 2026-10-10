"use client";

import { useContext, useState } from "react";
import { describeCondition, type ConditionsResult, type ExerciseCondition } from "@/lib/exerciseConditions";
import { contentMessages } from "@/messages/content.pt-BR";
import { Html } from "./blocks";
import { ExerciseCheckContext } from "./exerciseContext";
import styles from "./ExercisesBlock.module.scss";

const m = contentMessages.exercises;

type Payload = Record<string, unknown>;

interface Hint {
  text: string;
  command?: string;
}
interface Item {
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  description?: string;
  hints?: Hint[];
  solution?: { steps?: { command: string }[]; files?: { path: string }[] };
  conditions?: ExerciseCondition[];
}

/** A short stable key for an exercise, so that "done" is remembered in this browser. */
function keyOf(item: Item, index: number): string {
  const text = `${index}|${item.title}|${JSON.stringify(item.conditions ?? [])}`;
  let hash = 5381;
  for (let i = 0; i < text.length; i++) hash = (Math.imul(hash, 33) ^ text.charCodeAt(i)) >>> 0;
  return `exercise-done:${hash.toString(36)}`;
}

const wasDone = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

function Exercise({ item, index }: { item: Item; index: number }) {
  const checker = useContext(ExerciseCheckContext);
  const key = keyOf(item, index);
  const hints = item.hints ?? [];
  const conditions = item.conditions ?? [];
  const [shown, setShown] = useState(0);
  const [solution, setSolution] = useState(false);
  // Only a screen that can check shows the mark: the preview of the teacher is not a student.
  const [done, setDone] = useState(() => checker !== null && wasDone(key));
  const [missing, setMissing] = useState<ExerciseCondition[] | null>(null);
  const [noTerminal, setNoTerminal] = useState(false);

  const verify = () => {
    const result: ConditionsResult | null = checker?.check(conditions) ?? null;
    setNoTerminal(result === null);
    if (!result) return;
    setMissing(result.missing);
    if (result.done) {
      setDone(true);
      try {
        localStorage.setItem(key, "1");
      } catch {
        // The mark is only a convenience.
      }
    } else {
      setDone(false);
    }
  };

  const steps = item.solution?.steps ?? [];
  const files = item.solution?.files ?? [];
  return (
    <article className={`${styles.exercise} ${done ? styles.done : ""}`} data-difficulty={item.difficulty}>
      <header className={styles.head}>
        <h4 className={styles.title}>{item.title}</h4>
        <span className={`${styles.level} ${styles[item.difficulty.toLowerCase()] ?? ""}`}>{m.difficulty[item.difficulty]}</span>
        {done && (
          <span className={styles.doneMark} role="status">
            {m.done}
          </span>
        )}
      </header>
      {item.description && <Html html={item.description} />}

      {shown > 0 && (
        <ol className={styles.hints} aria-label={m.hints}>
          {hints.slice(0, shown).map((hint, i) => (
            <li key={i}>
              <span>{hint.text}</span>
              {hint.command && <code className={styles.command}>{hint.command}</code>}
            </li>
          ))}
        </ol>
      )}

      <div className={styles.actions}>
        {shown < hints.length && (
          <button type="button" className={styles.button} onClick={() => setShown((n) => n + 1)}>
            {m.showHint(shown + 1, hints.length)}
          </button>
        )}
        {(steps.length > 0 || files.length > 0) && (
          <button type="button" className={styles.button} onClick={() => setSolution((v) => !v)} aria-expanded={solution}>
            {solution ? m.hideSolution : m.showSolution}
          </button>
        )}
        {conditions.length > 0 && checker && (
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={verify}>
            {m.verify}
          </button>
        )}
      </div>

      {solution && (
        <div className={styles.solution}>
          <p className={styles.note}>{m.solutionNote}</p>
          <ol className={styles.steps}>
            {steps.map((step, i) => (
              <li key={i}>
                <code className={styles.command}>{step.command}</code>
              </li>
            ))}
            {files.map((file) => (
              <li key={file.path}>{m.fileWritten(file.path)}</li>
            ))}
          </ol>
        </div>
      )}

      {noTerminal && (
        <p className={styles.note} role="alert">
          {m.noTerminal}
        </p>
      )}
      {missing && missing.length > 0 && (
        <div className={styles.missing} role="alert">
          <p className={styles.note}>{m.missing}</p>
          <ul>
            {missing.map((condition, i) => (
              <li key={i}>{describeCondition(condition)}</li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

/** The group of exercises of a card: statement, level, tips on demand, how the teacher did it, and a check of how it ended. */
export function ExercisesBlock({ payload }: { payload: Payload }) {
  const items = Array.isArray(payload.items) ? (payload.items as Item[]) : [];
  if (items.length === 0) return null;
  return (
    <section className={styles.group} aria-label={m.title}>
      <h3 className={styles.groupTitle}>{m.title}</h3>
      {items.map((item, i) => (
        <Exercise key={i} item={item} index={i} />
      ))}
    </section>
  );
}

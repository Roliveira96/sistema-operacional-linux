"use client";

import { Button } from "@/components/Button/Button";
import { messages } from "@/messages/pt-BR";
import type { ExerciseMyResult, ExerciseResultBody, LiveExercise } from "@/services/classroomService";
import type { RoundExercise } from "./exerciseMachine";
import { mmss } from "./format";
import styles from "./ExerciseResult.module.scss";

const m = messages.classroom.exerciseArea;

export interface ExerciseResultProps {
  exercise: Pick<LiveExercise, "title">;
  result: ExerciseResultBody;
  /** The student himself: his row of the scoreboard stands out. */
  userId: string;
  /** What the student made of the round, when he concluded. */
  mine: ExerciseMyResult | null;
  /** How the teacher did it, once the module is loaded. */
  solution: RoundExercise["solution"] | null;
  onBack(): void;
}

/**
 * The result of the round the teacher chose to show (SPEC-065 CA-10): the scoreboard in the order the room gave it, with the student's own row marked by
 * a word and by `aria-current` and not only by color, and how the teacher did the exercise. Names and commands are texts, never html (CA-15).
 */
export function ExerciseResult({ exercise, result, userId, mine, solution, onBack }: ExerciseResultProps) {
  const steps = solution ? solution.commands.length + solution.files.length : 0;
  return (
    <section className={styles.result} aria-label={m.resultTitle}>
      <h2 className={styles.title}>{exercise.title}</h2>
      {mine && <p className={styles.mine}>{m.passed(mine.points, mmss(mine.elapsedSeconds))}</p>}
      <p className={styles.summary}>{m.completed(result.completed, result.participants)}</p>

      <h3 className={styles.heading}>{m.scoreboard}</h3>
      {result.scoreboard.length === 0 ? (
        <p className={styles.summary}>{m.nobody}</p>
      ) : (
        <table className={styles.table} aria-label={m.scoreboard}>
          <thead>
            <tr>
              <th scope="col">{m.columns.position}</th>
              <th scope="col">{m.columns.name}</th>
              <th scope="col">{m.columns.time}</th>
              <th scope="col">{m.columns.points}</th>
            </tr>
          </thead>
          <tbody>
            {result.scoreboard.map((row, i) => {
              const self = row.studentId === userId;
              return (
                <tr key={row.studentId} aria-current={self ? "true" : undefined} className={self ? styles.self : undefined}>
                  <td>{i + 1}º</td>
                  <td>
                    {row.name}
                    {self ? " " : ""}
                    {self && <span className={styles.you}>{m.you}</span>}
                  </td>
                  <td>{mmss(row.elapsedSeconds)}</td>
                  <td>{row.points}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {solution && steps > 0 && (
        <>
          <h3 className={styles.heading}>{m.solution}</h3>
          <ol className={styles.steps} aria-label={m.solution}>
            {solution.commands.map((command, i) => (
              <li key={`c${i}`}>
                <code>{command}</code>
              </li>
            ))}
            {solution.files.map((path) => (
              <li key={path}>{m.fileWritten(path)}</li>
            ))}
          </ol>
        </>
      )}

      <div className={styles.actions}>
        <Button variant="primary" onClick={onBack}>
          {m.backToClass}
        </Button>
      </div>
    </section>
  );
}

"use client";

import { Errors, Field, move, Tools } from "@/components/CardBuilder/parts";
import { SetupEditor } from "@/components/CardBuilder/SetupEditor";
import styles from "@/components/CardBuilder/CardBuilder.module.scss";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import type { CardErrors } from "@/lib/cardModel";
import {
  deriveConditions,
  describeCondition,
  type ExerciseCondition,
} from "@/lib/exerciseConditions";
import {
  DIFFICULTIES,
  type Exercise,
  type ExerciseHint,
} from "@/lib/exercises";
import { newId } from "@/lib/newId";
import type { SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";

const m = authoringMessages.builder.exercises;

interface ExerciseFormProps {
  exercise: Exercise;
  onChange: (change: Partial<Exercise>) => void;
  /** The snapshots that run before the solution: the module, the earlier cards, this card, the group and the earlier exercises. */
  before: SetupLayer[];
  /** The machine the author starts from: the topic scenario. */
  loadBase: () => Promise<unknown>;
  errors: CardErrors;
  /** Shown in the labels, so two forms on a screen can be told apart. */
  number?: number;
}

/**
 * Everything the teacher writes for one exercise (SPEC-022): title, level, statement, tips, the solution done in the terminal
 * and the conditions that say how it ends. It is the form of the page of the exercise.
 */
export function ExerciseForm({
  exercise: ex,
  onChange,
  before,
  loadBase,
  errors,
  number = 1,
}: ExerciseFormProps) {
  return (
    <div className={styles.form}>
      <Field
        label={`${m.exerciseTitle} (${number})`}
        htmlFor={`exercise-title-${number}`}
      >
        <input
          id={`exercise-title-${number}`}
          className={styles.input}
          value={ex.title}
          placeholder={m.titlePlaceholder}
          onChange={(e) => onChange({ title: e.target.value })}
          aria-invalid={Boolean(errors[ex.id])}
        />
      </Field>
      <Field
        label={`${m.level} (${number})`}
        htmlFor={`exercise-level-${number}`}
      >
        <select
          id={`exercise-level-${number}`}
          className={styles.input}
          value={ex.difficulty}
          onChange={(e) =>
            onChange({ difficulty: e.target.value as Exercise["difficulty"] })
          }
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {m.difficulty[d]}
            </option>
          ))}
        </select>
      </Field>
      <Errors id={ex.id} errors={errors} />

      <div className={styles.field}>
        <span className={styles.label}>{`${m.description} (${number})`}</span>
        <RichTextEditor
          label={`${m.description} (${number})`}
          value={ex.description}
          onChange={(description) => onChange({ description })}
        />
      </div>

      <HintsEditor
        hints={ex.hints}
        index={number - 1}
        onChange={(hints) => onChange({ hints })}
      />

      <div className={styles.group}>
        <h4 className={styles.groupTitle}>{m.solutionTitle}</h4>
        <SetupEditor
          setup={ex.solution}
          before={before}
          loadBase={loadBase}
          help={m.solutionHelp}
          recordLabel={m.solutionRecord}
          onChange={(solution) => onChange({ solution })}
          // What changed in the machine while the teacher did the exercise is how it ends.
          deriveFrom
          onAdopted={(solution, machines) =>
            onChange(
              machines
                ? {
                    solution,
                    conditions: deriveConditions(
                      machines.before,
                      machines.after,
                    ),
                  }
                : { solution },
            )
          }
        />
      </div>

      <ConditionsEditor
        conditions={ex.conditions}
        index={number - 1}
        onChange={(conditions) => onChange({ conditions })}
      />
    </div>
  );
}

function HintsEditor({
  hints,
  index,
  onChange,
}: {
  hints: ExerciseHint[];
  index: number;
  onChange: (hints: ExerciseHint[]) => void;
}) {
  const patch = (i: number, change: Partial<ExerciseHint>) =>
    onChange(hints.map((h, j) => (j === i ? { ...h, ...change } : h)));
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h4 className={styles.groupTitle}>{m.hintsTitle}</h4>
      </div>
      <p className={styles.hint}>{m.hintsHelp}</p>
      {hints.map((hint, i) => (
        <div key={hint.id} className={styles.item}>
          <div className={styles.itemHead}>
            <span className={styles.itemTitle}>{m.hintLabel(i + 1)}</span>
            <Tools
              index={i}
              total={hints.length}
              labels={{
                up: `${m.up} ${m.hintWord}`,
                down: `${m.down} ${m.hintWord}`,
                remove: `${m.remove} ${m.hintWord}`,
              }}
              onMove={(to) => onChange(move(hints, i, to))}
              onRemove={() => onChange(hints.filter((_, j) => j !== i))}
            />
          </div>
          <Field label={`${m.hintText} (${index + 1}.${i + 1})`}>
            <input
              className={styles.input}
              aria-label={`${m.hintText} (${index + 1}.${i + 1})`}
              value={hint.text}
              onChange={(e) => patch(i, { text: e.target.value })}
            />
          </Field>
          <Field label={`${m.hintCommand} (${index + 1}.${i + 1})`}>
            <input
              className={`${styles.input} ${styles.mono}`}
              aria-label={`${m.hintCommand} (${index + 1}.${i + 1})`}
              value={hint.command}
              placeholder="mkdir /home/ricardo/financeiro"
              onChange={(e) => patch(i, { command: e.target.value })}
            />
          </Field>
        </div>
      ))}
      <button
        type="button"
        className={styles.add}
        onClick={() =>
          onChange([...hints, { id: newId(), text: "", command: "" }])
        }
      >
        {m.addHint}
      </button>
    </div>
  );
}

function ConditionsEditor({
  conditions,
  index,
  onChange,
}: {
  conditions: ExerciseCondition[];
  index: number;
  onChange: (list: ExerciseCondition[]) => void;
}) {
  return (
    <div className={styles.group}>
      <h4 className={styles.groupTitle}>{m.conditionsTitle}</h4>
      <p className={styles.hint}>{m.conditionsHelp}</p>
      {conditions.length === 0 ? (
        <p className={styles.hint}>{m.noConditions}</p>
      ) : (
        <ul
          className={styles.fileList}
          aria-label={`${m.conditionsTitle} (${index + 1})`}
        >
          {conditions.map((condition, i) => (
            <li key={i} className={styles.item}>
              <span>{describeCondition(condition)}</span>
              {condition.kind === "FILE_CONTENT" && (
                <select
                  className={styles.input}
                  aria-label={`${m.contentMatch}: ${condition.path}`}
                  value={condition.match ?? "equals"}
                  onChange={(e) =>
                    onChange(
                      conditions.map((c, j) =>
                        j === i
                          ? {
                              ...c,
                              match: e.target.value as "equals" | "contains",
                            }
                          : c,
                      ),
                    )
                  }
                >
                  <option value="equals">{m.matchEquals}</option>
                  <option value="contains">{m.matchContains}</option>
                </select>
              )}
              <button
                type="button"
                className={styles.small}
                aria-label={m.removeCondition(describeCondition(condition))}
                onClick={() => onChange(conditions.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

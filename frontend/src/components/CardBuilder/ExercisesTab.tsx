"use client";

import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import type { CardErrors } from "@/lib/cardModel";
import { deriveConditions, describeCondition, type ExerciseCondition } from "@/lib/exerciseConditions";
import { DIFFICULTIES, emptyExercise, type Exercise, type ExerciseGroup, type ExerciseHint } from "@/lib/exercises";
import { newId } from "@/lib/newId";
import { hasSetup, type Setup, type SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./CardBuilder.module.scss";
import { Errors, Field, move, Section, Tools } from "./parts";
import { SetupEditor } from "./SetupEditor";

const m = authoringMessages.builder.exercises;

interface ExercisesTabProps {
  group?: ExerciseGroup;
  onChange: (group: ExerciseGroup) => void;
  /** The layers that come before the group: the module, the earlier cards and this card's own snapshot. */
  before: SetupLayer[];
  /** The machine the author starts from: the topic scenario. */
  loadBase: () => Promise<unknown>;
  errors: CardErrors;
}

/**
 * The tab of the exercises of a card (SPEC-022): the snapshot of the group, and for each exercise its statement, level, tips,
 * the solution the teacher does in the terminal and the conditions that say how it ends.
 */
export function ExercisesTab({ group, onChange, before, loadBase, errors }: ExercisesTabProps) {
  const current: ExerciseGroup = group ?? { items: [] };
  const update = (change: Partial<ExerciseGroup>) => onChange({ ...current, ...change });
  const patch = (index: number, change: Partial<Exercise>) => update({ items: current.items.map((ex, i) => (i === index ? { ...ex, ...change } : ex)) });

  // The machine the solutions start from: the layers, the base of the group and the solutions of the exercises before.
  const groupLayer: SetupLayer[] = hasSetup(current.setup) ? [{ id: "group", kind: "card", label: m.groupLayer, setup: current.setup }] : [];
  const solutionLayers = (upTo: number): SetupLayer[] =>
    current.items.slice(0, upTo).flatMap((ex, i) => (hasSetup(ex.solution) ? [{ id: `solution-${i}`, kind: "card" as const, label: m.solutionLayer(ex.title.trim() || String(i + 1)), setup: ex.solution }] : []));

  return (
    <>
      <Section title={m.groupTitle} hint={m.groupHint}>
        <SetupEditor
          setup={current.setup}
          before={before}
          loadBase={loadBase}
          help={m.groupHelp}
          recordLabel={m.groupRecord}
          onChange={(setup: Setup | undefined) => update({ setup })}
        />
        <Errors id="exercises-setup" errors={errors} />
      </Section>

      <Section
        title={m.title}
        hint={m.hint}
        action={
          <button type="button" className={styles.add} onClick={() => update({ items: [...current.items, emptyExercise()] })}>
            {m.add}
          </button>
        }
      >
        {current.items.length === 0 && <p className={styles.hint}>{m.empty}</p>}
        {current.items.map((ex, i) => (
          <details key={ex.id} className={styles.item} open={current.items.length === 1 || undefined}>
            <summary className={styles.itemHead}>
              <span className={styles.itemTitle}>{ex.title.trim() || m.untitled(i + 1)}</span>
              <span className={styles.hint}>{m.difficulty[ex.difficulty]}</span>
            </summary>

            <div className={styles.pair}>
              <Field label={`${m.exerciseTitle} (${i + 1})`} htmlFor={`exercise-title-${i}`}>
                <input id={`exercise-title-${i}`} className={styles.input} value={ex.title} placeholder={m.titlePlaceholder} onChange={(e) => patch(i, { title: e.target.value })} aria-invalid={Boolean(errors[ex.id])} />
              </Field>
              <Field label={`${m.level} (${i + 1})`} htmlFor={`exercise-level-${i}`}>
                <select id={`exercise-level-${i}`} className={styles.input} value={ex.difficulty} onChange={(e) => patch(i, { difficulty: e.target.value as Exercise["difficulty"] })}>
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {m.difficulty[d]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Errors id={ex.id} errors={errors} />

            <div className={styles.field}>
              <span className={styles.label}>{`${m.description} (${i + 1})`}</span>
              <RichTextEditor label={`${m.description} (${i + 1})`} value={ex.description} onChange={(description) => patch(i, { description })} />
            </div>

            <HintsEditor hints={ex.hints} index={i} onChange={(hints) => patch(i, { hints })} />

            <div className={styles.group}>
              <h4 className={styles.groupTitle}>{m.solutionTitle}</h4>
              <SetupEditor
                setup={ex.solution}
                before={[...before, ...groupLayer, ...solutionLayers(i)]}
                loadBase={loadBase}
                help={m.solutionHelp}
                recordLabel={m.solutionRecord}
                onChange={(solution) => patch(i, { solution })}
                // What changed in the machine while the teacher did the exercise is how it ends.
                deriveFrom
                onAdopted={(solution, machines) => patch(i, machines ? { solution, conditions: deriveConditions(machines.before, machines.after) } : { solution })}
              />
            </div>

            <ConditionsEditor conditions={ex.conditions} index={i} onChange={(conditions) => patch(i, { conditions })} />

            <Tools index={i} total={current.items.length} labels={{ up: m.up, down: m.down, remove: m.remove }} onMove={(to) => update({ items: move(current.items, i, to) })} onRemove={() => update({ items: current.items.filter((_, j) => j !== i) })} />
          </details>
        ))}
      </Section>
    </>
  );
}

function HintsEditor({ hints, index, onChange }: { hints: ExerciseHint[]; index: number; onChange: (hints: ExerciseHint[]) => void }) {
  const patch = (i: number, change: Partial<ExerciseHint>) => onChange(hints.map((h, j) => (j === i ? { ...h, ...change } : h)));
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h4 className={styles.groupTitle}>{m.hintsTitle}</h4>
        <button type="button" className={styles.add} onClick={() => onChange([...hints, { id: newId(), text: "", command: "" }])}>
          {m.addHint}
        </button>
      </div>
      <p className={styles.hint}>{m.hintsHelp}</p>
      {hints.map((hint, i) => (
        <div key={hint.id} className={styles.item}>
          <div className={styles.itemHead}>
            <span className={styles.itemTitle}>{m.hintLabel(i + 1)}</span>
            <Tools index={i} total={hints.length} labels={{ up: `${m.up} ${m.hintWord}`, down: `${m.down} ${m.hintWord}`, remove: `${m.remove} ${m.hintWord}` }} onMove={(to) => onChange(move(hints, i, to))} onRemove={() => onChange(hints.filter((_, j) => j !== i))} />
          </div>
          <Field label={`${m.hintText} (${index + 1}.${i + 1})`}>
            <input className={styles.input} aria-label={`${m.hintText} (${index + 1}.${i + 1})`} value={hint.text} onChange={(e) => patch(i, { text: e.target.value })} />
          </Field>
          <Field label={`${m.hintCommand} (${index + 1}.${i + 1})`}>
            <input className={`${styles.input} ${styles.mono}`} aria-label={`${m.hintCommand} (${index + 1}.${i + 1})`} value={hint.command} placeholder="mkdir /home/ricardo/financeiro" onChange={(e) => patch(i, { command: e.target.value })} />
          </Field>
        </div>
      ))}
    </div>
  );
}

function ConditionsEditor({ conditions, index, onChange }: { conditions: ExerciseCondition[]; index: number; onChange: (list: ExerciseCondition[]) => void }) {
  return (
    <div className={styles.group}>
      <h4 className={styles.groupTitle}>{m.conditionsTitle}</h4>
      <p className={styles.hint}>{m.conditionsHelp}</p>
      {conditions.length === 0 ? (
        <p className={styles.hint}>{m.noConditions}</p>
      ) : (
        <ul className={styles.fileList} aria-label={`${m.conditionsTitle} (${index + 1})`}>
          {conditions.map((condition, i) => (
            <li key={i} className={styles.item}>
              <span>{describeCondition(condition)}</span>
              {condition.kind === "FILE_CONTENT" && (
                <select
                  className={styles.input}
                  aria-label={`${m.contentMatch}: ${condition.path}`}
                  value={condition.match ?? "equals"}
                  onChange={(e) => onChange(conditions.map((c, j) => (j === i ? { ...c, match: e.target.value as "equals" | "contains" } : c)))}
                >
                  <option value="equals">{m.matchEquals}</option>
                  <option value="contains">{m.matchContains}</option>
                </select>
              )}
              <button type="button" className={styles.small} aria-label={m.removeCondition(describeCondition(condition))} onClick={() => onChange(conditions.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

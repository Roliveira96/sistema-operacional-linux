"use client";

import Link from "next/link";
import type { CardErrors } from "@/lib/cardModel";
import { type ExerciseGroup } from "@/lib/exercises";
import type { Setup, SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import styles from "./CardBuilder.module.scss";
import { Errors, move, Section, Tools } from "./parts";
import { SetupEditor } from "./SetupEditor";

const m = authoringMessages.builder.exercises;

interface ExercisesTabProps {
  moduleId: string;
  /** The key of the stored card; a card that was never saved has none, and its exercises have no page yet. */
  cardKey?: string;
  group?: ExerciseGroup;
  onChange: (group: ExerciseGroup) => void;
  /** The layers that come before the group: the module, the earlier cards and this card's own snapshot. */
  before: SetupLayer[];
  /** The machine the author starts from: the topic scenario. */
  loadBase: () => Promise<unknown>;
  errors: CardErrors;
  /** The card has changes that are not saved: a page of an exercise would not see them. */
  dirty: boolean;
}

/**
 * The tab of the exercises of a card (SPEC-022): the snapshot of the group and the list of exercises. Each exercise is
 * written on a page of its own; the list only orders, opens and removes them.
 */
export function ExercisesTab({ moduleId, cardKey, group, onChange, before, loadBase, errors, dirty }: ExercisesTabProps) {
  const current: ExerciseGroup = group ?? { items: [] };
  const update = (change: Partial<ExerciseGroup>) => onChange({ ...current, ...change });
  const base = `/app/modules/${moduleId}/cards/${cardKey}/exercises`;
  const canOpen = Boolean(cardKey) && !dirty;

  return (
    <>
      <Section title={m.groupTitle} hint={m.groupHint}>
        <SetupEditor setup={current.setup} before={before} loadBase={loadBase} help={m.groupHelp} recordLabel={m.groupRecord} onChange={(setup: Setup | undefined) => update({ setup })} />
        <Errors id="exercises-setup" errors={errors} />
      </Section>

      <Section
        title={m.title}
        hint={m.hint}
        action={
          canOpen ? (
            <Link href={`${base}/new`} className={styles.add}>
              {m.add}
            </Link>
          ) : (
            <span className={styles.add} aria-disabled="true">
              {m.add}
            </span>
          )
        }
      >
        {!canOpen && <p className={styles.hint}>{cardKey ? m.saveFirst : m.saveCardFirst}</p>}
        {current.items.length === 0 && <p className={styles.hint}>{m.empty}</p>}
        <ol className={styles.fileList} aria-label={m.title}>
          {current.items.map((ex, i) => (
            <li key={ex.id} className={styles.exerciseRow}>
              <span className={styles.exerciseNumber} aria-hidden="true">
                {i + 1}
              </span>
              <div className={styles.exerciseBody}>
                <span className={styles.exerciseTitle}>{ex.title.trim() || m.untitled(i + 1)}</span>
                <span className={styles.exerciseMeta}>
                  {m.difficulty[ex.difficulty]} · {m.hintCount(ex.hints.length)} · {ex.solution ? m.hasSolution : m.noSolution} · {m.conditionCount(ex.conditions.length)}
                </span>
                <Errors id={ex.id} errors={errors} />
              </div>
              <div className={styles.exerciseActions}>
                {canOpen ? (
                  <Link href={`${base}/${i}`} className={styles.add} aria-label={m.openExercise(ex.title.trim() || String(i + 1))}>
                    {m.edit}
                  </Link>
                ) : null}
                <Tools index={i} total={current.items.length} labels={{ up: m.up, down: m.down, remove: m.remove }} onMove={(to) => update({ items: move(current.items, i, to) })} onRemove={() => update({ items: current.items.filter((_, j) => j !== i) })} />
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}

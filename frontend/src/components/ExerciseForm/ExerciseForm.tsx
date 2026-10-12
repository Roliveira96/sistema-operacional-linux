"use client";

import { InfoTip } from "@/components/InfoTip/InfoTip";
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
import { ANSWER_SIZES, DEFAULT_ANSWER_SIZE, isDiscursive, isMatching, isSingleChoice, MAX_CHOICES, MAX_PAIRS, MIN_CHOICES, MIN_PAIRS, usesTerminal } from "@/lib/questionKinds";
import type { SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService } from "@/services/contentAuthoringService";

const m = authoringMessages.builder.exercises;
const k = authoringMessages.questionKinds;

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
  /** Sends an image of the description or of the justification (SPEC-025, SPEC-035 D-12). */
  uploadImage?: (file: File) => Promise<{ url: string }>;
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
  uploadImage = contentAuthoringService.uploadImage,
}: ExerciseFormProps) {
  return (
    <div className={styles.form}>
      <Field
        label={`${m.exerciseTitle} (${number})`}
        htmlFor={`exercise-title-${number}`}
        info={authoringMessages.info.exerciseTitle}
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
        info={authoringMessages.info.exerciseLevel}
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
        <div className={styles.labelRow}>
          <span className={styles.label}>{`${m.description} (${number})`}</span>
          <InfoTip topic={m.description}>{authoringMessages.info.exerciseStatement}</InfoTip>
        </div>
        <RichTextEditor
          label={`${m.description} (${number})`}
          value={ex.description}
          onChange={(description) => onChange({ description })}
          uploadImage={uploadImage}
        />
      </div>

      <HintsEditor
        hints={ex.hints}
        index={number - 1}
        onChange={(hints) => onChange({ hints })}
      />

      {isDiscursive(ex.kind) ? (
        <DiscursiveParts exercise={ex} onChange={onChange} number={number} uploadImage={uploadImage} />
      ) : isMatching(ex.kind) ? (
        <MatchingParts exercise={ex} onChange={onChange} number={number} uploadImage={uploadImage} />
      ) : isSingleChoice(ex.kind) ? (
        <ChoiceParts exercise={ex} onChange={onChange} number={number} uploadImage={uploadImage} />
      ) : usesTerminal(ex.kind) ? (
        <TerminalParts exercise={ex} onChange={onChange} before={before} loadBase={loadBase} number={number} />
      ) : (
        <TrueFalseParts exercise={ex} onChange={onChange} number={number} uploadImage={uploadImage} />
      )}
    </div>
  );
}

/** The two columns of a matching question, each in its own order, the pair the teacher selects for each item of the left column, and the
 * order for the student (SPEC-037 D-09, D-10). */
function MatchingParts({
  exercise: ex,
  onChange,
  number,
  uploadImage,
}: {
  exercise: Exercise;
  onChange: (change: Partial<Exercise>) => void;
  number: number;
  uploadImage: (file: File) => Promise<{ url: string }>;
}) {
  const left = ex.left ?? [];
  const right = ex.right ?? [];
  const pairs = ex.pairs ?? [];
  const pairOf = (leftId: string) => pairs.find((p) => p.left === leftId)?.right ?? "";
  const setPair = (leftId: string, rightId: string) =>
    onChange({ pairs: [...pairs.filter((p) => p.left !== leftId), ...(rightId ? [{ left: leftId, right: rightId }] : [])] });
  const column = (side: "left" | "right") => {
    const items = side === "left" ? left : right;
    const set = (next: typeof items) => onChange(side === "left" ? { left: next } : { right: next });
    const sideName = side === "left" ? k.left : k.right;
    return (
      <ol className={styles.fileList} aria-label={`${side === "left" ? k.leftColumn : k.rightColumn} (${number})`}>
        {items.map((it, i) => (
          <li key={it.id} className={styles.exerciseRow}>
            <div className={styles.exerciseBody}>
              <input
                className={styles.input}
                aria-label={side === "left" ? k.leftItem(i + 1) : k.rightItem(i + 1)}
                value={it.text}
                maxLength={200}
                onChange={(e) => set(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))}
              />
              {side === "left" && (
                <select className={styles.input} aria-label={k.pairOf(i + 1)} value={pairOf(it.id)} onChange={(e) => setPair(it.id, e.target.value)}>
                  <option value="">{k.choosePair}</option>
                  {right
                    .filter((r) => r.id === pairOf(it.id) || !pairs.some((p) => p.right === r.id))
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.text.trim() || k.rightItem(right.indexOf(r) + 1)}
                      </option>
                    ))}
                </select>
              )}
            </div>
            <div className={styles.tools}>
              <button type="button" className={styles.small} onClick={() => set(move(items, i, i - 1))} disabled={i === 0} aria-label={k.itemUp(sideName, i + 1)}>
                ↑
              </button>
              <button type="button" className={styles.small} onClick={() => set(move(items, i, i + 1))} disabled={i === items.length - 1} aria-label={k.itemDown(sideName, i + 1)}>
                ↓
              </button>
            </div>
          </li>
        ))}
      </ol>
    );
  };
  const removeLast = (index: number) => {
    const gone = { left: left[index]?.id, right: right[index]?.id };
    onChange({
      left: left.filter((_, j) => j !== index),
      right: right.filter((_, j) => j !== index),
      pairs: pairs.filter((p) => p.left !== gone.left && p.right !== gone.right),
    });
  };
  return (
    <>
      <div className={styles.group}>
        <div className={styles.titleRow}>
          <h4 className={styles.groupTitle}>{`${k.columnsTitle} (${number})`}</h4>
          <InfoTip topic={k.columnsTitle}>{k.columnsHelp}</InfoTip>
        </div>
        <div className={styles.columns}>
          {column("left")}
          {column("right")}
        </div>
        <div className={styles.tools}>
          {left.map((_, i) => (
            <button
              key={i}
              type="button"
              className={styles.small}
              onClick={() => removeLast(i)}
              disabled={left.length <= MIN_PAIRS}
              aria-label={k.itemRemove(i + 1)}
            >
              ✕ {i + 1}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.add}
          onClick={() => onChange({ left: [...left, { id: newId(), text: "" }], right: [...right, { id: newId(), text: "" }] })}
          disabled={left.length >= MAX_PAIRS}
        >
          {k.addPair}
        </button>
        <label className={styles.check}>
          <input type="checkbox" checked={ex.shuffleChoices !== false} onChange={(e) => onChange({ shuffleChoices: e.target.checked })} />
          {k.shuffleColumns}
          <InfoTip topic={k.shuffleColumns}>{k.shuffleColumnsHelp}</InfoTip>
        </label>
      </div>
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{`${k.explanation} (${number})`}</span>
          <InfoTip topic={k.explanation}>{k.explanationHelp}</InfoTip>
        </div>
        <RichTextEditor
          label={`${k.explanation} (${number})`}
          value={ex.explanation ?? ""}
          onChange={(explanation) => onChange({ explanation })}
          uploadImage={uploadImage}
        />
      </div>
      <p className={styles.hint}>{k.noTerminalPage}</p>
    </>
  );
}

/** The alternatives of a single choice question, the only correct one, the order for the student and the justification (SPEC-036). */
function ChoiceParts({
  exercise: ex,
  onChange,
  number,
  uploadImage,
}: {
  exercise: Exercise;
  onChange: (change: Partial<Exercise>) => void;
  number: number;
  uploadImage: (file: File) => Promise<{ url: string }>;
}) {
  const choices = ex.choices ?? [];
  const set = (next: typeof choices) => onChange({ choices: next });
  const name = `correct-choice-${number}`;
  return (
    <>
      <div className={styles.group}>
        <div className={styles.titleRow}>
          <h4 className={styles.groupTitle}>{`${k.choices} (${number})`}</h4>
          <InfoTip topic={k.choices}>{k.choicesHelp}</InfoTip>
        </div>
        <ol className={styles.fileList} aria-label={`${k.choices} (${number})`}>
          {choices.map((choice, i) => (
            <li key={choice.id} className={styles.exerciseRow}>
              <span className={styles.exerciseNumber} aria-hidden="true">
                {String.fromCharCode(65 + i)}
              </span>
              <div className={styles.exerciseBody}>
                <RichTextEditor
                  label={k.choice(i + 1)}
                  value={choice.html}
                  onChange={(html) => set(choices.map((c, j) => (j === i ? { ...c, html } : c)))}
                  uploadImage={uploadImage}
                />
                <label className={styles.check}>
                  <input
                    type="radio"
                    name={name}
                    checked={ex.correctChoice === choice.id}
                    onChange={() => onChange({ correctChoice: choice.id })}
                    aria-label={k.markCorrect(i + 1)}
                  />
                  {k.correct}
                </label>
              </div>
              <div className={styles.tools}>
                <button type="button" className={styles.small} onClick={() => set(move(choices, i, i - 1))} disabled={i === 0} aria-label={k.choiceUp(i + 1)}>
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() => set(move(choices, i, i + 1))}
                  disabled={i === choices.length - 1}
                  aria-label={k.choiceDown(i + 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={styles.small}
                  onClick={() =>
                    onChange({
                      choices: choices.filter((_, j) => j !== i),
                      ...(ex.correctChoice === choice.id ? { correctChoice: null } : {}),
                    })
                  }
                  disabled={choices.length <= MIN_CHOICES}
                  aria-label={k.choiceRemove(i + 1)}
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className={styles.add} onClick={() => set([...choices, { id: newId(), html: "" }])} disabled={choices.length >= MAX_CHOICES}>
          {k.addChoice}
        </button>
        <label className={styles.check}>
          <input type="checkbox" checked={ex.shuffleChoices !== false} onChange={(e) => onChange({ shuffleChoices: e.target.checked })} />
          {k.shuffle}
          <InfoTip topic={k.shuffle}>{k.shuffleHelp}</InfoTip>
        </label>
      </div>
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{`${k.explanation} (${number})`}</span>
          <InfoTip topic={k.explanation}>{k.explanationHelp}</InfoTip>
        </div>
        <RichTextEditor
          label={`${k.explanation} (${number})`}
          value={ex.explanation ?? ""}
          onChange={(explanation) => onChange({ explanation })}
          uploadImage={uploadImage}
        />
      </div>
      <p className={styles.hint}>{k.noTerminalPage}</p>
    </>
  );
}

/** The answer of a true or false question and its justification (SPEC-035 RN-03); no terminal, solution nor conditions. */
function TrueFalseParts({
  exercise: ex,
  onChange,
  number,
  uploadImage,
}: {
  exercise: Exercise;
  onChange: (change: Partial<Exercise>) => void;
  number: number;
  uploadImage: (file: File) => Promise<{ url: string }>;
}) {
  const name = `correct-answer-${number}`;
  return (
    <>
      <fieldset className={styles.group}>
        <legend className={styles.titleRow}>
          <span className={styles.groupTitle}>{`${k.correctAnswer} (${number})`}</span>
          <InfoTip topic={k.correctAnswer}>{k.correctAnswerHelp}</InfoTip>
        </legend>
        {[true, false].map((value) => (
          <label key={String(value)} className={styles.check}>
            <input type="radio" name={name} checked={ex.correctAnswer === value} onChange={() => onChange({ correctAnswer: value })} />
            {value ? k.true : k.false}
          </label>
        ))}
      </fieldset>
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{`${k.explanation} (${number})`}</span>
          <InfoTip topic={k.explanation}>{k.explanationHelp}</InfoTip>
        </div>
        <RichTextEditor
          label={`${k.explanation} (${number})`}
          value={ex.explanation ?? ""}
          onChange={(explanation) => onChange({ explanation })}
          uploadImage={uploadImage}
        />
      </div>
      <p className={styles.hint}>{k.noTerminalPage}</p>
    </>
  );
}

/** The correct answer that guides the correction and the size of the answer of a descriptive question (SPEC-039 D-03, D-05). */
function DiscursiveParts({
  exercise: ex,
  onChange,
  number,
  uploadImage,
}: {
  exercise: Exercise;
  onChange: (change: Partial<Exercise>) => void;
  number: number;
  uploadImage: (file: File) => Promise<{ url: string }>;
}) {
  return (
    <>
      <div className={styles.field}>
        <div className={styles.labelRow}>
          <span className={styles.label}>{`${k.expectedAnswer} (${number})`}</span>
          <InfoTip topic={k.expectedAnswer}>{k.expectedAnswerHelp}</InfoTip>
        </div>
        <RichTextEditor
          label={`${k.expectedAnswer} (${number})`}
          value={ex.expectedAnswer ?? ""}
          onChange={(expectedAnswer) => onChange({ expectedAnswer })}
          uploadImage={uploadImage}
        />
      </div>
      <Field label={`${k.maxLength} (${number})`} htmlFor={`answer-size-${number}`} info={k.maxLengthHelp}>
        <select
          id={`answer-size-${number}`}
          className={styles.input}
          value={ex.maxLength ?? DEFAULT_ANSWER_SIZE}
          onChange={(e) => onChange({ maxLength: Number(e.target.value) })}
        >
          {ANSWER_SIZES.map((n) => (
            <option key={n} value={n}>
              {n === DEFAULT_ANSWER_SIZE ? k.sizeDefault(n) : k.size(n)}
            </option>
          ))}
        </select>
      </Field>
      <p className={styles.hint}>{k.noTerminalPage}</p>
    </>
  );
}

/** The solution done in the terminal and the conditions that say how a practical exercise ends (SPEC-022). */
function TerminalParts({
  exercise: ex,
  onChange,
  before,
  loadBase,
  number,
}: {
  exercise: Exercise;
  onChange: (change: Partial<Exercise>) => void;
  before: SetupLayer[];
  loadBase: () => Promise<unknown>;
  number: number;
}) {
  return (
    <>
      <div className={styles.group}>
        <div className={styles.titleRow}>
          <h4 className={styles.groupTitle}>{m.solutionTitle}</h4>
          <InfoTip topic={m.solutionTitle}>{authoringMessages.info.solution}</InfoTip>
        </div>
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
    </>
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
        <div className={styles.titleRow}>
          <h4 className={styles.groupTitle}>{m.hintsTitle}</h4>
          <InfoTip topic={m.hintsTitle}>{authoringMessages.info.hints}</InfoTip>
        </div>
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
      <div className={styles.titleRow}>
        <h4 className={styles.groupTitle}>{m.conditionsTitle}</h4>
        <InfoTip topic={m.conditionsTitle}>{authoringMessages.info.conditions}</InfoTip>
      </div>
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

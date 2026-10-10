"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import { RichTextEditor } from "@/components/RichTextEditor/RichTextEditor";
import {
  buildBlocks,
  checkCard,
  looksSafe,
  newElement,
  newId,
  parseCard,
  placeServerErrors,
  type CardBox,
  type CardCommand,
  type CardElement,
  type CardErrors,
  type CardGroup,
  type CardModel,
  type ElementKind,
} from "@/lib/cardModel";
import { cardTestItems } from "@/lib/exercises";
import { hasSetup, type SetupLayer } from "@/lib/setup";
import { saveTest } from "@/lib/testRecord";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import {
  contentAuthoringService,
  type AuthoredBlock,
  type ContentAuthoringService,
} from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import {
  practiceService,
  type PracticeService,
} from "@/services/practiceService";
import { CardTester } from "./CardTester";
import { ExercisesTab } from "./ExercisesTab";
import { Errors, Field, move, Section, Tools } from "./parts";
import { SetupEditor } from "./SetupEditor";
import styles from "./CardBuilder.module.scss";

const m = authoringMessages.builder;

interface CardBuilderProps {
  moduleId: string;
  /** The stored card being edited; a new card has none. */
  group?: CardGroup;
  /** A new card goes after this block; without it, at the end. */
  afterId?: string;
  service?: ContentAuthoringService;
  /** The snapshots that run before this card: the module and the earlier cards (SPEC-021). */
  before?: SetupLayer[];
  practice?: Pick<PracticeService, "topicScenario">;
  /** The tab that is open first (the page of an exercise goes back to the exercises). */
  initialTab?: CardTab;
  /** Called after a new card is stored, with its blocks. */
  onCreated?: (blocks: AuthoredBlock[]) => void;
  onCancel: () => void;
}

export type CardTab = "description" | "commands" | "tips" | "exercises";
const TABS: CardTab[] = ["description", "commands", "tips", "exercises"];
const TAB_ICONS: Record<CardTab, string> = {
  description: "📝",
  commands: "💻",
  tips: "💡",
  exercises: "🎯",
};

// The emoji that marks each kind of element in the form: it only decorates, the title says it all.
const KIND_ICONS: Record<string, string> = {
  text: "📝",
  html: "🧩",
  block: "🧩",
  code: "💻",
  table: "📊",
  image: "🖼️",
  video: "🎬",
  link: "🔗",
};

const INSERTABLE: Exclude<ElementKind, "block">[] = [
  "text",
  "html",
  "code",
  "table",
  "image",
  "video",
  "link",
];
const NEWLINE = String.fromCharCode(10);

/** Splits the blocks the server returns back into a card (its first block may be the header). */
function toGroup(blocks: AuthoredBlock[]): CardGroup {
  const first = blocks[0] as AuthoredBlock;
  const titled =
    first.type === "TEXT" &&
    typeof first.payload.title === "string" &&
    first.payload.title.trim() !== "";
  return { key: first.id, header: titled ? first : undefined, blocks };
}

function ElementRow({
  el,
  index,
  total,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  el: CardElement;
  index: number;
  total: number;
  errors: CardErrors;
  onChange: (patch: Partial<CardElement>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const d = m.description;
  const n = index + 1;
  const label = (text: string) => `${text} ${n}`;
  const input = (
    text: string,
    value: string,
    key: keyof CardElement,
    mono = false,
  ) => (
    <Field label={label(text)}>
      <input
        className={`${styles.input} ${mono ? styles.mono : ""}`}
        aria-label={label(text)}
        value={value}
        onChange={(e) => onChange({ [key]: e.target.value })}
        aria-invalid={Boolean(errors[el.id])}
      />
    </Field>
  );

  let body: React.ReactNode;
  switch (el.kind) {
    case "text":
      body = (
        <div className={styles.field}>
          <span className={styles.label}>{label(d.text)}</span>
          <RichTextEditor
            label={label(d.text)}
            value={el.html}
            onChange={(html) => onChange({ html })}
            invalid={Boolean(errors[el.id])}
          />
        </div>
      );
      break;
    case "html":
      body = (
        <Field label={label(d.htmlCode)}>
          <textarea
            className={`${styles.input} ${styles.mono}`}
            rows={6}
            aria-label={label(d.htmlCode)}
            value={el.html}
            onChange={(e) => onChange({ html: e.target.value })}
            aria-invalid={Boolean(errors[el.id])}
          />
          <p className={styles.hint}>{d.htmlHelp}</p>
        </Field>
      );
      break;
    case "code":
      body = (
        <>
          {input(d.codeLang, el.lang, "lang", true)}
          <Field label={label(d.code)}>
            <textarea
              className={`${styles.input} ${styles.mono}`}
              rows={3}
              aria-label={label(d.code)}
              value={el.code}
              onChange={(e) => onChange({ code: e.target.value })}
              aria-invalid={Boolean(errors[el.id])}
            />
          </Field>
        </>
      );
      break;
    case "table":
      body = (
        <>
          {input(d.tableHeaders, el.headers, "headers", true)}
          <Field label={label(d.tableRows)}>
            <textarea
              className={`${styles.input} ${styles.mono}`}
              rows={3}
              aria-label={label(d.tableRows)}
              value={el.rows}
              onChange={(e) => onChange({ rows: e.target.value })}
            />
          </Field>
        </>
      );
      break;
    case "image":
      body = (
        <>
          {input(d.imageUrl, el.url, "url")}
          {input(d.imageCaption, el.caption, "caption")}
        </>
      );
      break;
    case "video":
      body = input(d.videoUrl, el.url, "url");
      break;
    case "link":
      body = (
        <>
          {input(d.linkText, el.caption, "caption")}
          {input(d.linkUrl, el.url, "url")}
        </>
      );
      break;
    default:
      body = <p className={styles.hint}>{d.preserved(el.block?.type ?? "")}</p>;
  }

  return (
    <div className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemTitle}>
          <span aria-hidden="true">{KIND_ICONS[el.kind] ?? "📄"}</span>{" "}
          {d.item(d.kinds[el.kind], n)}
        </span>
        <Tools
          index={index}
          total={total}
          labels={{ up: d.up, down: d.down, remove: d.remove }}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      {body}
      <Errors id={el.id} errors={errors} />
    </div>
  );
}

function CommandRow({
  cmd,
  index,
  total,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  cmd: CardCommand;
  index: number;
  total: number;
  errors: CardErrors;
  onChange: (patch: Partial<CardCommand>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
}) {
  const c = m.commands;
  const n = index + 1;
  const label = (text: string) => `${text} (${n})`;
  return (
    <div className={styles.item}>
      <div className={styles.itemHead}>
        <span className={styles.itemTitle}>
          <span aria-hidden="true">⌨️</span> {c.item(n)}
        </span>
        <Tools
          index={index}
          total={total}
          labels={{ up: c.up, down: c.down, remove: c.remove }}
          onMove={onMove}
          onRemove={onRemove}
        />
      </div>
      <div className={styles.pair}>
        <Field label={label(c.terminal)}>
          <select
            className={styles.input}
            aria-label={label(c.terminal)}
            value={cmd.terminal}
            onChange={(e) => onChange({ terminal: Number(e.target.value) })}
          >
            {[1, 2, 3].map((t) => (
              <option key={t} value={t}>
                T{t}
              </option>
            ))}
          </select>
        </Field>
        <Field label={label(c.command)}>
          <input
            className={`${styles.input} ${styles.mono}`}
            aria-label={label(c.command)}
            value={cmd.command}
            onChange={(e) => onChange({ command: e.target.value })}
            aria-invalid={Boolean(errors[cmd.id])}
            placeholder="apt update"
          />
        </Field>
      </div>
      <Field label={label(c.explanation)}>
        <input
          className={styles.input}
          aria-label={label(c.explanation)}
          value={cmd.explanation}
          onChange={(e) => onChange({ explanation: e.target.value })}
        />
      </Field>
      <Field label={label(c.output)}>
        <textarea
          className={styles.input}
          rows={2}
          aria-label={label(c.output)}
          value={cmd.outputExplanation}
          onChange={(e) => onChange({ outputExplanation: e.target.value })}
        />
      </Field>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={cmd.expectError}
          onChange={(e) => onChange({ expectError: e.target.checked })}
        />
        <span>{c.expectError}</span>
      </label>
      <details className={styles.advanced}>
        <summary>{label(c.advanced)}</summary>
        <div className={styles.pair}>
          <Field label={label(c.user)}>
            <input
              className={styles.input}
              aria-label={label(c.user)}
              value={cmd.login?.user ?? ""}
              onChange={(e) =>
                onChange({
                  login: {
                    user: e.target.value,
                    password: cmd.login?.password ?? "",
                  },
                })
              }
            />
          </Field>
          <Field label={label(c.password)}>
            <input
              className={styles.input}
              aria-label={label(c.password)}
              value={cmd.login?.password ?? ""}
              onChange={(e) =>
                onChange({
                  login: {
                    user: cmd.login?.user ?? "",
                    password: e.target.value,
                  },
                })
              }
            />
          </Field>
        </div>
        <Field label={label(c.answers)}>
          <textarea
            className={styles.input}
            rows={2}
            aria-label={label(c.answers)}
            value={cmd.answers.join(NEWLINE)}
            onChange={(e) =>
              onChange({
                answers:
                  e.target.value === "" ? [] : e.target.value.split(NEWLINE),
              })
            }
          />
        </Field>
      </details>
      <Errors id={cmd.id} errors={errors} />
    </div>
  );
}

type BoxLabels = (typeof m.boxes)["tips"];

function BoxList({
  boxes,
  labels,
  errors,
  onChange,
}: {
  boxes: CardBox[];
  labels: BoxLabels;
  errors: CardErrors;
  onChange: (next: CardBox[]) => void;
}) {
  const patch = (i: number, change: Partial<CardBox>) =>
    onChange(boxes.map((b, j) => (j === i ? { ...b, ...change } : b)));
  return (
    <div className={styles.group}>
      <div className={styles.groupHead}>
        <h3 className={styles.groupTitle}>{labels.title}</h3>
      </div>
      {boxes.length === 0 && <p className={styles.hint}>{labels.empty}</p>}
      {boxes.map((box, i) => {
        const name = `${labels.name} (${labels.item(i + 1)})`;
        const text = `${m.boxes.text} (${labels.item(i + 1)})`;
        return (
          <div key={box.id} className={styles.item}>
            <div className={styles.itemHead}>
              <span className={styles.itemTitle}>{labels.item(i + 1)}</span>
              <Tools
                index={i}
                total={boxes.length}
                labels={{
                  up: "Subir",
                  down: "Descer",
                  remove: `${m.boxes.remove} ${labels.item(i + 1)} #`,
                }}
                onMove={(to) => onChange(move(boxes, i, to))}
                onRemove={() => onChange(boxes.filter((_, j) => j !== i))}
              />
            </div>
            <Field label={name}>
              <input
                className={styles.input}
                aria-label={name}
                value={box.title}
                placeholder={labels.placeholder}
                onChange={(e) => patch(i, { title: e.target.value })}
              />
            </Field>
            <div className={styles.field}>
              <span className={styles.label}>{text}</span>
              <RichTextEditor
                label={text}
                value={box.html}
                onChange={(html) => patch(i, { html })}
                invalid={Boolean(errors[box.id])}
              />
            </div>
            <Errors id={box.id} errors={errors} />
          </div>
        );
      })}
      <button
        type="button"
        className={styles.add}
        onClick={() =>
          onChange([...boxes, { id: newId(), title: "", html: "" }])
        }
      >
        {labels.add}
      </button>
    </div>
  );
}

/**
 * The screen to create or edit one card, in the style of the client's card generator: the form on
 * the left and the live preview on the right (SPEC-019 section 3.1).
 */
export function CardBuilder({
  moduleId,
  group,
  afterId,
  service = contentAuthoringService,
  before = [],
  practice = practiceService,
  initialTab = "description",
  onCreated,
  onCancel,
}: CardBuilderProps) {
  const [stored, setStored] = useState<CardGroup | undefined>(group);
  const [card, setCard] = useState<CardModel>(() => parseCardOrEmpty(group));
  const [baseline, setBaseline] = useState(() =>
    JSON.stringify(parseCardOrEmpty(group), withoutIds),
  );
  const [errors, setErrors] = useState<CardErrors>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  // Each click on "Testar comandos" starts a new test (a new key), on a machine made from zero.
  const [testRun, setTestRun] = useState(0);
  const testPanel = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<CardTab>(initialTab);

  const dirty = JSON.stringify(card, withoutIds) !== baseline;

  // Leaving the page with an unsaved card loses the work.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = m.unsavedLeave;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (patch: Partial<CardModel>) => {
    setCard((prev) => ({ ...prev, ...patch }));
    setDone(false);
  };

  const requireTitle = !(stored && !stored.header);

  // The ids behind each tab, to mark the tab that has an error and to open the first one when saving fails.
  const idsOf = (name: CardTab, from: CardErrors): string[] => {
    switch (name) {
      case "description":
        return card.elements.map((e) => e.id);
      case "commands":
        return [
          ...card.commands.map((c) => c.id),
          "setup",
          ...Object.keys(from).filter((k) => k.startsWith("setup-")),
        ];
      case "tips":
        return [...card.tips, ...card.realWorld, ...card.exams].map(
          (b) => b.id,
        );
      default:
        return [
          ...(card.exercises?.items ?? []).map((ex) => ex.id),
          "exercises-setup",
          "exercises",
        ];
    }
  };
  const tabWithError = (from: CardErrors) =>
    TABS.find((name) => idsOf(name, from).some((id) => from[id]));
  const tabHasError = (name: CardTab) =>
    idsOf(name, errors).some((id) => errors[id]);
  /** Opens the first tab with an error and says which one it is. */
  const showErrors = (from: CardErrors) => {
    const name = tabWithError(from);
    if (name) setTab(name);
    return name && !from.title ? m.fixErrorsIn(m.tabs[name]) : m.fixErrors;
  };

  const save = async (force = false) => {
    setGeneral(null);
    setConflict(false);
    const found = checkCard(card, requireTitle);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setGeneral(showErrors(found));
      return;
    }

    const built = buildBlocks(card);
    setSaving(true);
    try {
      const blocks = await service.saveCard(moduleId, {
        replaceIds: stored?.blocks.map((b) => b.id) ?? [],
        afterBlockId: stored ? undefined : afterId,
        force,
        blocks: built.blocks,
      });
      setErrors({});
      setDone(true);
      if (blocks.length === 0) {
        onCancel();
        return;
      }
      const next = toGroup(blocks);
      const model = parseCard(next);
      setStored(next);
      setCard(model);
      setBaseline(JSON.stringify(model, withoutIds));
      if (!stored) onCreated?.(blocks);
    } catch (error: unknown) {
      if (error instanceof ApiProblemError && error.type === "block-conflict") {
        setConflict(true);
      } else if (
        error instanceof ApiProblemError &&
        error.invalidParams.length > 0
      ) {
        const placed = placeServerErrors(built, error.invalidParams);
        setErrors(placed.errors);
        setGeneral(
          placed.rest.length > 0
            ? placed.rest.join("; ")
            : showErrors(placed.errors),
        );
      } else {
        setGeneral(
          error instanceof ApiProblemError && error.detail
            ? error.detail
            : m.genericError,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  const preview = useMemo(() => {
    const bad = checkCard(card, false);
    const shown: CardModel = {
      ...card,
      elements: card.elements.filter(
        (e) =>
          !(["image", "video", "link"].includes(e.kind) && bad[e.id]) &&
          !(e.kind === "html" && !looksSafe(e.html)),
      ),
    };
    const blocks = buildBlocks(shown).blocks.map((b, i) => ({
      id: `preview-${i}`,
      type: b.type,
      position: i + 1,
      payload: b.payload,
    }));
    // The title and the tag are shown in the card header, not inside the first block.
    if (card.title.trim() && blocks[0])
      blocks[0] = {
        ...blocks[0],
        payload: { ...blocks[0].payload, title: "" },
      };
    return blocks;
  }, [card]);

  const loadBase = async () => practice.topicScenario(moduleId);
  // The test runs the module, the earlier cards and then this card's own snapshot, as the student will get them.
  // The snapshots in the order the machine is prepared: the module, the cards above, this card, and then the base of its exercises.
  const cardBefore: SetupLayer[] = hasSetup(card.setup)
    ? [
        ...before,
        {
          id: card.headerId ?? "new",
          kind: "card",
          label: card.title.trim(),
          setup: card.setup,
        },
      ]
    : before;
  const testLayers: SetupLayer[] = hasSetup(card.exercises?.setup)
    ? [
        ...cardBefore,
        {
          id: card.exercises?.blockId ?? "exercises",
          kind: "card",
          label: m.exercises.groupLayer,
          setup: card.exercises.setup,
        },
      ]
    : cardBefore;
  // What the test runs after the layers: the commands of the card, then the solution of each exercise and how it ends.
  const { items: testCommands, exerciseSections } = cardTestItems(card);
  const testSections: Record<number, string> = { ...exerciseSections };
  if (card.commands.length > 0) testSections[0] = m.tester.commandsOfTheCard;
  const startTest = () => {
    setTestRun((n) => n + 1);
    window.setTimeout(
      () =>
        testPanel.current?.scrollIntoView?.({
          block: "nearest",
          behavior: "smooth",
        }),
      0,
    );
  };
  const patchAt = <T,>(list: T[], i: number, change: Partial<T>) =>
    list.map((item, j) => (j === i ? { ...item, ...change } : item));
  const d = m.description;

  return (
    <div className={styles.builder}>
      <div className={styles.columns}>
        <div className={styles.form}>
          <Section
            title={m.header.title}
            hint={m.header.hint}
            info={authoringMessages.info.cardHeader}
          >
            <div className={styles.pair}>
              <Field label={m.header.pill} htmlFor="card-pill">
                <input
                  id="card-pill"
                  className={`${styles.input} ${styles.mono}`}
                  value={card.pill}
                  placeholder={m.header.pillPlaceholder}
                  onChange={(e) => set({ pill: e.target.value })}
                />
              </Field>
              <Field label={m.header.cardTitle} htmlFor="card-title">
                <input
                  id="card-title"
                  className={styles.input}
                  value={card.title}
                  placeholder={m.header.cardTitlePlaceholder}
                  onChange={(e) => set({ title: e.target.value })}
                  aria-invalid={Boolean(errors.title)}
                />
              </Field>
            </div>
            <Errors id="title" errors={errors} />
          </Section>

          <div
            role="tablist"
            aria-label={m.tabs.label}
            className={styles.tabs}
            style={
              {
                "--tab-index": TABS.indexOf(tab),
                "--tab-count": TABS.length,
              } as React.CSSProperties
            }
          >
            {TABS.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`card-tab-${name}`}
                aria-selected={tab === name}
                aria-controls={`card-panel-${name}`}
                className={styles.tab}
                onClick={() => setTab(name)}
              >
                <span aria-hidden="true">{TAB_ICONS[name]}</span> {m.tabs[name]}
                {tabHasError(name) && (
                  <span
                    className={styles.tabMark}
                    role="img"
                    aria-label={m.tabs.withError}
                  >
                    !
                  </span>
                )}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            id="card-panel-description"
            aria-labelledby="card-tab-description"
            hidden={tab !== "description"}
            className={styles.tabPanel}
          >
            <Section
              title={d.title}
              hint={d.hint}
              info={authoringMessages.info.description}
            >
              {card.elements.length === 0 && (
                <p className={styles.hint}>{d.empty}</p>
              )}
              {card.elements.map((el, i) => (
                <ElementRow
                  key={el.id}
                  el={el}
                  index={i}
                  total={card.elements.length}
                  errors={errors}
                  onChange={(patch) =>
                    set({ elements: patchAt(card.elements, i, patch) })
                  }
                  onMove={(to) => set({ elements: move(card.elements, i, to) })}
                  onRemove={() =>
                    set({ elements: card.elements.filter((_, j) => j !== i) })
                  }
                />
              ))}
              <div className={styles.insert}>
                <span className={styles.insertLabel}>
                  <span aria-hidden="true">➕</span> {d.insert}
                </span>
                {INSERTABLE.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={styles.add}
                    onClick={() =>
                      set({ elements: [...card.elements, newElement(kind)] })
                    }
                  >
                    <span aria-hidden="true">{KIND_ICONS[kind]}</span>{" "}
                    {d.kinds[kind]}
                  </button>
                ))}
              </div>
            </Section>
          </div>

          <div
            role="tabpanel"
            id="card-panel-commands"
            aria-labelledby="card-tab-commands"
            hidden={tab !== "commands"}
            className={styles.tabPanel}
          >
            <Section
              title={m.setup.title}
              hint={m.setup.hint}
              info={authoringMessages.info.cardSetup}
            >
              <SetupEditor
                setup={card.setup}
                before={before}
                loadBase={loadBase}
                errors={errors}
                onChange={(setup) => set({ setup })}
              />
              {hasSetup(card.setup) && card.title.trim() === "" && (
                <p className={styles.hint}>{m.setup.needsTitleError}</p>
              )}
              <Errors id="setup" errors={errors} />
            </Section>

            <Section
              title={m.commands.title}
              hint={m.commands.hint}
              info={authoringMessages.info.commands}
              action={
                <div className={styles.rowButtons}>
                  <button
                    type="button"
                    className={styles.add}
                    onClick={() =>
                      set({
                        commands: [
                          ...card.commands,
                          {
                            id: newId(),
                            terminal: 1,
                            expectError: false,
                            command: "",
                            explanation: "",
                            outputExplanation: "",
                            answers: [],
                          },
                        ],
                      })
                    }
                  >
                    {m.commands.add}
                  </button>
                </div>
              }
            >
              {card.commands.length === 0 && (
                <p className={styles.hint}>{m.commands.empty}</p>
              )}
              {card.commands.map((cmd, i) => (
                <CommandRow
                  key={cmd.id}
                  cmd={cmd}
                  index={i}
                  total={card.commands.length}
                  errors={errors}
                  onChange={(patch) =>
                    set({ commands: patchAt(card.commands, i, patch) })
                  }
                  onMove={(to) => set({ commands: move(card.commands, i, to) })}
                  onRemove={() =>
                    set({ commands: card.commands.filter((_, j) => j !== i) })
                  }
                />
              ))}
            </Section>
          </div>

          <div
            role="tabpanel"
            id="card-panel-tips"
            aria-labelledby="card-tab-tips"
            hidden={tab !== "tips"}
            className={styles.tabPanel}
          >
            <Section
              title={m.boxes.title}
              hint={m.boxes.hint}
              info={authoringMessages.info.boxes}
            >
              <BoxList
                boxes={card.tips}
                labels={m.boxes.tips}
                errors={errors}
                onChange={(tips) => set({ tips })}
              />
              <BoxList
                boxes={card.realWorld}
                labels={m.boxes.real}
                errors={errors}
                onChange={(realWorld) => set({ realWorld })}
              />
              <BoxList
                boxes={card.exams}
                labels={m.boxes.exams}
                errors={errors}
                onChange={(exams) => set({ exams })}
              />
            </Section>
          </div>

          <div
            role="tabpanel"
            id="card-panel-exercises"
            aria-labelledby="card-tab-exercises"
            hidden={tab !== "exercises"}
            className={styles.tabPanel}
          >
            <ExercisesTab
              moduleId={moduleId}
              cardKey={stored?.key}
              group={card.exercises}
              onChange={(exercises) => set({ exercises })}
              before={cardBefore}
              loadBase={loadBase}
              errors={errors}
              dirty={dirty}
            />
          </div>
        </div>

        <aside className={styles.preview} aria-label={m.previewTitle}>
          <h2 className={styles.previewTitle}>{m.previewTitle}</h2>
          <article className={styles.previewCard}>
            {(card.pill.trim() || card.title.trim()) && (
              <header className={styles.previewHeader}>
                {card.pill.trim() && (
                  <code className={styles.pill}>{card.pill.trim()}</code>
                )}
                {card.title.trim() && (
                  <h3 className={styles.previewHeading}>{card.title.trim()}</h3>
                )}
              </header>
            )}
            {preview.length > 0 ? (
              <ContentRenderer blocks={preview} />
            ) : (
              <p className={styles.hint}>{m.previewEmpty}</p>
            )}
          </article>
        </aside>
      </div>

      {testRun > 0 && (
        <div ref={testPanel}>
          <CardTester
            key={testRun}
            commands={testCommands}
            sections={testSections}
            loadBase={loadBase}
            layers={testLayers}
            onClose={() => setTestRun(0)}
            onFinish={(passed) =>
              stored && saveTest(moduleId, stored.key, passed, card)
            }
          />
        </div>
      )}

      <div className={styles.actions}>
        {general && (
          <p className={styles.error} role="alert">
            {general}
          </p>
        )}
        {conflict && (
          <div className={styles.conflict} role="alert">
            <p>{m.conflict}</p>
            <button
              type="button"
              className={styles.danger}
              onClick={() => void save(true)}
            >
              {m.conflictForce}
            </button>
          </div>
        )}
        {dirty && <span className={styles.unsaved}>{m.unsaved}</span>}
        {done && !dirty && (
          <span className={styles.saved} role="status">
            {m.savedNote}
          </span>
        )}
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {m.cancel}
        </button>
        <button
          type="button"
          className={styles.secondary}
          title={m.tester.openTitle}
          onClick={startTest}
          disabled={testCommands.length === 0 && testLayers.length === 0}
        >
          {m.tester.open}
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() => void save()}
          disabled={saving || (Boolean(stored) && !dirty)}
        >
          {saving ? m.saving : m.save}
        </button>
      </div>
    </div>
  );
}

function parseCardOrEmpty(group?: CardGroup): CardModel {
  return group
    ? parseCard(group)
    : {
        pill: "",
        title: "",
        elements: [],
        commands: [],
        tips: [],
        realWorld: [],
        exams: [],
      };
}

/** The ids are made on the fly, so they are left out when comparing a card with what was stored. */
function withoutIds(key: string, value: unknown) {
  return key === "id" ? undefined : value;
}

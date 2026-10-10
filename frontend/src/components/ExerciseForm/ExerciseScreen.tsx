"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { CardTester } from "@/components/CardBuilder/CardTester";
import cardStyles from "@/components/CardBuilder/CardBuilder.module.scss";
import { ExercisesBlock } from "@/components/ContentRenderer/ExercisesBlock";
import { buildBlocks, checkCard, groupCards, parseCard, placeServerErrors, type CardErrors, type CardGroup, type CardModel } from "@/lib/cardModel";
import { emptyExercise, exercisesPayload, exerciseTestItems, type Exercise } from "@/lib/exercises";
import { allLayers, hasSetup, type Setup, type SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import { contentAuthoringService, type ContentAuthoringService } from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import { practiceService, type PracticeService } from "@/services/practiceService";
import { ExerciseForm } from "./ExerciseForm";
import styles from "@/components/CardBuilder/CardScreen.module.scss";

const m = authoringMessages.exercisePage;

interface ExerciseScreenProps {
  moduleId: string;
  /** The key of the card the exercise belongs to (the id of its first block). */
  cardKey: string;
  /** The position of the exercise in the group, or "new" for one that does not exist yet. */
  index: string;
  service?: ContentAuthoringService;
  practice?: Pick<PracticeService, "topicScenario">;
}

type State =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; group: CardGroup; card: CardModel; exercise: Exercise; position: number; cardLayers: SetupLayer[] };

/**
 * The page of one exercise of a card (SPEC-022): the form, a preview as the student sees it, a test of this exercise and
 * Save. It loads the card, changes only this exercise inside its group and saves the card the way the card screen does.
 */
export function ExerciseScreen({ moduleId, cardKey, index, service = contentAuthoringService, practice = practiceService }: ExerciseScreenProps) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [baseline, setBaseline] = useState("");
  const [errors, setErrors] = useState<CardErrors>({});
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testRun, setTestRun] = useState(0);
  const testPanel = useRef<HTMLDivElement>(null);
  const back = `/app/modules/${moduleId}/cards/${cardKey}?tab=exercises`;
  const isNew = index === "new";

  useEffect(() => {
    let active = true;
    service
      .content(moduleId)
      .then(({ blocks, setup }) => {
        if (!active) return;
        const groups = groupCards(blocks);
        const at = groups.findIndex((g) => g.key === cardKey);
        if (at < 0) return setState({ status: "missing" });
        const group = groups[at]!;
        const card = parseCard(group);
        const items = card.exercises?.items ?? [];
        const position = isNew ? items.length : Number(index);
        const found = isNew ? emptyExercise() : items[position];
        if (!found) return setState({ status: "missing" });
        // The snapshots before this card: the module, the cards above, and the card's own.
        const above = allLayers(setup as Setup | undefined, groups.slice(0, at).flatMap((g) => g.blocks));
        const own: SetupLayer[] = hasSetup(card.setup) ? [{ id: group.key, kind: "card", label: card.title.trim() || "Introdução", setup: card.setup }] : [];
        setState({ status: "ready", group, card, exercise: found, position, cardLayers: [...above, ...own] });
        setExercise(found);
        setBaseline(JSON.stringify(found, withoutIds));
      })
      .catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, [service, moduleId, cardKey, index, isNew]);

  const loadBase = useMemo(() => () => practice.topicScenario(moduleId), [practice, moduleId]);
  const dirty = exercise !== null && JSON.stringify(exercise, withoutIds) !== baseline;

  // Leaving the page with an unsaved exercise loses the work.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = m.unsavedLeave;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (state.status === "loading" || !exercise) {
    return (
      <main className={styles.screen}>
        {state.status === "missing" ? (
          <p className={styles.missing} role="alert">
            {m.notFound}
          </p>
        ) : (
          <p className={styles.note}>{m.loading}</p>
        )}
        <Link href={back} className={styles.back}>
          {m.back}
        </Link>
      </main>
    );
  }
  if (state.status === "missing") return null;

  const { card, group, position, cardLayers } = state;
  const items = card.exercises?.items ?? [];

  // The machine the solution starts from: the layers, the base of the group and the solutions of the exercises before this one.
  const groupLayer: SetupLayer[] = hasSetup(card.exercises?.setup) ? [{ id: "group", kind: "card", label: m.groupLayer, setup: card.exercises.setup }] : [];
  const earlier: SetupLayer[] = items.slice(0, position).flatMap((ex, i) => (hasSetup(ex.solution) ? [{ id: `solution-${i}`, kind: "card" as const, label: m.earlierSolution(ex.title.trim() || String(i + 1)), setup: ex.solution }] : []));
  const before = [...cardLayers, ...groupLayer, ...earlier];

  const save = async (force = false) => {
    setMessage(null);
    setConflict(false);
    const nextItems = isNew ? [...items, exercise] : items.map((item, i) => (i === position ? exercise : item));
    const next: CardModel = { ...card, exercises: { ...(card.exercises ?? {}), items: nextItems } };
    const found = checkCard(next, Boolean(group.header));
    // Only what is about this exercise or the group matters on this page.
    const mine: CardErrors = {};
    for (const [key, list] of Object.entries(found)) if (key === exercise.id || key === "exercises-setup") mine[key] = list;
    setErrors(mine);
    if (Object.keys(mine).length > 0) return setMessage({ kind: "error", text: m.fixErrors });
    if (Object.keys(found).length > 0) return setMessage({ kind: "error", text: m.fixCard });

    const built = buildBlocks(next);
    setSaving(true);
    try {
      await service.saveCard(moduleId, { replaceIds: group.blocks.map((b) => b.id), force, blocks: built.blocks });
      setErrors({});
      setBaseline(JSON.stringify(exercise, withoutIds));
      setMessage({ kind: "ok", text: m.saved });
      if (isNew) router.replace(`/app/modules/${moduleId}/cards/${cardKey}/exercises/${position}`);
    } catch (error: unknown) {
      if (error instanceof ApiProblemError && error.type === "block-conflict") {
        setConflict(true);
      } else if (error instanceof ApiProblemError && error.invalidParams.length > 0) {
        const placed = placeServerErrors(built, error.invalidParams);
        setErrors(placed.errors);
        setMessage({ kind: "error", text: placed.rest.length > 0 ? placed.rest.join("; ") : m.fixErrors });
      } else {
        setMessage({ kind: "error", text: error instanceof ApiProblemError && error.detail ? error.detail : m.genericError });
      }
    } finally {
      setSaving(false);
    }
  };

  const tested = exerciseTestItems({ items: [exercise] });
  const startTest = () => {
    setTestRun((n) => n + 1);
    window.setTimeout(() => testPanel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }), 0);
  };

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Link href={back} className={styles.back}>
          {m.back}
        </Link>
        <h1 className={styles.title}>{isNew ? m.newTitle : m.editTitle}</h1>
        <p className={styles.subtitle}>{m.subtitle(card.title.trim() || m.intro)}</p>
      </header>

      <div className={cardStyles.columns}>
        <ExerciseForm exercise={exercise} onChange={(change) => setExercise((prev) => (prev ? { ...prev, ...change } : prev))} before={before} loadBase={loadBase} errors={errors} />

        <aside className={cardStyles.preview} aria-label={m.previewTitle}>
          <h2 className={cardStyles.previewTitle}>{m.previewTitle}</h2>
          <article className={cardStyles.previewCard}>
            <ExercisesBlock payload={exercisesPayload({ items: [exercise] })} />
          </article>
        </aside>
      </div>

      {testRun > 0 && (
        <div ref={testPanel}>
          <CardTester key={testRun} commands={tested.items} sections={tested.sections} loadBase={loadBase} layers={before} onClose={() => setTestRun(0)} />
        </div>
      )}

      <div className={cardStyles.actions}>
        {message && (
          <p className={message.kind === "ok" ? cardStyles.saved : cardStyles.error} role={message.kind === "ok" ? "status" : "alert"}>
            {message.text}
          </p>
        )}
        {conflict && (
          <div className={cardStyles.conflict} role="alert">
            <p>{m.conflict}</p>
            <button type="button" className={cardStyles.danger} onClick={() => void save(true)}>
              {m.conflictForce}
            </button>
          </div>
        )}
        {dirty && <span className={cardStyles.unsaved}>{m.unsaved}</span>}
        <button type="button" className={cardStyles.secondary} onClick={() => router.push(back)}>
          {m.cancel}
        </button>
        <button type="button" className={cardStyles.secondary} title={m.testTitle} onClick={startTest} disabled={tested.items.length === 0}>
          {m.test}
        </button>
        <button type="button" className={cardStyles.primary} onClick={() => void save()} disabled={saving || (!isNew && !dirty)}>
          {saving ? m.saving : m.save}
        </button>
      </div>
    </main>
  );
}

/** The ids are made on the fly, so they are left out when comparing an exercise with what was stored. */
function withoutIds(key: string, value: unknown) {
  return key === "id" ? undefined : value;
}

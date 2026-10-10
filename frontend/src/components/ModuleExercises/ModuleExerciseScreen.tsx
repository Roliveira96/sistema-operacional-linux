"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import cardStyles from "@/components/CardBuilder/CardBuilder.module.scss";
import { CardTester } from "@/components/CardBuilder/CardTester";
import styles from "@/components/CardBuilder/CardScreen.module.scss";
import { ExercisesBlock } from "@/components/ContentRenderer/ExercisesBlock";
import { ExerciseForm } from "@/components/ExerciseForm/ExerciseForm";
import { InfoTip } from "@/components/InfoTip/InfoTip";
import {
  emptyExercise,
  exercisesPayload,
  exerciseTestItems,
  type Exercise,
} from "@/lib/exercises";
import { ancestors, chainLayers, type ChainLink } from "@/lib/exerciseChain";
import { hasSetup, type Setup, type SetupLayer } from "@/lib/setup";
import { authoringMessages } from "@/messages/authoring.pt-BR";
import {
  contentAuthoringService,
  type ContentAuthoringService,
} from "@/services/contentAuthoringService";
import { ApiProblemError } from "@/services/httpClient";
import {
  moduleExerciseService,
  type ModuleExercise,
  type ModuleExerciseService,
} from "@/services/moduleExerciseService";
import {
  practiceService,
  type PracticeService,
} from "@/services/practiceService";

const m = authoringMessages.moduleExercisePage;

interface ModuleExerciseScreenProps {
  moduleId: string;
  /** The id of the exercise, or "new" for one that does not exist yet. */
  exerciseId: string;
  service?: ModuleExerciseService;
  content?: Pick<ContentAuthoringService, "content">;
  practice?: Pick<PracticeService, "topicScenario">;
}

type State =
  | { status: "loading" }
  | { status: "missing" }
  | {
      status: "ready";
      stored?: ModuleExercise;
      /** Every exercise of the bank, to choose the one this depends on and to build the chain before it. */
      all: ModuleExercise[];
      layers: SetupLayer[];
    };

/** The ids are made on the fly, so they are left out when comparing an exercise with what was stored. */
const withoutIds = (key: string, value: unknown) =>
  key === "id" ? undefined : value;

/**
 * The page of one exercise of the module (SPEC-023): the same form as the exercise of a card, on the machine of the module
 * and of the set the exercise belongs to; a preview as the student sees it, a test of this exercise and Save.
 */
export function ModuleExerciseScreen({
  moduleId,
  exerciseId,
  service = moduleExerciseService,
  content = contentAuthoringService,
  practice = practiceService,
}: ModuleExerciseScreenProps) {
  const router = useRouter();
  const isNew = exerciseId === "new";
  const back = `/app/modules/${moduleId}/edit?tab=exercises`;
  const [state, setState] = useState<State>({ status: "loading" });
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [baseline, setBaseline] = useState("");
  /** The exercise whose solution is built before this one (SPEC-023 12.3). */
  const [dependsOn, setDependsOn] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testRun, setTestRun] = useState(0);
  const testPanel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      service.bank(moduleId),
      Promise.resolve(content.content(moduleId)),
    ])
      .then(([bank, c]) => {
        if (!active) return;
        const stored = isNew
          ? undefined
          : bank.items.find((it) => it.exercise.id === exerciseId);
        if (!isNew && !stored) return setState({ status: "missing" });
        const moduleLayer: SetupLayer[] = hasSetup(c?.setup)
          ? [
              {
                id: "module",
                kind: "module",
                label: "Módulo",
                setup: c!.setup as Setup,
              },
            ]
          : [];
        setState({
          status: "ready",
          stored,
          all: bank.items,
          layers: [
            ...moduleLayer,
            ...(hasSetup(bank.bankSetup)
              ? [{ id: "bank", kind: "card" as const, label: m.bankLayer, setup: bank.bankSetup }]
              : []),
          ],
        });
        const first = stored?.exercise ?? emptyExercise();
        setExercise(first);
        setDependsOn(stored?.dependsOn ?? null);
        setBaseline(JSON.stringify([first, stored?.dependsOn ?? null], withoutIds));
        setUpdatedAt(stored?.updatedAt ?? "");
      })
      .catch(() => active && setState({ status: "missing" }));
    return () => {
      active = false;
    };
  }, [service, content, moduleId, exerciseId, isNew]);

  const loadBase = useMemo(
    () => () => practice.topicScenario(moduleId),
    [practice, moduleId],
  );
  const dirty =
    exercise !== null &&
    JSON.stringify([exercise, dependsOn], withoutIds) !== baseline;

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

  if (state.status !== "ready" || !exercise) {
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

  // An exercise that depends on others starts from the recipe of the chain before it: the solutions recorded, the oldest first.
  const links: ChainLink[] = state.all.map((it) => ({
    id: it.exercise.id,
    title: it.exercise.title.trim() || m.untitled,
    dependsOn: it.exercise.id === exerciseId ? dependsOn : it.dependsOn,
    solution: it.exercise.solution,
  }));
  const before = [...state.layers, ...chainLayers(links, exerciseId, m.chainLayer)];
  // The ones that already depend on this one cannot be chosen: it would close a cycle.
  const choices = state.all.filter(
    (it) =>
      it.exercise.id !== exerciseId &&
      !ancestors(links, it.exercise.id).some((a) => a.id === exerciseId),
  );

  const save = async (force = false) => {
    setMessage(null);
    setConflict(false);
    setSaving(true);
    try {
      // Created from a block of the tab (?link=practice|assessment), it is already linked to it.
      const from = new URLSearchParams(window.location.search).get("link");
      const saved = isNew
        ? await service.create(
            moduleId,
            exercise,
            dependsOn,
            from === "practice" || from === "assessment" ? { [from]: true } : undefined,
          )
        : await service.update(moduleId, exerciseId, exercise, updatedAt, force, dependsOn);
      setErrors({});
      setUpdatedAt(saved.updatedAt);
      setBaseline(JSON.stringify([exercise, dependsOn], withoutIds));
      setMessage({ kind: "ok", text: m.saved });
      if (isNew)
        router.replace(
          `/app/modules/${moduleId}/exercises/${saved.exercise.id}`,
        );
    } catch (error: unknown) {
      if (error instanceof ApiProblemError && error.type === "block-conflict") {
        setConflict(true);
      } else if (
        error instanceof ApiProblemError &&
        error.invalidParams.length > 0
      ) {
        // The fields of the server: hints[0].text, conditions[1].path, title... shown under the exercise.
        setErrors({
          [exercise.id]: error.invalidParams.map(
            (p) => `${p.name}: ${p.reason}`,
          ),
        });
        setMessage({ kind: "error", text: m.fixErrors });
      } else {
        setMessage({
          kind: "error",
          text:
            error instanceof ApiProblemError && error.detail
              ? error.detail
              : m.genericError,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const tested = exerciseTestItems({ items: [exercise] });
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

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <Link href={back} className={styles.back}>
          {m.back}
        </Link>
        <h1 className={styles.title}>{isNew ? m.newTitle : m.editTitle}</h1>
        <p className={styles.subtitle}>{m.subtitle}</p>
      </header>

      {state.stored?.legacy && (
        <p className={cardStyles.callout} role="status">
          <span aria-hidden="true">⚠️</span> {m.legacy}
        </p>
      )}

      <div className={cardStyles.check}>
        <label htmlFor="depends-on">{m.dependsOn}</label>
        <select id="depends-on" value={dependsOn ?? ""} onChange={(e) => setDependsOn(e.target.value || null)}>
          <option value="">{m.dependsOnNone}</option>
          {choices.map((it) => (
            <option key={it.exercise.id} value={it.exercise.id}>
              {it.exercise.title.trim() || m.untitled}
            </option>
          ))}
        </select>
        <InfoTip topic={m.dependsOn}>{authoringMessages.info.exerciseChain}</InfoTip>
      </div>
      <p className={cardStyles.hint}>{m.dependsOnHelp}</p>

      <div className={cardStyles.columns}>
        <ExerciseForm
          exercise={exercise}
          onChange={(change) =>
            setExercise((prev) => (prev ? { ...prev, ...change } : prev))
          }
          before={before}
          loadBase={loadBase}
          errors={Object.fromEntries(
            Object.entries(errors).map(([k, v]) => [k, v]),
          )}
        />

        <aside className={cardStyles.preview} aria-label={m.previewTitle}>
          <h2 className={cardStyles.previewTitle}>{m.previewTitle}</h2>
          <article className={cardStyles.previewCard}>
            <ExercisesBlock payload={exercisesPayload({ items: [exercise] })} />
          </article>
        </aside>
      </div>

      {testRun > 0 && (
        <div ref={testPanel}>
          <CardTester
            key={testRun}
            commands={tested.items}
            sections={tested.sections}
            loadBase={loadBase}
            layers={before}
            onClose={() => setTestRun(0)}
          />
        </div>
      )}

      <div className={cardStyles.actions}>
        {message && (
          <p
            className={
              message.kind === "ok" ? cardStyles.saved : cardStyles.error
            }
            role={message.kind === "ok" ? "status" : "alert"}
          >
            {message.text}
          </p>
        )}
        {conflict && (
          <div className={cardStyles.conflict} role="alert">
            <p>{m.conflict}</p>
            <button
              type="button"
              className={cardStyles.danger}
              onClick={() => void save(true)}
            >
              {m.conflictForce}
            </button>
          </div>
        )}
        {dirty && <span className={cardStyles.unsaved}>{m.unsaved}</span>}
        <button
          type="button"
          className={cardStyles.secondary}
          onClick={() => router.push(back)}
        >
          {m.back2}
        </button>
        <button
          type="button"
          className={cardStyles.secondary}
          title={m.testTitle}
          onClick={startTest}
          disabled={tested.items.length === 0}
        >
          {m.test}
        </button>
        <button
          type="button"
          className={cardStyles.primary}
          onClick={() => void save()}
          disabled={saving || (!isNew && !dirty)}
        >
          {saving ? m.saving : m.save}
        </button>
      </div>
    </main>
  );
}

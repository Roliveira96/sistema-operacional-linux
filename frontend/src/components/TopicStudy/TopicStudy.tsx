"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useModuleCheck } from "@/hooks/useModuleCheck";
import { useIdentity, type IdentitySources } from "@/hooks/useIdentity";
import {
  useNarrator,
  type NarrationPart,
  type NarrationWarning,
} from "@/hooks/useNarrator";
import { useTopicPlayer } from "@/hooks/useTopicPlayer";
import {
  ExerciseCheckContext,
  type ExerciseChecker,
} from "@/components/ContentRenderer/exerciseContext";
import { checkConditions } from "@/lib/exerciseConditions";
import {
  allLayers,
  hasSetup,
  parseSetup,
  type Setup,
  type SetupLayer,
} from "@/lib/setup";
import { runLayers } from "@/lib/setupRunner";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { cheatSheetHtml } from "@/engine/terminalWindow";
import {
  clampSplit,
  clearMachine,
  loadMachine,
  loadSpeed,
  loadSplit,
  loadVoiceSpeed,
  machineKey,
  saveMachine,
  saveSpeed,
  saveSplit,
  saveVoiceSpeed,
  SPLIT,
} from "@/lib/machineStorage";
import { pickVariation, spokenCommand } from "@/lib/narration";
import { splitDescription, topicAccentVars } from "@/lib/moduleVisual";
import {
  buildTopicScript,
  type ScriptStep,
  type TimelineItem,
  type TopicScript,
} from "@/lib/topicScript";
import { contentMessages as m } from "@/messages/content.pt-BR";
import {
  contentService,
  type ContentBlock,
  type ContentService,
  type PublicQuestion,
} from "@/services/contentService";
import { ApiProblemError } from "@/services/httpClient";
import {
  moduleService,
  type CourseModuleDetails,
} from "@/services/moduleService";
import {
  practiceService,
  type PracticeService,
} from "@/services/practiceService";
import { speechService, type SpeechService } from "@/services/speechService";
import { answerFromCheck, answerFromProgress, type AnswerResponse, type GivenAnswer } from "@/lib/answers";
import { isDiscursive, isMatching, isSingleChoice, isTrueFalse } from "@/lib/questionKinds";
import { ChallengePanel } from "./ChallengePanel";
import { CheatSheetModal } from "./CheatSheetModal";
import { LessonPanel } from "./LessonPanel";
import { PlayerBar } from "./PlayerBar";
import { UserBadge } from "@/components/UserBadge/UserBadge";
import { TerminalPane } from "./TerminalPane";
import { LiveTopicScreen, type TopicLive } from "./LiveTopicScreen";
import styles from "./TopicStudy.module.scss";

const t = m.topic;
const TOAST_MS = 3200;

export type { TopicLive };

export interface TopicStudyProps {
  moduleId: string;
  backHref: string;
  content?: Pick<ContentService, "content" | "questions">;
  /** Shows the version being edited instead of the published one, for the authors (SPEC-021). */
  draft?: boolean;
  modules?: Pick<typeof moduleService, "getModuleById">;
  practice?: Pick<
    PracticeService,
    "scenario" | "topicScenario" | "checkModule" | "progress" | "answer" | "choose" | "link" | "write"
  >;
  /** Voice of the karaoke reader (SPEC-018). */
  speech?: Pick<SpeechService, "synthesize">;
  /** Where the signed-in user is read from (SPEC-016, CA-11). */
  identity?: IdentitySources;
  /** Asks the student to confirm a destructive action (the prototype uses window.confirm). */
  confirm?: (message: string) => boolean;
  /** The study screen as the screen of a live class: only the material and the terminal of the class (SPEC-055). Without it, nothing changes. */
  live?: TopicLive;
}

interface Loaded {
  module: CourseModuleDetails;
  script: TopicScript;
  challenges: PublicQuestion[];
  scenario: unknown;
  /** The snapshots of the module and of the cards, in the order they prepare the machine (SPEC-021). */
  layers: SetupLayer[];
  /** The layers an exercise made in the editor starts from: the module and the available exercises, not the cards. */
  exerciseLayers: SetupLayer[];
  /** The machine starts from the scenario, so the snapshots still have to run. */
  needsSetup: boolean;
  storageKey: string;
  initialSnapshot: unknown;
  initialCompleted: string[];
  /** The answers the student already gave to the questions without a terminal (SPEC-035 RN-08, SPEC-036 RN-06). */
  initialAnswers: [string, GivenAnswer][];
}

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string; login: boolean }
  | ({ kind: "loaded" } & Loaded);

function describe(error: unknown): { message: string; login: boolean } {
  if (error instanceof ApiProblemError) {
    if (error.status === 404) return { message: m.notFound, login: false };
    if (error.status === 401) return { message: m.needsLogin, login: true };
    if (error.status === 403) return { message: m.forbidden, login: false };
  }
  return { message: m.unexpected, login: false };
}

/** The topic study screen of the prototype: material on the left, terminal on the right (SPEC-016). */
export function TopicStudy({
  moduleId,
  backHref,
  content = contentService,
  draft = false,
  modules = moduleService,
  practice = practiceService,
  speech = speechService,
  identity,
  confirm = (message) => window.confirm(message),
  live,
}: TopicStudyProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    // The live class brings the module with it; there is nothing to load for the study alone.
    if (live) return;
    let active = true;
    (async () => {
      try {
        // The blocks endpoint applies the visibility rules and gives the clearest error.
        const {
          blocks,
          setup,
          bankSetup,
        }: { blocks: ContentBlock[]; setup?: Setup; bankSetup?: Setup } =
          await content.content(moduleId, draft);
        const [module, questions, scenario] = await Promise.all([
          modules.getModuleById(moduleId),
          content.questions(moduleId, "EXERCISE"),
          practice.topicScenario(moduleId),
        ]);
        // Progress needs a session; visitors simply see no completions.
        const progress = await practice.progress(moduleId).catch(() => []);
        if (!active) return;
        const layers = allLayers(setup, blocks);
        // A change in a snapshot drops the saved machine, as a change in the scenario does.
        const storageKey = machineKey(
          moduleId,
          layers.length > 0
            ? { scenario, layers: layers.map((l) => l.setup) }
            : scenario,
        );
        const saved = loadMachine(storageKey);
        setState({
          kind: "loaded",
          module,
          script: buildTopicScript(blocks),
          // The practical exercises and the true or false questions, in the order of the trail (SPEC-035 D-07).
          challenges: questions.filter((q) => q.kind === "PRACTICAL" || isTrueFalse(q.kind) || isSingleChoice(q.kind) || isMatching(q.kind) || isDiscursive(q.kind)),
          scenario,
          layers,
          // The machine of an exercise of the module: the snapshot of the module, then the one of the bank (SPEC-023 11.2).
          exerciseLayers: [
            ...layers.filter((l) => l.kind === "module"),
            ...(hasSetup(bankSetup)
              ? [
                  {
                    id: "bank",
                    kind: "card" as const,
                    label: "Banco de exercícios",
                    setup: bankSetup,
                  },
                ]
              : []),
          ],
          needsSetup: saved === null && layers.length > 0,
          storageKey,
          initialSnapshot: saved ?? scenario,
          initialCompleted: progress
            .filter((p) => p.completedAt)
            .map((p) => p.questionId),
          initialAnswers: progress.flatMap((p): [string, GivenAnswer][] => {
            const given = answerFromProgress(p);
            return given ? [[p.questionId, given]] : [];
          }),
        });
      } catch (error) {
        if (active) setState({ kind: "error", ...describe(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [moduleId, content, modules, practice, draft, live]);

  if (live) return <LiveTopicScreen live={live} />;

  if (state.kind === "loading") {
    return (
      <p className={styles.status} role="status">
        {m.loading}
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={styles.status}>
        <p role="alert">{state.message}</p>
        <div className={styles.statusActions}>
          {state.login && <Link href="/login">{m.goToLogin}</Link>}
          <Link href={backHref}>{m.backToMaterials}</Link>
        </div>
      </div>
    );
  }

  return (
    <TopicScreen
      {...state}
      moduleId={moduleId}
      backHref={backHref}
      practice={practice}
      speech={speech}
      identitySources={identity}
      confirm={confirm}
    />
  );
}

type ScreenProps = Loaded & {
  moduleId: string;
  backHref: string;
  practice: NonNullable<TopicStudyProps["practice"]>;
  speech: NonNullable<TopicStudyProps["speech"]>;
  identitySources?: IdentitySources;
  confirm: (message: string) => boolean;
};

function TopicScreen({
  module,
  script,
  challenges,
  scenario,
  layers,
  exerciseLayers,
  needsSetup,
  storageKey,
  initialSnapshot,
  initialCompleted,
  initialAnswers,
  moduleId,
  backHref,
  practice,
  speech,
  identitySources,
  confirm,
}: ScreenProps) {
  const win = useRef<TerminalWindow | null>(null);
  const typingSpeed = useRef(1);

  /** Runs the snapshots of the module and of the cards on the fresh machine, then keeps it (SPEC-021 RN-05). */
  const prepare = async () => {
    const machine = win.current;
    if (!machine || layers.length === 0) return;
    await runLayers(machine, layers, { restoreSpeed: typingSpeed.current });
    saveMachine(storageKey, machine.snapshot());
  };
  const study = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"lesson" | "challenges">(
    script.cards.length > 0 ? "lesson" : "challenges",
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const [cheatSheet, setCheatSheet] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const [voiceSpeed, setVoiceSpeedState] = useState(loadVoiceSpeed);
  const split = useRef<HTMLElement>(null);
  const [studyPercent, setStudyPercent] = useState(loadSplit);
  const [dragging, setDragging] = useState(false);
  const percentRef = useRef(studyPercent);
  const identity = useIdentity(identitySources);
  const narrator = useNarrator({
    service: speech,
    initialSpeed: voiceSpeed,
    onWarning: (warning: NarrationWarning) => notify(t.narration[warning]),
  });
  const { speak, stop: stopNarration, setSpeed: applyVoiceSpeed } = narrator;
  const lastNotice = useRef(-1);

  /** The element of the page a timeline item or a command is read from. */
  const itemTarget = useCallback((item: TimelineItem): Element | null => {
    const panel = study.current;
    if (!panel || item.kind === "step") return null;
    return panel.querySelector(
      item.kind === "title"
        ? `[data-card-title="${item.card}"]`
        : `[data-block="${item.blockId}"]`,
    );
  }, []);

  /**
   * What is said before a command runs (SPEC-018, P-03): the command in spoken
   * Portuguese, what it does, and the notice to watch the terminal.
   */
  const stepParts = useCallback((step: ScriptStep): NarrationPart[] => {
    const row = study.current?.querySelector(`[data-step="${step.index}"]`);
    const explanation = row?.querySelector('[data-narrate="explanation"]');
    const parts: NarrationPart[] = [
      {
        text: spokenCommand(step.command),
        highlight: row?.querySelector('[data-narrate="command"]') ?? undefined,
      },
    ];
    if (explanation) parts.push({ element: explanation });
    else if (step.explanation) parts.push({ text: step.explanation });
    if (step.expectError) parts.push({ text: t.narration.expectError });
    const phrases = t.narration.watchTerminal;
    lastNotice.current = pickVariation(phrases.length, lastNotice.current);
    parts.push({ text: phrases[lastNotice.current]! });
    return parts;
  }, []);

  const stepOutputParts = useCallback((step: ScriptStep): NarrationPart[] => {
    const row = study.current?.querySelector(`[data-step="${step.index}"]`);
    const outputExplanation = row?.querySelector(
      '[data-narrate="outputExplanation"]',
    );
    if (outputExplanation) return [{ element: outputExplanation }];
    if (step.outputExplanation) return [{ text: step.outputExplanation }];
    return [];
  }, []);

  const check = useModuleCheck(practice, moduleId, () =>
    notify(t.challenges.completedToast),
  );
  const { seed } = check;
  useEffect(() => seed(initialCompleted), [seed, initialCompleted]);

  const player = useTopicPlayer(
    script,
    {
      runStep: async (step, silent) => {
        // The voice goes first; the command runs only after it (CA-02), and not at all if it was cut (CA-16).
        if (!silent && !(await speak(stepParts(step)))) return false;
        await win.current?.run(step);
        const outputParts = stepOutputParts(step);
        if (!silent && outputParts.length > 0) {
          if (!(await speak(outputParts))) return false;
        }
        return true;
      },
      narrate: async (item) => {
        const target = itemTarget(item);
        if (target) await speak(target);
      },
      stopNarration,
      onStop: stopNarration,
      resetMachine: async () => {
        clearMachine(storageKey);
        win.current?.reset(scenario);
        await prepare();
      },
      setTerminalSpeed: (speed) => win.current?.setSpeed(speed),
      onCardStart: (card) => {
        setTab("lesson");
        window.setTimeout(
          () =>
            study.current
              ?.querySelector(`[data-card="${card}"]`)
              ?.scrollIntoView({ block: "start", behavior: "smooth" }),
          0,
        );
      },
      onBack: (target) =>
        notify(
          target < 0
            ? "⏮ Voltou ao início (máquina reiniciada)"
            : `⏮ Máquina refeita até o passo ${target + 1}`,
        ),
    },
    loadSpeed(),
  );

  const { speed, setSpeed } = player;
  useEffect(() => {
    typingSpeed.current = speed;
  }, [speed]);
  const changeSpeed = useCallback(
    (value: number) => {
      setSpeed(value);
      saveSpeed(value);
    },
    [setSpeed],
  );
  const changeVoiceSpeed = useCallback(
    (value: number) => {
      setVoiceSpeedState(value);
      applyVoiceSpeed(value);
      saveVoiceSpeed(value);
    },
    [applyVoiceSpeed],
  );
  const playerWithSavedSpeed = useMemo(
    () => ({ ...player, setSpeed: changeSpeed }),
    [player, changeSpeed],
  );

  const onReady = useCallback(
    (window: TerminalWindow) => {
      win.current = window;
      window.setSpeed(speed);
      if (needsSetup) void prepare();
    },
    // prepare only reads refs and props that never change in this screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [speed, needsSetup],
  );

  // Only the practical exercises are checked on the machine; a true or false question does not depend on it (SPEC-035 CA-14).
  const hasPractical = challenges.some((c) => c.kind === "PRACTICAL");
  const onCommand = useCallback(
    (snapshot: unknown) => {
      saveMachine(storageKey, snapshot);
      if (hasPractical) check.submit(snapshot);
    },
    [storageKey, hasPractical, check],
  );

  const [answers, setAnswers] = useState<ReadonlyMap<string, GivenAnswer>>(() => new Map(initialAnswers));
  const [answering, setAnswering] = useState<string | null>(null);
  const [answerErrors, setAnswerErrors] = useState<ReadonlyMap<string, string>>(new Map());
  const [answerNeedsLogin, setAnswerNeedsLogin] = useState(false);
  /** Sends the single answer to a question without a terminal and shows the result at once (SPEC-035 RN-06, D-02; SPEC-036 RN-05). */
  const answer = async (challenge: PublicQuestion, response: AnswerResponse) => {
    setAnswering(challenge.id);
    setAnswerErrors((prev) => {
      const next = new Map(prev);
      next.delete(challenge.id);
      return next;
    });
    const keep = (given: GivenAnswer | null) => {
      if (!given) return;
      setAnswers((prev) => new Map(prev).set(challenge.id, given));
      check.seed([challenge.id]);
    };
    try {
      const r =
        "value" in response
          ? await practice.answer(challenge.id, response.value)
          : "choice" in response
            ? await practice.choose(challenge.id, response.choice)
            : "links" in response
              ? await practice.link(challenge.id, response.links)
              : await practice.write(challenge.id, response.html);
      keep(answerFromCheck(response, r));
    } catch (error) {
      if (error instanceof ApiProblemError && error.status === 401) {
        setAnswerNeedsLogin(true);
      } else if (error instanceof ApiProblemError && error.status === 409) {
        // Already answered (in another tab, say): the answer the server kept is the one that counts.
        const stored = (await practice.progress(moduleId).catch(() => [])).find((p) => p.questionId === challenge.id);
        if (stored) keep(answerFromProgress(stored));
      } else {
        setAnswerErrors((prev) => new Map(prev).set(challenge.id, "html" in response ? m.descriptive.failed : m.trueFalse.failed));
      }
    } finally {
      setAnswering(null);
    }
  };

  // Keyboard shortcuts of the prototype, off while typing in the terminal or a field.
  const { next, back, toggleAll } = player;
  useEffect(() => {
    if (script.steps.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        target &&
        (target.closest(".term") ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void next();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void back();
      } else if (event.key === " ") {
        event.preventDefault();
        toggleAll();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [script.steps.length, next, back, toggleAll]);

  const resetMachine = async () => {
    if (!win.current || !confirm(t.actions.resetConfirm)) return;
    clearMachine(storageKey);
    player.rewind();
    await win.current.resetAnimated(scenario);
    await prepare();
    notify(t.actions.resetDone);
  };

  const importMachine = async () => {
    try {
      await win.current?.importJson();
      notify(t.actions.imported);
    } catch {
      notify(t.actions.importFailed);
    }
  };

  /** Moves the divider to a share of the width and keeps it for the next visit. */
  const moveDivider = useCallback((percent: number, save: boolean) => {
    const value = clampSplit(percent);
    percentRef.current = value;
    setStudyPercent(value);
    if (save) saveSplit(value);
  }, []);

  const dragTo = (clientX: number) => {
    const box = split.current?.getBoundingClientRect();
    if (box && box.width > 0)
      moveDivider(((clientX - box.left) / box.width) * 100, false);
  };

  const dividerKeys = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? SPLIT.step * 3 : SPLIT.step;
    const target: Record<string, number> = {
      ArrowLeft: studyPercent - step,
      ArrowRight: studyPercent + step,
      Home: SPLIT.min,
      End: SPLIT.max,
    };
    if (!(event.key in target)) return;
    event.preventDefault();
    moveDivider(target[event.key]!, true);
  };

  const openCheatSheet = async () => setCheatSheet(await cheatSheetHtml());

  const startChallenge = async (challenge: PublicQuestion) => {
    if (!win.current) return;
    setStarting(challenge.id);
    try {
      if (challenge.layered) {
        // An exercise made in the editor starts from the topic machine, with the layers of the module and of the exercises on it.
        await win.current.loadScenario(scenario);
        // An exercise that depends on others also gets the recipe of their solutions, the oldest first (SPEC-023 12.3).
        const chain: SetupLayer[] = (challenge.chainSetups ?? []).flatMap((raw, i) => {
          const setup = parseSetup(raw);
          return hasSetup(setup) ? [{ id: `chain-${i}`, kind: "card" as const, label: `Solução do exercício anterior ${i + 1}`, setup }] : [];
        });
        await runLayers(win.current, [...exerciseLayers, ...chain], {
          restoreSpeed: typingSpeed.current,
        });
      } else {
        await win.current.loadScenario(await practice.scenario(challenge.id));
      }
    } catch {
      notify(t.challenges.startFailed);
    } finally {
      setStarting(null);
    }
  };

  const runSolution = async (challenge: PublicQuestion) => {
    if (!win.current) return;
    setBusy(true);
    try {
      for (const step of challenge.solution ?? []) await win.current.run(step);
    } finally {
      setBusy(false);
    }
  };

  const subtitle = splitDescription(module.description).tags.join(" · ");
  const done = challenges.filter((c) => check.completed.has(c.id)).length;

  const [completedBlockIds, setCompletedBlockIds] = useState<Set<string>>(
    new Set(),
  );
  const [completedAtByBlock, setCompletedAtByBlock] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    let active = true;
    void contentService
      .getModuleBlockProgress(moduleId)
      .then((res) => {
        if (!active) return;
        setCompletedBlockIds(new Set(res.completedBlockIds || []));
        setCompletedAtByBlock(res.completedAtByBlock || {});
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [moduleId]);

  const handleToggleBlockProgress = useCallback(
    (blockId: string, completed: boolean) => {
      setCompletedBlockIds((prev) => {
        const next = new Set(prev);
        if (completed) next.add(blockId);
        else next.delete(blockId);
        return next;
      });
      setCompletedAtByBlock((prev) => {
        const next = { ...prev };
        if (completed) next[blockId] = new Date().toISOString();
        else delete next[blockId];
        return next;
      });
      void contentService
        .toggleBlockProgress(blockId, completed)
        .then((res) => {
          if (res.completed && res.completedAt) {
            setCompletedAtByBlock((prev) => ({
              ...prev,
              [blockId]: res.completedAt!,
            }));
          }
        })
        .catch(() => {});
    },
    [],
  );

  // The exercises of the cards check how they ended on the machine of this screen.
  const exerciseChecker: ExerciseChecker = {
    check: (conditions) =>
      win.current ? checkConditions(conditions, win.current.snapshot()) : null,
  };

  return (
    <ExerciseCheckContext.Provider value={exerciseChecker}>
      <div className={styles.screen} style={topicAccentVars(module.color)}>
        <header className={styles.header}>
          <Link href={backHref} className={styles.back}>
            {t.back}
          </Link>
          <div className={styles.title}>
            {module.icon && (
              <span className={styles.icon} aria-hidden="true">
                {module.icon}
              </span>
            )}
            <div>
              <h1 className={styles.name}>{module.title}</h1>
              {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
            </div>
          </div>
          <span className={styles.seal} title={t.sealLabel}>
            <Image
              src="/utfpr-logo.svg"
              alt="UTFPR"
              width={78}
              height={22}
              unoptimized
            />
            <span className={styles.campus}>{t.seal}</span>
          </span>
          {script.steps.length > 0 && (
            <PlayerBar
              script={script}
              player={playerWithSavedSpeed}
              voiceSpeed={voiceSpeed}
              onVoiceSpeed={changeVoiceSpeed}
            />
          )}
          <nav className={styles.actions}>
            <button
              type="button"
              className={styles.action}
              onClick={() => void openCheatSheet()}
            >
              {t.actions.cheatSheet}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => narrator.setEnabled(!narrator.enabled)}
              aria-pressed={narrator.enabled}
              title={t.narration.title}
            >
              {narrator.enabled ? t.narration.on : t.narration.off}
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.reset}`}
              onClick={() => void resetMachine()}
              title={t.actions.resetTitle}
            >
              {t.actions.reset}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => win.current?.exportJson(`maquina-${module.title}`)}
              title={t.actions.exportTitle}
              aria-label={t.actions.exportTitle}
            >
              {t.actions.export}
            </button>
            <button
              type="button"
              className={styles.action}
              onClick={() => void importMachine()}
              title={t.actions.importTitle}
              aria-label={t.actions.importTitle}
            >
              {t.actions.import}
            </button>
          </nav>
          {identity && <UserBadge identity={identity} />}
        </header>

        <main
          ref={split}
          className={`${styles.split} ${dragging ? styles.dragging : ""}`}
          style={
            {
              "--split-columns": `minmax(0, ${studyPercent}fr) 10px minmax(0, ${100 - studyPercent}fr)`,
            } as CSSProperties
          }
        >
          <section className={styles.study}>
            <nav
              className={styles.tabs}
              role="tablist"
              aria-label={t.tabs.label}
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "lesson"}
                className={`${styles.tab} ${tab === "lesson" ? styles.active : ""}`}
                onClick={() => setTab("lesson")}
              >
                {t.tabs.lesson}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "challenges"}
                className={`${styles.tab} ${tab === "challenges" ? styles.active : ""}`}
                onClick={() => setTab("challenges")}
              >
                {t.tabs.challenges}{" "}
                <span className={styles.counter}>
                  {done}/{challenges.length}
                </span>
              </button>
            </nav>
            <div ref={study} className={styles.panel} role="tabpanel">
              {narrator.needsLogin && (
                <p className={styles.invite} role="status">
                  {t.narration.invite}{" "}
                  <Link href="/login">{t.narration.login}</Link>
                </p>
              )}
              {tab === "lesson" ? (
                <LessonPanel
                  script={script}
                  player={playerWithSavedSpeed}
                  completedBlockIds={completedBlockIds}
                  completedAtByBlock={completedAtByBlock}
                  onToggleBlockProgress={handleToggleBlockProgress}
                />
              ) : (
                <ChallengePanel
                  challenges={challenges}
                  completed={check.completed}
                  needsLogin={check.needsLogin || answerNeedsLogin}
                  answers={answers}
                  answering={answering}
                  answerErrors={answerErrors}
                  onAnswer={(challenge, response) => void answer(challenge, response)}
                  starting={starting}
                  busy={busy}
                  onStart={(challenge) => void startChallenge(challenge)}
                  onRunSolution={(challenge) => void runSolution(challenge)}
                />
              )}
            </div>
          </section>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t.divider.label}
            aria-valuemin={SPLIT.min}
            aria-valuemax={SPLIT.max}
            aria-valuenow={Math.round(studyPercent)}
            aria-valuetext={t.divider.value(Math.round(studyPercent))}
            tabIndex={0}
            className={styles.divider}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              setDragging(true);
            }}
            onPointerMove={(event) => dragging && dragTo(event.clientX)}
            onPointerUp={() => {
              setDragging(false);
              saveSplit(percentRef.current);
            }}
            onPointerCancel={() => setDragging(false)}
            onClick={(event) =>
              event.detail >= 2 && moveDivider(SPLIT.initial, true)
            }
            onKeyDown={dividerKeys}
          />
          <TerminalPane
            snapshot={initialSnapshot}
            onReady={onReady}
            onCommand={onCommand}
          />
        </main>

        {toast && (
          <div className={styles.toast} role="status">
            {toast}
          </div>
        )}
        {cheatSheet !== null && (
          <CheatSheetModal
            html={cheatSheet}
            onClose={() => setCheatSheet(null)}
          />
        )}
      </div>
    </ExerciseCheckContext.Provider>
  );
}

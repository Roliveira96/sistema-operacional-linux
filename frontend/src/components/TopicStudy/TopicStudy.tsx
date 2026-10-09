"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useModuleCheck } from "@/hooks/useModuleCheck";
import { useNarrator, type NarrationPart, type NarrationWarning } from "@/hooks/useNarrator";
import { useTopicPlayer } from "@/hooks/useTopicPlayer";
import type { TerminalWindow } from "@/engine/terminalWindow";
import { cheatSheetHtml } from "@/engine/terminalWindow";
import { clearMachine, loadMachine, loadSpeed, machineKey, saveMachine, saveSpeed } from "@/lib/machineStorage";
import { pickVariation, spokenCommand } from "@/lib/narration";
import { splitDescription, topicAccentVars } from "@/lib/moduleVisual";
import { buildTopicScript, type ScriptStep, type TimelineItem, type TopicScript } from "@/lib/topicScript";
import { contentMessages as m } from "@/messages/content.pt-BR";
import { contentService, type ContentBlock, type ContentService, type PublicQuestion } from "@/services/contentService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService, type CourseModuleDetails } from "@/services/moduleService";
import { practiceService, type PracticeService } from "@/services/practiceService";
import { speechService, type SpeechService } from "@/services/speechService";
import { ChallengePanel } from "./ChallengePanel";
import { CheatSheetModal } from "./CheatSheetModal";
import { LessonPanel } from "./LessonPanel";
import { PlayerBar } from "./PlayerBar";
import { TerminalPane } from "./TerminalPane";
import styles from "./TopicStudy.module.scss";

const t = m.topic;
const TOAST_MS = 3200;

export interface TopicStudyProps {
  moduleId: string;
  backHref: string;
  content?: Pick<ContentService, "blocks" | "questions">;
  modules?: Pick<typeof moduleService, "getModuleById">;
  practice?: Pick<PracticeService, "scenario" | "topicScenario" | "checkModule" | "progress">;
  /** Voice of the karaoke reader (SPEC-018). */
  speech?: Pick<SpeechService, "synthesize">;
  /** Asks the student to confirm a destructive action (the prototype uses window.confirm). */
  confirm?: (message: string) => boolean;
}

interface Loaded {
  module: CourseModuleDetails;
  script: TopicScript;
  challenges: PublicQuestion[];
  scenario: unknown;
  storageKey: string;
  initialSnapshot: unknown;
  initialCompleted: string[];
}

type State = { kind: "loading" } | { kind: "error"; message: string; login: boolean } | ({ kind: "loaded" } & Loaded);

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
  modules = moduleService,
  practice = practiceService,
  speech = speechService,
  confirm = (message) => window.confirm(message),
}: TopicStudyProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // The blocks endpoint applies the visibility rules and gives the clearest error.
        const blocks: ContentBlock[] = await content.blocks(moduleId);
        const [module, questions, scenario] = await Promise.all([
          modules.getModuleById(moduleId),
          content.questions(moduleId, "EXERCISE"),
          practice.topicScenario(moduleId),
        ]);
        // Progress needs a session; visitors simply see no completions.
        const progress = await practice.progress(moduleId).catch(() => []);
        if (!active) return;
        const storageKey = machineKey(moduleId, scenario);
        setState({
          kind: "loaded",
          module,
          script: buildTopicScript(blocks),
          challenges: questions.filter((q) => q.kind === "PRACTICAL"),
          scenario,
          storageKey,
          initialSnapshot: loadMachine(storageKey) ?? scenario,
          initialCompleted: progress.filter((p) => p.completedAt).map((p) => p.questionId),
        });
      } catch (error) {
        if (active) setState({ kind: "error", ...describe(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [moduleId, content, modules, practice]);

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

  return <TopicScreen {...state} moduleId={moduleId} backHref={backHref} practice={practice} speech={speech} confirm={confirm} />;
}

type ScreenProps = Loaded & {
  moduleId: string;
  backHref: string;
  practice: NonNullable<TopicStudyProps["practice"]>;
  speech: NonNullable<TopicStudyProps["speech"]>;
  confirm: (message: string) => boolean;
};

function TopicScreen({ module, script, challenges, scenario, storageKey, initialSnapshot, initialCompleted, moduleId, backHref, practice, speech, confirm }: ScreenProps) {
  const win = useRef<TerminalWindow | null>(null);
  const study = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"lesson" | "challenges">(script.cards.length > 0 ? "lesson" : "challenges");
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

  const narrator = useNarrator({
    service: speech,
    initialSpeed: loadSpeed(),
    onWarning: (warning: NarrationWarning) => notify(t.narration[warning]),
  });
  const { speak, stop: stopNarration, setSpeed: setVoiceSpeed } = narrator;
  const lastNotice = useRef(-1);

  /** The element of the page a timeline item or a command is read from. */
  const itemTarget = useCallback((item: TimelineItem): Element | null => {
    const panel = study.current;
    if (!panel || item.kind === "step") return null;
    return panel.querySelector(item.kind === "title" ? `[data-card-title="${item.card}"]` : `[data-block="${item.blockId}"]`);
  }, []);

  /**
   * What is said before a command runs (SPEC-018, P-03): the command in spoken
   * Portuguese, what it does, and the notice to watch the terminal.
   */
  const stepParts = useCallback((step: ScriptStep): NarrationPart[] => {
    const row = study.current?.querySelector(`[data-step="${step.index}"]`);
    const explanation = row?.querySelector('[data-narrate="explanation"]');
    const parts: NarrationPart[] = [{ text: spokenCommand(step.command), highlight: row?.querySelector('[data-narrate="command"]') ?? undefined }];
    if (explanation) parts.push({ element: explanation });
    else if (step.explanation) parts.push({ text: step.explanation });
    const phrases = t.narration.watchTerminal;
    lastNotice.current = pickVariation(phrases.length, lastNotice.current);
    parts.push({ text: phrases[lastNotice.current]! });
    return parts;
  }, []);

  const check = useModuleCheck(practice, moduleId, () => notify(t.challenges.completedToast));
  const { seed } = check;
  useEffect(() => seed(initialCompleted), [seed, initialCompleted]);

  const player = useTopicPlayer(
    script,
    {
      runStep: async (step, silent) => {
        // The voice goes first; the command runs only after it (CA-02), and not at all if it was cut (CA-16).
        if (!silent && !(await speak(stepParts(step)))) return false;
        await win.current?.run(step);
        return true;
      },
      narrate: async (item) => {
        const target = itemTarget(item);
        if (target) await speak(target);
      },
      stopNarration,
      onStop: stopNarration,
      resetMachine: () => {
        clearMachine(storageKey);
        win.current?.reset(scenario);
      },
      setTerminalSpeed: (speed) => {
        win.current?.setSpeed(speed);
        setVoiceSpeed(speed);
      },
      onCardStart: (card) => {
        setTab("lesson");
        window.setTimeout(() => study.current?.querySelector(`[data-card="${card}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
      },
      onBack: (target) => notify(target < 0 ? "⏮ Voltou ao início (máquina reiniciada)" : `⏮ Máquina refeita até o passo ${target + 1}`),
    },
    loadSpeed(),
  );

  const { speed, setSpeed } = player;
  const changeSpeed = useCallback(
    (value: number) => {
      setSpeed(value);
      saveSpeed(value);
    },
    [setSpeed],
  );
  const playerWithSavedSpeed = useMemo(() => ({ ...player, setSpeed: changeSpeed }), [player, changeSpeed]);

  const onReady = useCallback(
    (window: TerminalWindow) => {
      win.current = window;
      window.setSpeed(speed);
    },
    [speed],
  );

  const onCommand = useCallback(
    (snapshot: unknown) => {
      saveMachine(storageKey, snapshot);
      if (challenges.length > 0) check.submit(snapshot);
    },
    [storageKey, challenges.length, check],
  );

  // Keyboard shortcuts of the prototype, off while typing in the terminal or a field.
  const { next, back, toggleAll } = player;
  useEffect(() => {
    if (script.steps.length === 0) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target && (target.closest(".term") || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
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

  const openCheatSheet = async () => setCheatSheet(await cheatSheetHtml());

  const startChallenge = async (challenge: PublicQuestion) => {
    if (!win.current) return;
    setStarting(challenge.id);
    try {
      await win.current.loadScenario(await practice.scenario(challenge.id));
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

  return (
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
          <Image src="/utfpr-logo.svg" alt="UTFPR" width={78} height={22} unoptimized />
          <span className={styles.campus}>{t.seal}</span>
        </span>
        {script.steps.length > 0 && <PlayerBar script={script} player={playerWithSavedSpeed} />}
        <nav className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => void openCheatSheet()}>
            {t.actions.cheatSheet}
          </button>
          <button type="button" className={styles.action} onClick={() => narrator.setEnabled(!narrator.enabled)} aria-pressed={narrator.enabled} title={t.narration.title}>
            {narrator.enabled ? t.narration.on : t.narration.off}
          </button>
          <button type="button" className={`${styles.action} ${styles.reset}`} onClick={() => void resetMachine()} title={t.actions.resetTitle}>
            {t.actions.reset}
          </button>
          <button type="button" className={styles.action} onClick={() => win.current?.exportJson(`maquina-${module.title}`)} title={t.actions.exportTitle} aria-label={t.actions.exportTitle}>
            {t.actions.export}
          </button>
          <button type="button" className={styles.action} onClick={() => void importMachine()} title={t.actions.importTitle} aria-label={t.actions.importTitle}>
            {t.actions.import}
          </button>
        </nav>
      </header>

      <main className={styles.split}>
        <section className={styles.study}>
          <nav className={styles.tabs} role="tablist" aria-label={t.tabs.label}>
            <button type="button" role="tab" aria-selected={tab === "lesson"} className={`${styles.tab} ${tab === "lesson" ? styles.active : ""}`} onClick={() => setTab("lesson")}>
              {t.tabs.lesson}
            </button>
            <button type="button" role="tab" aria-selected={tab === "challenges"} className={`${styles.tab} ${tab === "challenges" ? styles.active : ""}`} onClick={() => setTab("challenges")}>
              {t.tabs.challenges}{" "}
              <span className={styles.counter}>
                {done}/{challenges.length}
              </span>
            </button>
          </nav>
          <div ref={study} className={styles.panel} role="tabpanel">
            {narrator.needsLogin && (
              <p className={styles.invite} role="status">
                {t.narration.invite} <Link href="/login">{t.narration.login}</Link>
              </p>
            )}
            {tab === "lesson" ? (
              <LessonPanel script={script} player={playerWithSavedSpeed} />
            ) : (
              <ChallengePanel
                challenges={challenges}
                completed={check.completed}
                needsLogin={check.needsLogin}
                starting={starting}
                busy={busy}
                onStart={(challenge) => void startChallenge(challenge)}
                onRunSolution={(challenge) => void runSolution(challenge)}
              />
            )}
          </div>
        </section>
        <TerminalPane snapshot={initialSnapshot} onReady={onReady} onCommand={onCommand} />
      </main>

      {toast && (
        <div className={styles.toast} role="status">
          {toast}
        </div>
      )}
      {cheatSheet !== null && <CheatSheetModal html={cheatSheet} onClose={() => setCheatSheet(null)} />}
    </div>
  );
}

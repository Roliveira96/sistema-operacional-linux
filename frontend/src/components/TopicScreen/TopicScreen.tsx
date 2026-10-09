"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { cheatSheetHtml, mountTerminalWindow, type Step, type TerminalWindow } from "@/engine/engine";
import { legacyTheme } from "@/engine/legacyTheme";
import { moduleAccent } from "@/lib/moduleVisual";
import { contentMessages } from "@/messages/content.pt-BR";
import { contentService, type ContentBlock, type ContentService, type PublicQuestion } from "@/services/contentService";
import { ApiProblemError } from "@/services/httpClient";
import { moduleService, type CourseModuleDetails } from "@/services/moduleService";
import { practiceService, type ModuleCheckResult, type PracticeService } from "@/services/practiceService";
import { createAutoCheck, type AutoCheck } from "./autoCheck";
import { ChallengeList } from "./ChallengeList";
import { LessonCards } from "./LessonCards";
import { buildScript, cardOfStep, subtitleOf } from "./lessons";
import styles from "./TopicScreen.module.scss";

const m = contentMessages.topic;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export interface TopicScreenProps {
  moduleId: string;
  backHref: string;
  content?: Pick<ContentService, "blocks" | "questions">;
  modules?: Pick<typeof moduleService, "getModuleById">;
  practice?: Pick<PracticeService, "scenario" | "topicScenario" | "checkModule" | "progress">;
  /** Injectable for tests: the prototype terminal window and cheat sheet. */
  mount?: typeof mountTerminalWindow;
  cheatSheet?: () => Promise<string>;
  storage?: Storage | null;
}

interface Loaded {
  module: CourseModuleDetails;
  blocks: ContentBlock[];
  challenges: PublicQuestion[];
  topic: unknown;
}

type State = { kind: "loading" } | { kind: "error"; message: string; login: boolean } | ({ kind: "loaded" } & Loaded);

const SPEED_KEY = "linux-lab:speed";

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | null | undefined, key: string, value: string | null) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Storage may be full or blocked; the machine simply is not kept.
  }
}

/** Short hash of the topic machine: a content reload invalidates saved machines. */
function hashOf(value: unknown): string {
  const textValue = JSON.stringify(value) ?? "";
  let h = 5381;
  for (let i = 0; i < textValue.length; i++) h = ((h << 5) + h + textValue.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function describe(error: unknown): { message: string; login: boolean } {
  if (error instanceof ApiProblemError) {
    if (error.status === 404) return { message: contentMessages.notFound, login: false };
    if (error.status === 401) return { message: contentMessages.needsLogin, login: true };
    if (error.status === 403) return { message: contentMessages.forbidden, login: false };
  }
  return { message: contentMessages.unexpected, login: false };
}

/**
 * Study screen of a topic, as in the prototype (SPEC-016): lessons and
 * challenges on the left, the prototype terminal window on the right, the
 * player and the machine actions on top.
 */
export function TopicScreen({
  moduleId,
  backHref,
  content = contentService,
  modules = moduleService,
  practice = practiceService,
  mount = mountTerminalWindow,
  cheatSheet = cheatSheetHtml,
  storage,
}: TopicScreenProps) {
  const store = storage === undefined ? browserStorage() : storage;
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tab, setTab] = useState<"lessons" | "challenges">("lessons");
  const [speed, setSpeed] = useState(() => Number(read(store, SPEED_KEY)) || 1);
  const [index, setIndex] = useState(-1);
  const [running, setRunning] = useState<number | null>(null);
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const [playing, setPlaying] = useState<"all" | number | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState<ReadonlySet<string>>(new Set());
  const [needsLogin, setNeedsLogin] = useState(false);
  const [terminalFailed, setTerminalFailed] = useState(false);
  const [sheet, setSheet] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const container = useRef<HTMLDivElement>(null);
  const terminal = useRef<TerminalWindow | null>(null);
  const autoCheck = useRef<AutoCheck | null>(null);
  const stop = useRef(false);
  const indexRef = useRef(-1);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const blocks = await content.blocks(moduleId);
        const [module, exercises, topic] = await Promise.all([
          modules.getModuleById(moduleId),
          content.questions(moduleId, "EXERCISE"),
          practice.topicScenario(moduleId),
        ]);
        if (!active) return;
        const challenges = exercises.filter((q) => q.kind === "PRACTICAL");
        setState({ kind: "loaded", module, blocks, challenges, topic });
        const progress = await practice.progress(moduleId).catch(() => []);
        if (active) setCompleted(new Set(progress.filter((p) => p.completedAt).map((p) => p.questionId)));
      } catch (error) {
        if (active) setState({ kind: "error", ...describe(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [moduleId, content, modules, practice]);

  const loaded = state.kind === "loaded" ? state : null;
  const topic = loaded?.topic;
  const machineKey = loaded ? `linux-lab:machine:${moduleId}:${hashOf(topic)}` : null;
  const script = useMemo(() => buildScript(loaded?.blocks ?? []), [loaded?.blocks]);

  const applyCheck = useCallback((result: ModuleCheckResult) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      for (const id of result.passed) next.add(id);
      for (const p of result.progress) if (p.completedAt) next.add(p.questionId);
      return next;
    });
  }, []);

  // Mounts the prototype terminal window once the topic machine is known.
  useEffect(() => {
    if (!loaded || !container.current || !machineKey) return;
    let disposed = false;
    let mounted: TerminalWindow | null = null;
    const saved = read(store, machineKey);
    let start: unknown = loaded.topic;
    try {
      if (saved) start = JSON.parse(saved);
    } catch {
      start = loaded.topic;
    }
    const check = createAutoCheck({
      check: (snapshot) => practice.checkModule(moduleId, snapshot),
      snapshot: () => terminal.current?.snapshot(),
      onResult: applyCheck,
      onUnauthorized: () => setNeedsLogin(true),
    });
    autoCheck.current = check;
    const onCommand = () => {
      const current = terminal.current;
      if (!current) return;
      write(store, machineKey, JSON.stringify(current.snapshot()));
      check.schedule();
    };
    mount(container.current, start, { onCommand })
      .then((w) => {
        if (disposed) {
          w.destroy();
          return;
        }
        mounted = w;
        terminal.current = w;
        w.setSpeed(speed);
        // A saved machine may already satisfy challenges.
        check.schedule();
      })
      .catch(() => setTerminalFailed(true));
    return () => {
      disposed = true;
      stop.current = true;
      check.stop();
      mounted?.destroy();
      terminal.current = null;
    };
    // The window is mounted once per module; speed changes go through setSpeed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded?.module.id, machineKey]);

  const changeSpeed = (value: number) => {
    setSpeed(value);
    write(store, SPEED_KEY, String(value));
    terminal.current?.setSpeed(value);
  };

  const moveIndex = (value: number) => {
    indexRef.current = value;
    setIndex(value);
  };

  /** Runs one step of the script; resolves false when it cannot run now. */
  const runStep = async (i: number): Promise<boolean> => {
    const step: Step | undefined = script.steps[i];
    const current = terminal.current;
    if (!step || !current) return false;
    setRunning(i);
    document.querySelector(`[data-step="${i}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    try {
      await current.run(step);
      setDone((prev) => new Set(prev).add(i));
      moveIndex(i);
      return true;
    } finally {
      setRunning(null);
    }
  };

  const exclusive = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };

  const runOne = (i: number) => void exclusive(async () => void (await runStep(i)));

  /** ▶ of the player or of a card: plays until the end, or stops when pressed again. */
  const togglePlay = (which: "all" | number) => {
    if (playing !== null) {
      stop.current = true;
      return;
    }
    void exclusive(async () => {
      stop.current = false;
      setPlaying(which);
      try {
        if (which === "all") {
          for (let i = indexRef.current + 1; i < script.steps.length && !stop.current; i++) {
            if (!(await runStep(i))) break;
          }
        } else {
          const card = script.cards[which]!;
          for (let i = card.firstStep; i < card.firstStep + card.stepCount && !stop.current; i++) {
            if (!(await runStep(i))) break;
          }
        }
      } finally {
        setPlaying(null);
      }
    });
  };

  /** ⏮: commands cannot be undone, so the machine restarts and replays fast. */
  const previous = () =>
    void exclusive(async () => {
      const current = terminal.current;
      if (!current || indexRef.current < 0) return;
      const target = indexRef.current - 1;
      current.load(topic);
      current.setSpeed(30);
      setDone(new Set());
      try {
        for (let i = 0; i <= target; i++) await runStep(i);
      } finally {
        current.setSpeed(speed);
        moveIndex(target);
      }
    });

  const reset = () =>
    void exclusive(async () => {
      if (!machineKey) return;
      write(store, machineKey, null);
      await terminal.current?.reset(topic);
      setDone(new Set());
      moveIndex(-1);
    });

  const startChallenge = (i: number) =>
    void exclusive(async () => {
      const challenge = loaded?.challenges[i];
      if (!challenge || !terminal.current) return;
      try {
        const snapshot = await practice.scenario(challenge.id);
        await terminal.current.prepare(snapshot, m.preparing(i + 1));
      } catch {
        setNotice(m.challengeFailed);
      }
    });

  const runSolution = (i: number) =>
    void exclusive(async () => {
      const solution = loaded?.challenges[i]?.solution ?? [];
      for (const step of solution) await terminal.current?.run(step);
    });

  const importMachine = () =>
    void exclusive(async () => {
      if (!(await terminal.current?.importJson())) setNotice(m.importFailed);
    });

  const openCheatSheet = async () => setSheet(await cheatSheet());

  if (state.kind === "loading") {
    return (
      <p className={styles.status} role="status">
        {contentMessages.loading}
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <div className={styles.status}>
        <p role="alert">{state.message}</p>
        <div className={styles.statusActions}>
          {state.login && <Link href="/login">{contentMessages.goToLogin}</Link>}
          <Link href={backHref}>{contentMessages.backToMaterials}</Link>
        </div>
      </div>
    );
  }

  const { module, challenges } = state;
  const total = script.steps.length;
  const nextStep = running ?? index + 1;
  const nextCard = cardOfStep(script.cards, nextStep);
  const card = script.cards[nextCard];
  const cardLabel = card ? (card.kind === "concepts" ? m.conceptsShort : (card.command ?? "")) : "";
  const cardTitle = card ? (card.kind === "concepts" ? m.conceptsTitle : (card.title ?? "")) : "";
  const activeCard = playing !== null || running !== null ? (typeof playing === "number" ? playing : nextCard) : -1;
  const doneCount = challenges.filter((q) => completed.has(q.id)).length;

  return (
    <div className={`${styles.screen} ${legacyTheme}`} style={moduleAccent(module.color)}>
      <header className={styles.header}>
        <Link href={backHref} className={styles.back}>
          {m.back}
        </Link>
        <div className={styles.title}>
          {module.icon && (
            <span className={styles.icon} aria-hidden="true">
              {module.icon}
            </span>
          )}
          <div>
            <h1>{module.title}</h1>
            <p>{subtitleOf(module.description)}</p>
          </div>
        </div>
        <div className={styles.seal}>
          {/* eslint-disable-next-line @next/next/no-img-element -- small static SVG of the institution */}
          <img src="/brand/utfpr-logo.svg" alt="UTFPR" />
          <span>{m.institution}</span>
        </div>
        {total > 0 && (
          <div className="reprodutor" role="group" aria-label={m.player}>
            <button type="button" className="rep-botao" title={m.previous} aria-label={m.previous} disabled={busy || index < 0} onClick={previous}>
              ⏮
            </button>
            <button
              type="button"
              className={`rep-botao rep-play ${playing === "all" ? "" : "pausado"}`}
              title={playing === "all" ? m.pause : m.playAll}
              aria-label={playing === "all" ? m.pause : m.playAll}
              disabled={busy && playing !== "all"}
              onClick={() => togglePlay("all")}
            >
              {playing === "all" ? "⏸" : "▶"}
            </button>
            <button type="button" className="rep-botao" title={m.next} aria-label={m.next} disabled={busy || index + 1 >= total} onClick={() => runOne(index + 1)}>
              ⏭
            </button>
            <div className="rep-info">
              <div className="rep-linha">
                <span className="rep-bloco">
                  {card ? (running !== null ? m.runningCard : m.nextCard)(nextCard + 1, script.cards.length, cardLabel, cardTitle) : m.scriptDone}
                </span>
                <span className="rep-contador">
                  {index + 1}/{total}
                </span>
              </div>
              <span className="rep-titulo">{script.steps[nextStep] ? `$ ${script.steps[nextStep]!.command}` : m.restart}</span>
              <div className="rep-trilho">
                <div className="rep-progresso" style={{ ["--progresso" as string]: `${((index + 1) / total) * 100}%` }} />
              </div>
            </div>
            <select className="rep-velocidade" title={m.speed} aria-label={m.speed} value={String(speed)} onChange={(e) => changeSpeed(Number(e.target.value))}>
              {m.speeds.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        )}
        <nav className={styles.actions} aria-label={m.actions}>
          <Button variant="secondary" onClick={() => void openCheatSheet()}>
            {m.cheatSheet}
          </Button>
          <Button variant="secondary" className={styles.reset} title={m.resetTitle} disabled={busy} onClick={reset}>
            {m.reset}
          </Button>
          <Button variant="secondary" title={m.exportTitle} aria-label={m.exportTitle} onClick={() => terminal.current?.exportJson(m.exportName(module.title))}>
            💾
          </Button>
          <Button variant="secondary" title={m.importTitle} aria-label={m.importTitle} disabled={busy} onClick={importMachine}>
            📂
          </Button>
        </nav>
      </header>

      {notice && (
        <p className={styles.notice} role="alert">
          {notice}
          <button type="button" aria-label={m.close} onClick={() => setNotice(null)}>
            ✕
          </button>
        </p>
      )}

      <main className="topico-divisao">
        <section className="topico-estudo" aria-label={m.tabs}>
          <nav className="abas-estudo" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "lessons"} className={`aba-estudo ${tab === "lessons" ? "ativa" : ""}`} onClick={() => setTab("lessons")}>
              {m.lessonsTab}
            </button>
            <button type="button" role="tab" aria-selected={tab === "challenges"} className={`aba-estudo ${tab === "challenges" ? "ativa" : ""}`} onClick={() => setTab("challenges")}>
              {m.challengesTab}{" "}
              <span className="contador-desafios">
                {doneCount}/{challenges.length}
              </span>
            </button>
          </nav>
          <div className={`painel-estudo ${styles.panel}`} role="tabpanel" hidden={tab !== "lessons"}>
            <LessonCards
              cards={script.cards}
              steps={script.steps}
              state={{ running, done }}
              activeCard={activeCard}
              playingCard={typeof playing === "number" ? playing : null}
              onRunStep={runOne}
              onToggleCard={(c) => togglePlay(c)}
            />
          </div>
          <div className={`painel-estudo ${styles.panel}`} role="tabpanel" hidden={tab !== "challenges"}>
            <ChallengeList challenges={challenges} completed={completed} needsLogin={needsLogin} busy={busy} onStart={startChallenge} onRunSolution={runSolution} />
          </div>
        </section>
        <section className="topico-terminal">
          {terminalFailed && <p role="alert">{m.terminalFailed}</p>}
          <div ref={container} className="topico-janela" />
          <p className="topico-rodape">
            {m.terminalFooter.passwords} <b>root</b> = <code>123</code> · <b>ricardo</b> = <code>123</code> · <kbd>Tab</kbd> {m.terminalFooter.complete} · <kbd>↑</kbd>{" "}
            {m.terminalFooter.history} · <kbd>Ctrl</kbd>+<kbd>C</kbd> {m.terminalFooter.cancel} · <kbd>Ctrl</kbd>+<kbd>L</kbd> {m.terminalFooter.clear}
          </p>
        </section>
      </main>

      {sheet !== null && (
        // Classes of the prototype modal: its print rules print only the cheat sheet.
        <div className={`modal-fundo aberto ${styles.backdrop}`} onClick={(e) => e.target === e.currentTarget && setSheet(null)}>
          <div className={`modal ${styles.dialog}`} role="dialog" aria-modal="true" aria-label={m.cheatSheetTitle}>
            <header className={styles.dialogHeader}>
              <h2>{m.cheatSheetTitle}</h2>
              <button type="button" className={styles.close} aria-label={m.close} onClick={() => setSheet(null)}>
                ✕
              </button>
            </header>
            <div className={styles.dialogBody} dangerouslySetInnerHTML={{ __html: sheet }} />
          </div>
        </div>
      )}
    </div>
  );
}

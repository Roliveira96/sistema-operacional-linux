"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { LiveHeaderStatus } from "@/components/Classroom/LiveHeaderStatus/LiveHeaderStatus";
import { MirroredModuleView, type StepRunner } from "@/components/Classroom/MirroredModuleView/MirroredModuleView";
import type { CommandRun } from "@/engine/terminalWindow";
import { placeContent, scrollFraction } from "@/components/Classroom/FixedStage/stage";
import { MATERIAL_HIGHLIGHT, materialRangeOf, materialSelectionOf, showHighlight, terminalSelectionOf } from "@/components/Classroom/selection/selection";
import type { ScreenElement, ScreenLocator } from "@/engine/terminalScreen";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { TopicPlayer } from "@/hooks/useTopicPlayer";
import { clampSplit, SPLIT } from "@/lib/machineStorage";
import { topicAccentVars } from "@/lib/moduleVisual";
import { buildTopicScript, type TopicScript } from "@/lib/topicScript";
import { contentMessages as m } from "@/messages/content.pt-BR";
import type { LiveModuleContent, StageSelection } from "@/services/classroomService";
import { LessonPanel } from "./LessonPanel";
import styles from "./TopicStudy.module.scss";

const t = m.topic;

/** How long the teacher stays still on a block before it becomes the block in focus. */
const READING_MS = 400;
/** The reading line: where, from the top of the material, the eye of the teacher is. */
const READING_LINE = 0.25;

/** What the study screen needs to be the screen of a live class (SPEC-055 CA-13). */
export interface TopicLive {
  /** The content and the first machine, as the room gives them. */
  module: LiveModuleContent;
  /** The teacher transmits; the student follows. */
  role: "teacher" | "student";
  terminal: LiveTerminal;
  /** The block of the module the teacher is on. */
  focusBlockId: string | null;
  /** Where the teacher is in the material, from 0 to 1 of what can be scrolled (SPEC-057): the student follows it, and the teacher is put back there. */
  materialScroll?: number;
  /** The part of the stage the material takes, from 0.2 to 0.8; null is the default of the layout (SPEC-057). */
  split?: number | null;
  /** The teacher reads: the block that is under his eyes. */
  onRead?(blockId: string): void;
  /** The teacher's terminal tells the picture of its window (SPEC-056). */
  onScreen?(tree: ScreenElement): void;
  /** The teacher's terminal tells each command that ran, for the diary of the lesson (SPEC-071). */
  onCommandRun?(run: CommandRun): void;
  /** The teacher scrolls the material; the position is a fraction of what can be scrolled (SPEC-057). */
  onMaterialScroll?(y: number): void;
  /** The teacher moves the divider; `ratio` is the part of the stage the material takes (SPEC-057). */
  onSplit?(ratio: number): void;
  /** The text the teacher selected: the student marks it, on the material and on the copy of the terminal (SPEC-057 CA-20, CA-21). */
  selection?: StageSelection | null;
  /** The teacher selects text in the material or in the terminal, or clears the selection: null (SPEC-057 CA-20). */
  onSelection?(selection: StageSelection | null): void;
  /** The teacher scrolls the history of a terminal: its number and the place as a fraction of what can be scrolled; 1 is the end (SPEC-057 CA-23). */
  onTerminalScroll?(terminal: number, y: number): void;
  /** Where the teacher has the history of each terminal, by number, which the student's copy follows (SPEC-057 CA-23). */
  terminalScroll?: Record<string, number>;
  /** When the class began, as the room tells it: with it the header shows the time of the class and the raised hands (SPEC-058). Without it, only the title. */
  startedAt?: string | null;
  /** How many hands are up, for the header; 0 when the room does not say (SPEC-058). */
  handCount?: number;
  /** The student's room gives the click of the hand: the hand of the header is then the button that raises it (SPEC-062). The teacher's has none. */
  onHand?(): void;
  /** The hand of the student himself is up (SPEC-062). */
  handRaised?: boolean;
  /** The teacher ran an example and it could not run: the terminal was busy, closed or failed. The window of the presentation tells him (SPEC-060 CA-04). */
  onRunFailed?(): void;
}

// Nothing here plays: the material is read, and the terminal is the one of the class. The only thing the teacher plays is one example at a time, by its
// button (SPEC-060); next, back, play all, speed and the marks of done are not part of the live class.
const noop = async () => undefined;
const idlePlayer: TopicPlayer = {
  index: -1,
  playing: false,
  playingCard: null,
  running: null,
  activeCard: null,
  done: new Set(),
  speed: 1,
  setSpeed: () => undefined,
  toggleAll: () => undefined,
  toggleCard: () => undefined,
  runOne: noop,
  next: noop,
  back: noop,
  rewind: () => undefined,
};

/** The block under the eyes of the teacher: the last one that already reached the reading line. */
function blockUnderReading(panel: HTMLElement): string | null {
  const box = panel.getBoundingClientRect();
  const line = box.top + box.height * READING_LINE;
  let found: string | null = null;
  for (const element of panel.querySelectorAll<HTMLElement>("[data-block]")) {
    if (element.getBoundingClientRect().top <= line) found = element.dataset.block ?? found;
  }
  return found ?? panel.querySelector<HTMLElement>("[data-block]")?.dataset.block ?? null;
}

/**
 * The study screen of the module in the live class: the material on the left and the terminal of the class on the right, with the same
 * divider (SPEC-016), and nothing of the study alone: no challenges, no marks, no voice, no way back (SPEC-055 CA-13). It is drawn in the stage of
 * 1280 x 720 (smaller by the zoom), so it is the same for everybody; the scroll of the material, the divider and the selection of text are the
 * teacher's, and the student only follows them (SPEC-057).
 */
export function LiveTopicScreen({ live }: { live: TopicLive }) {
  const { module, role, terminal, focusBlockId, materialScroll = 0, split, selection, terminalScroll, startedAt, handCount = 0, onHand, handRaised, onRead, onScreen, onCommandRun, onMaterialScroll, onSplit, onSelection, onTerminalScroll, onRunFailed } = live;
  const teacher = role === "teacher";
  const script = useMemo(() => buildTopicScript(module.blocks), [module.blocks]);
  const panel = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const columns = useRef<HTMLElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  // How to find a point of the teacher's terminal in the text of the last picture he told, as the terminal tells it with each picture.
  const locator = useRef<ScreenLocator | null>(null);
  const [dragging, setDragging] = useState(false);

  // One example at a time runs in the terminal of the class, typed on its screen: its number is kept with the script it is of, so a module that replaces
  // this one does not inherit the state. `busyOn` is the script that has a run going, which a second click does not start over.
  const [running, setRunning] = useState<{ script: TopicScript; index: number } | null>(null);
  const busyOn = useRef<TopicScript | null>(null);
  const terminalRun = useRef<StepRunner | null>(null);
  const latest = useRef<{ script: TopicScript | null; failed: (() => void) | undefined }>({ script, failed: onRunFailed });
  useEffect(() => {
    latest.current = { script, failed: onRunFailed };
  });
  useEffect(
    () => () => {
      latest.current.script = null;
    },
    [],
  );
  const runOne = useCallback(
    async (index: number) => {
      const step = script.steps[index];
      if (!teacher || !step || busyOn.current === script) return;
      const run = terminalRun.current;
      if (!run) {
        latest.current.failed?.();
        return;
      }
      busyOn.current = script;
      setRunning({ script, index });
      let status: number | null = null;
      try {
        status = await run(step);
      } catch {
        // A terminal that fails is the same as one that did not run the step.
      }
      if (busyOn.current === script) busyOn.current = null;
      setRunning((now) => (now?.script === script ? null : now));
      // The result of a run is for the screen it was started on: the module may have changed, or the screen gone, since.
      if (status === null && latest.current.script === script) latest.current.failed?.();
    },
    [script, teacher],
  );
  const runningIndex = running?.script === script ? running.index : null;
  const examplesPlayer = useMemo<TopicPlayer>(() => ({ ...idlePlayer, running: runningIndex, runOne }), [runningIndex, runOne]);

  // The divider is where the room says, from the start: the screen keeps no preference of its own, because the others would not have it. The
  // teacher moves it by hand, and what the room says takes its place again when it changes (the teacher connecting again, for one).
  const fromRoom = split == null ? SPLIT.initial : clampSplit(split * 100);
  const [seen, setSeen] = useState(fromRoom);
  const [studyPercent, setStudyPercent] = useState(fromRoom);
  if (seen !== fromRoom) {
    setSeen(fromRoom);
    setStudyPercent(fromRoom);
  }

  // The block in focus is marked in the page; the teacher's view is brought to it unless it came from his own reading. The student's view is the
  // teacher's scroll, so it is not moved from here.
  const lastRead = useRef<string | null>(null);
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const marked: Element[] = [];
    if (focusBlockId) {
      const block = root.querySelector(`[data-block="${CSS.escape(focusBlockId)}"]`);
      if (block) {
        block.setAttribute("data-focused", "true");
        marked.push(block);
        if (teacher && focusBlockId !== lastRead.current) block.scrollIntoView?.({ block: "center", behavior: "smooth" });
      }
    }
    return () => marked.forEach((block) => block.removeAttribute("data-focused"));
  }, [focusBlockId, script, teacher]);

  // The place of the material is the teacher's: the student's material is moved to it; the teacher is put back there when he comes in again. When
  // the divider moves the text breaks in other lines, so the student's place is worked out again.
  const rewrapped = teacher ? null : studyPercent;
  useEffect(() => {
    if (panel.current && content.current) placeContent(panel.current, content.current, materialScroll, !teacher);
  }, [materialScroll, script, teacher, rewrapped]);

  // The teacher tells where he is in the material at every scroll, and again when the divider moves; the room paces and filters what goes out.
  const tell = useRef(onMaterialScroll);
  useEffect(() => {
    tell.current = onMaterialScroll;
  });
  const reportScroll = useCallback(() => {
    if (panel.current && content.current) tell.current?.(scrollFraction(panel.current, content.current));
  }, []);
  const dividerMoved = useRef(false);
  useEffect(() => {
    if (!dividerMoved.current) dividerMoved.current = true;
    else if (teacher) reportScroll();
  }, [studyPercent, teacher, reportScroll]);

  // The teacher's selection goes to the class, from the material and from the terminal alike, at every change of it; the room paces and filters
  // what goes out. A selection that is in neither, or is empty, is the same as none (SPEC-057 CA-20).
  const tellSelection = useRef(onSelection);
  useEffect(() => {
    tellSelection.current = onSelection;
  });
  useEffect(() => {
    if (!teacher) return;
    const changed = () => {
      const picked = document.getSelection();
      const range = picked && picked.rangeCount > 0 && !picked.isCollapsed ? picked.getRangeAt(0) : null;
      let selected: StageSelection | null = null;
      if (range && panel.current?.contains(range.commonAncestorContainer)) selected = materialSelectionOf(panel.current, range);
      else if (range && locator.current && pane.current?.contains(range.commonAncestorContainer)) selected = terminalSelectionOf(locator.current, range);
      tellSelection.current?.(selected);
    };
    document.addEventListener("selectionchange", changed);
    return () => document.removeEventListener("selectionchange", changed);
  }, [teacher]);

  // The student marks on the material what the teacher selected, again when the module changes; the terminal has its own mark.
  useEffect(() => {
    if (teacher || !selection || selection.pane !== "material" || !panel.current) return;
    const range = materialRangeOf(panel.current, selection);
    if (range) return showHighlight(MATERIAL_HIGHLIGHT, [range]);
  }, [teacher, selection, script]);

  // The focus follows what the teacher reads, once he stops (SPEC-055 CA-18).
  const reading = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reading.current), []);
  const onScroll = useCallback(() => {
    if (teacher) reportScroll();
    if (!onRead || !panel.current) return;
    clearTimeout(reading.current);
    reading.current = setTimeout(() => {
      const id = panel.current ? blockUnderReading(panel.current) : null;
      if (!id || id === lastRead.current) return;
      lastRead.current = id;
      onRead(id);
    }, READING_MS);
  }, [teacher, onRead, reportScroll]);

  const moveDivider = useCallback(
    (percent: number) => {
      const value = clampSplit(percent);
      setStudyPercent(value);
      onSplit?.(value / 100);
    },
    [onSplit],
  );
  const dragTo = (clientX: number) => {
    const box = columns.current?.getBoundingClientRect();
    if (box && box.width > 0) moveDivider(((clientX - box.left) / box.width) * 100);
  };
  const dividerKeys = (event: KeyboardEvent) => {
    const step = event.shiftKey ? SPLIT.step * 3 : SPLIT.step;
    const target: Record<string, number> = { ArrowLeft: studyPercent - step, ArrowRight: studyPercent + step, Home: SPLIT.min, End: SPLIT.max };
    if (!(event.key in target)) return;
    event.preventDefault();
    moveDivider(target[event.key]!);
  };

  // Only the teacher moves the divider; the student's is a line that stays where the teacher put it.
  const hands = teacher
    ? {
        tabIndex: 0,
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDragging(true);
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => dragging && dragTo(event.clientX),
        onPointerUp: () => setDragging(false),
        onPointerCancel: () => setDragging(false),
        onClick: (event: MouseEvent<HTMLDivElement>) => event.detail >= 2 && moveDivider(SPLIT.initial),
        onKeyDown: dividerKeys,
      }
    : {};

  return (
    <div className={`${styles.screen} ${styles.live}`} style={topicAccentVars()}>
      <header className={styles.header}>
        <div className={styles.title}>
          <h1 className={styles.name}>{module.title}</h1>
        </div>
        {/* The time of the class and the raised hands, the same for the teacher and for the students (SPEC-058 CA-01). */}
        {startedAt && <LiveHeaderStatus startedAt={startedAt} hands={handCount} onHand={onHand} handRaised={handRaised} />}
      </header>

      <main
        ref={columns}
        className={`${styles.split} ${dragging ? styles.dragging : ""}`}
        style={{ "--split-columns": `minmax(0, ${studyPercent}fr) 10px minmax(0, ${100 - studyPercent}fr)` } as CSSProperties}
      >
        <section className={styles.study}>
          <div ref={panel} className={`${styles.panel} ${styles.livePanel} ${teacher ? "" : styles.follower}`} data-live-panel="" onScroll={onScroll}>
            <div ref={content} className={styles.liveContent} data-live-content="">
              <LessonPanel script={script} player={teacher ? examplesPlayer : idlePlayer} readOnly canRun={teacher} />
            </div>
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
          className={`${styles.divider} ${teacher ? "" : styles.fixedDivider}`}
          {...hands}
        />
        <div ref={pane} className={styles.livePane}>
          <MirroredModuleView
            key={module.moduleId}
            role={role}
            terminal={terminal}
            initialState={module.scenario}
            onScreen={onScreen}
            onCommandRun={teacher ? onCommandRun : undefined}
            onLocator={(found) => {
              locator.current = found;
            }}
            selection={teacher ? undefined : selection}
            onTerminalScroll={teacher ? onTerminalScroll : undefined}
            terminalScroll={teacher ? undefined : terminalScroll}
            onRunner={
              teacher
                ? (run) => {
                    terminalRun.current = run;
                  }
                : undefined
            }
          />
        </div>
      </main>
    </div>
  );
}

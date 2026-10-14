"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { MirroredModuleView } from "@/components/Classroom/MirroredModuleView/MirroredModuleView";
import type { TerminalCommandEvent, TerminalInputEvent } from "@/engine/terminalWindow";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { TopicPlayer } from "@/hooks/useTopicPlayer";
import { clampSplit, loadSplit, saveSplit, SPLIT } from "@/lib/machineStorage";
import { topicAccentVars } from "@/lib/moduleVisual";
import { buildTopicScript } from "@/lib/topicScript";
import { contentMessages as m } from "@/messages/content.pt-BR";
import type { LiveModuleContent } from "@/services/classroomService";
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
  /** The teacher reads: the block that is under his eyes. */
  onRead?(blockId: string): void;
  onInput?(event: TerminalInputEvent): void;
  onSync?(event: TerminalCommandEvent): void;
}

// Nothing here plays: the material is read, and the terminal is the one of the class.
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
 * divider (SPEC-016), and nothing of the study alone: no challenges, no marks, no voice, no way back (SPEC-055 CA-13).
 */
export function LiveTopicScreen({ live }: { live: TopicLive }) {
  const { module, role, terminal, focusBlockId, onRead, onInput, onSync } = live;
  const script = useMemo(() => buildTopicScript(module.blocks), [module.blocks]);
  const panel = useRef<HTMLDivElement>(null);
  const split = useRef<HTMLElement>(null);
  const [studyPercent, setStudyPercent] = useState(loadSplit);
  const [dragging, setDragging] = useState(false);
  const percentRef = useRef(studyPercent);

  // The block in focus is marked in the page, and brought into view unless it came from the teacher's own reading.
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
        if (focusBlockId !== lastRead.current) block.scrollIntoView?.({ block: "center", behavior: "smooth" });
      }
    }
    return () => marked.forEach((block) => block.removeAttribute("data-focused"));
  }, [focusBlockId, script]);

  // The focus follows what the teacher reads, once he stops (SPEC-055 CA-18).
  const reading = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(reading.current), []);
  const onScroll = useCallback(() => {
    if (!onRead || !panel.current) return;
    clearTimeout(reading.current);
    reading.current = setTimeout(() => {
      const id = panel.current ? blockUnderReading(panel.current) : null;
      if (!id || id === lastRead.current) return;
      lastRead.current = id;
      onRead(id);
    }, READING_MS);
  }, [onRead]);

  const moveDivider = useCallback((percent: number, save: boolean) => {
    const value = clampSplit(percent);
    percentRef.current = value;
    setStudyPercent(value);
    if (save) saveSplit(value);
  }, []);
  const dragTo = (clientX: number) => {
    const box = split.current?.getBoundingClientRect();
    if (box && box.width > 0) moveDivider(((clientX - box.left) / box.width) * 100, false);
  };
  const dividerKeys = (event: KeyboardEvent) => {
    const step = event.shiftKey ? SPLIT.step * 3 : SPLIT.step;
    const target: Record<string, number> = { ArrowLeft: studyPercent - step, ArrowRight: studyPercent + step, Home: SPLIT.min, End: SPLIT.max };
    if (!(event.key in target)) return;
    event.preventDefault();
    moveDivider(target[event.key]!, true);
  };

  return (
    <div className={`${styles.screen} ${styles.live}`} style={topicAccentVars()}>
      <header className={styles.header}>
        <div className={styles.title}>
          <h1 className={styles.name}>{module.title}</h1>
        </div>
      </header>

      <main
        ref={split}
        className={`${styles.split} ${dragging ? styles.dragging : ""}`}
        style={{ "--split-columns": `minmax(0, ${studyPercent}fr) 10px minmax(0, ${100 - studyPercent}fr)` } as CSSProperties}
      >
        <section className={styles.study}>
          <div ref={panel} className={styles.panel} data-live-panel="" onScroll={onScroll}>
            <LessonPanel script={script} player={idlePlayer} readOnly />
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
          onClick={(event) => event.detail >= 2 && moveDivider(SPLIT.initial, true)}
          onKeyDown={dividerKeys}
        />
        <div className={styles.livePane}>
          <MirroredModuleView key={module.moduleId} role={role} terminal={terminal} initialState={module.scenario} onInput={onInput} onSync={onSync} />
        </div>
      </main>
    </div>
  );
}

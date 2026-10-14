"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { TopicStudy } from "@/components/TopicStudy/TopicStudy";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveCursor, type LiveModuleContent, type StageSelection, type StageView } from "@/services/classroomService";
import { type CursorSend, useCursorSender } from "../cursorSender";
import { StagePointer, useStageScale, useStageZoom } from "../FixedStage/FixedStage";
import { percentOf, stageSize, toStagePoint } from "../FixedStage/stage";
import styles from "./ModuleStage.module.scss";

const m = messages.classroom.moduleStage;

export interface ModuleStageProps {
  classId: string;
  /** The module of the room; when it changes, the new one is loaded. */
  moduleId?: string | null;
  role: "teacher" | "student";
  /** The block of the module the teacher is on. */
  moduleFocusBlockId: string | null;
  terminal: LiveTerminal;
  /** The teacher's reading puts a block in focus. */
  onFocusBlock?(blockId: string): void;
  /** The teacher's terminal tells the picture of its window. */
  onScreen?(tree: ScreenElement): void;
  /** The mouse of the teacher, shown to everybody as a percentage of the stage (SPEC-057 CA-07). */
  cursor?: LiveCursor | null;
  /** The laser is on: the pointer of the teacher is the highlight. */
  laser?: boolean;
  /** The teacher's mouse over the stage tells where it is, as a percentage of the stage. */
  onCursor?: CursorSend;
  /** Where the teacher is: the scroll of the material and the divider, which the student follows (SPEC-057). */
  stageView?: StageView;
  /** The teacher scrolls the material. */
  onMaterialScroll?(y: number): void;
  /** The teacher moves the divider between the material and the terminal. */
  onSplit?(ratio: number): void;
  /** The text the teacher selects in the material or in the terminal, or null when he clears it (SPEC-057 CA-20). */
  onSelection?(selection: StageSelection | null): void;
  /** The teacher scrolls the history of a terminal: its number and the place; 1 is the end (SPEC-057 CA-23). */
  onTerminalScroll?(terminal: number, y: number): void;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; module: LiveModuleContent };

/**
 * The module of the live class: the study screen of the module in the live-class mode (SPEC-055 CA-13), drawn in the stage. Only the teacher can send:
 * the picture of his terminal, his reading, the scroll of the material, the divider, his mouse and the text he selects (SPEC-057).
 */
export function ModuleStage({ classId, moduleId, role, moduleFocusBlockId, terminal, onFocusBlock, onScreen, cursor = null, laser = false, onCursor, stageView, onMaterialScroll, onSplit, onSelection, onTerminalScroll }: ModuleStageProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const scale = useStageScale();
  const zoom = useStageZoom();
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useCursorSender(onCursor ?? (() => undefined), laser);

  useEffect(() => {
    let active = true;
    classroomService.getLiveModule(classId).then(
      (module) => active && setState({ kind: "ready", module }),
      () => active && setState({ kind: "error" }),
    );
    return () => {
      active = false;
    };
  }, [classId, moduleId]);

  if (state.kind === "loading") {
    return (
      <p className={styles.note} role="status">
        {m.loading}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p className={styles.error} role="alert">
        {m.loadError}
      </p>
    );
  }

  const teacher = role === "teacher";
  // The mouse is a percentage of the stage, whatever the size of the window and the zoom of the teacher.
  const mouseMove = (event: MouseEvent) => {
    const point = toStagePoint(event, stage.current!, scale);
    const size = stageSize(zoom);
    pointer.move(percentOf(point.x, size.width), percentOf(point.y, size.height));
  };
  return (
    <div ref={stage} className={styles.stage} onMouseMove={teacher ? mouseMove : undefined} onMouseLeave={teacher ? pointer.leave : undefined}>
      <TopicStudy
        moduleId={state.module.moduleId}
        backHref=""
        live={{
          module: state.module,
          role,
          terminal,
          focusBlockId: moduleFocusBlockId,
          materialScroll: stageView?.materialScroll,
          split: stageView?.split,
          // The teacher has the real selection; the student has only the mark of the teacher's.
          selection: teacher ? undefined : stageView?.selection,
          // The same for where each terminal is scrolled: the teacher has the real scroll, the student's copy follows it.
          terminalScroll: teacher ? undefined : stageView?.terminalScroll,
          onRead: teacher ? onFocusBlock : undefined,
          onScreen: teacher ? onScreen : undefined,
          onMaterialScroll: teacher ? onMaterialScroll : undefined,
          onSplit: teacher ? onSplit : undefined,
          onSelection: teacher ? onSelection : undefined,
          onTerminalScroll: teacher ? onTerminalScroll : undefined,
        }}
      />
      {/* The teacher sees his own mouse, not the point that stands for it; the laser tells him it is on. */}
      {cursor?.visible && (cursor.laser || !teacher) && <StagePointer x={cursor.x} y={cursor.y} laser={cursor.laser} />}
    </div>
  );
}

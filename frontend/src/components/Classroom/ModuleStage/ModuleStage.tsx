"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { TopicStudy } from "@/components/TopicStudy/TopicStudy";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { ScreenElement } from "@/engine/terminalScreen";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveCursor, type LiveModuleContent, type StageView } from "@/services/classroomService";
import { type CursorSend, useCursorSender } from "../cursorSender";
import { StagePointer, useStageScale } from "../FixedStage/FixedStage";
import { percentOf, STAGE_HEIGHT, STAGE_WIDTH, toStagePoint } from "../FixedStage/stage";
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
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; module: LiveModuleContent };

/**
 * The module of the live class: the study screen of the module in the live-class mode (SPEC-055 CA-13), drawn in the stage. Only the teacher can send:
 * the picture of his terminal, his reading, the scroll of the material, the divider and his mouse (SPEC-057).
 */
export function ModuleStage({ classId, moduleId, role, moduleFocusBlockId, terminal, onFocusBlock, onScreen, cursor = null, laser = false, onCursor, stageView, onMaterialScroll, onSplit }: ModuleStageProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const scale = useStageScale();
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
  // The mouse is a percentage of the stage of 1920 x 1080, whatever the size of the window.
  const mouseMove = (event: MouseEvent) => {
    const point = toStagePoint(event, stage.current!, scale);
    pointer.move(percentOf(point.x, STAGE_WIDTH), percentOf(point.y, STAGE_HEIGHT));
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
          onRead: teacher ? onFocusBlock : undefined,
          onScreen: teacher ? onScreen : undefined,
          onMaterialScroll: teacher ? onMaterialScroll : undefined,
          onSplit: teacher ? onSplit : undefined,
        }}
      />
      {cursor?.visible && <StagePointer x={cursor.x} y={cursor.y} laser={cursor.laser} />}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { TopicStudy } from "@/components/TopicStudy/TopicStudy";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import type { TerminalCommandEvent, TerminalInputEvent } from "@/engine/terminalWindow";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
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
  onInput?(event: TerminalInputEvent): void;
  onSync?(event: TerminalCommandEvent): void;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; module: LiveModuleContent };

/** The module of the live class: the study screen of the module in the live-class mode (SPEC-055 CA-13). Only the teacher can send. */
export function ModuleStage({ classId, moduleId, role, moduleFocusBlockId, terminal, onFocusBlock, onInput, onSync }: ModuleStageProps) {
  const [state, setState] = useState<State>({ kind: "loading" });

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
  return (
    <div className={styles.stage}>
      <TopicStudy
        moduleId={state.module.moduleId}
        backHref=""
        live={{
          module: state.module,
          role,
          terminal,
          focusBlockId: moduleFocusBlockId,
          onRead: teacher ? onFocusBlock : undefined,
          onInput: teacher ? onInput : undefined,
          onSync: teacher ? onSync : undefined,
        }}
      />
    </div>
  );
}

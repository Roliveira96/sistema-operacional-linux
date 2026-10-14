"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/Button/Button";
import { ContentRenderer } from "@/components/ContentRenderer/ContentRenderer";
import type { LiveTerminal } from "@/hooks/useLiveClassroom";
import { messages } from "@/messages/pt-BR";
import { classroomService, type LiveModuleContent } from "@/services/classroomService";
import type { TerminalCommandEvent, TerminalInputEvent } from "@/engine/terminalWindow";
import { MirroredModuleView } from "../MirroredModuleView/MirroredModuleView";
import styles from "./ModuleStage.module.scss";

const m = messages.classroom.moduleStage;

export interface ModuleStageProps {
  classId: string;
  role: "teacher" | "student";
  /** The block of the module the teacher put in focus. */
  moduleFocusBlockId: string | null;
  terminal: LiveTerminal;
  /** The teacher puts a block in focus. */
  onFocusBlock?(blockId: string): void;
  onInput?(event: TerminalInputEvent): void;
  onSync?(event: TerminalCommandEvent): void;
}

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; module: LiveModuleContent };

/**
 * The module of the live class for everybody: its content, read only, with the block in focus highlighted, and the terminal on the machine of
 * the module (SPEC-054 CA-11).
 */
export function ModuleStage({ classId, role, moduleFocusBlockId, terminal, onFocusBlock, onInput, onSync }: ModuleStageProps) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    classroomService.getLiveModule(classId).then(
      (module) => active && setState({ kind: "ready", module }),
      () => active && setState({ kind: "error" }),
    );
    return () => {
      active = false;
    };
  }, [classId]);

  // The student's eyes go where the teacher is.
  useEffect(() => {
    if (role !== "student" || !moduleFocusBlockId || state.kind !== "ready") return;
    const block = content.current?.querySelector(`[data-block-id="${CSS.escape(moduleFocusBlockId)}"]`);
    block?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [role, moduleFocusBlockId, state.kind]);

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

  const { module } = state;
  return (
    <div className={styles.stage}>
      <section className={styles.content} ref={content}>
        <h2 className={styles.title}>{module.title}</h2>
        {[...module.blocks]
          .sort((a, b) => a.position - b.position)
          .map((block) => {
            const focused = block.id === moduleFocusBlockId;
            return (
              <div key={block.id} className={`${styles.block} ${focused ? styles.focused : ""}`} data-block-id={block.id} aria-current={focused ? "true" : undefined}>
                {focused && <span className={styles.badge}>{m.inFocus}</span>}
                <ContentRenderer blocks={[block]} />
                {role === "teacher" && onFocusBlock && !focused && (
                  <Button variant="ghost" size="sm" onClick={() => onFocusBlock(block.id)}>
                    {m.focusThis}
                  </Button>
                )}
              </div>
            );
          })}
      </section>
      <MirroredModuleView key={module.moduleId} role={role} terminal={terminal} initialState={module.scenario} onInput={onInput} onSync={onSync} />
    </div>
  );
}

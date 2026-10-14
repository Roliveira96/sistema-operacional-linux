"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH, stageScale } from "./stage";
import styles from "./FixedStage.module.scss";

/** The scale the stage is drawn at; what is drawn inside needs it to place the mouse. 1 outside of a stage. */
export const StageScale = createContext(1);
export const useStageScale = () => useContext(StageScale);

/**
 * The stage of the live class (SPEC-057): a box of 1920 x 1080 logical pixels, the same for the teacher and for every student, scaled to fit the room
 * it is in and centered in it, with the dark of the theme on the sides. The room is measured again whenever it changes, so the window being resized
 * or going full screen takes no reload. Everything of the stage is drawn inside; the bar, the notes and the notices stay outside.
 */
export function FixedStage({ children }: { children: ReactNode }) {
  const room = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    // Without the observer (an old browser) the stage stays at its own size.
    if (!room.current || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => entry && setScale(stageScale(entry.contentRect.width, entry.contentRect.height)));
    watch.observe(room.current);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={room} className={styles.room} data-testid="fixed-stage">
      <div className={styles.frame} style={{ width: STAGE_WIDTH * scale, height: STAGE_HEIGHT * scale }}>
        <div className={styles.stage} data-testid="stage-box" style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}>
          <StageScale.Provider value={scale}>{children}</StageScale.Provider>
        </div>
      </div>
    </div>
  );
}

/** The mouse of the teacher on the stage: a plain pointer, and the highlight when the laser is on. `x` and `y` are percentages of the box it is in. */
export function StagePointer({ x, y, laser }: { x: number; y: number; laser: boolean }) {
  return <span className={laser ? styles.laser : styles.pointer} {...(laser ? { "data-laser": "" } : { "data-pointer": "" })} style={{ left: `${x}%`, top: `${y}%` }} />;
}

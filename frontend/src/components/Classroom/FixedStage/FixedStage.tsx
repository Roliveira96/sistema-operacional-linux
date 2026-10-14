"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { clampZoom, stageScale, stageSize } from "./stage";
import styles from "./FixedStage.module.scss";

/** The scale the stage is drawn at; what is drawn inside needs it to place the mouse. 1 outside of a stage. */
export const StageScale = createContext(1);
export const useStageScale = () => useContext(StageScale);

/** The zoom of the teacher; what is drawn inside needs it to know how big the stage is in logical pixels. 1 outside of a stage. */
export const StageZoom = createContext(1);
export const useStageZoom = () => useContext(StageZoom);

export interface FixedStageProps {
  children: ReactNode;
  /** The zoom of the teacher, from 1 to 2: the stage is the base size divided by it, and the scale makes it fill the room all the same. */
  zoom?: number;
}

/**
 * The stage of the live class (SPEC-057): a box of 1280 x 720 logical pixels (smaller by the zoom), the same for the teacher and for every student,
 * scaled to fit the room it is in and centered in it, with the dark of the theme on the sides. The room is measured again whenever it changes, so the
 * window being resized or going full screen takes no reload, and a new zoom takes no reload either. Everything of the stage is drawn inside; the bar,
 * the notes and the notices stay outside.
 */
export function FixedStage({ children, zoom = 1 }: FixedStageProps) {
  const room = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const z = clampZoom(zoom);
  const box = stageSize(z);
  const scale = stageScale(size.width, size.height, z);

  useEffect(() => {
    // Without the observer (an old browser) the stage stays at its own size.
    if (!room.current || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) => entry && setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    watch.observe(room.current);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={room} className={styles.room} data-testid="fixed-stage">
      <div className={styles.frame} style={{ width: box.width * scale, height: box.height * scale }}>
        <div className={styles.stage} data-testid="stage-box" style={{ width: box.width, height: box.height, transform: `scale(${scale})` }}>
          <StageScale.Provider value={scale}>
            <StageZoom.Provider value={z}>{children}</StageZoom.Provider>
          </StageScale.Provider>
        </div>
      </div>
    </div>
  );
}

/** The mouse of the teacher on the stage: a plain pointer, and the highlight when the laser is on. `x` and `y` are percentages of the box it is in. */
export function StagePointer({ x, y, laser }: { x: number; y: number; laser: boolean }) {
  return <span className={laser ? styles.laser : styles.pointer} {...(laser ? { "data-laser": "" } : { "data-pointer": "" })} style={{ left: `${x}%`, top: `${y}%` }} />;
}
